import { describe, expect, it } from "vitest";
import type { ImportArea } from "../api/types";
import { areaSquareMeters, formatSquareKilometers } from "../geo/bbox";
import { filterCards, formatCentre, formatWhen, sortCards, toCard } from "./cardModel";

const NOW = new Date("2026-10-02T12:00:00Z");
const bbox = { min_latitude: 52.52, min_longitude: 13.39, max_latitude: 52.54, max_longitude: 13.41 };
const area = (id: string, over: Partial<ImportArea> = {}): ImportArea => ({
  id, provider: "osm", bbox, status: "completed", road_count: 61, node_count: 1, building_count: 147, poi_count: 0,
  area_feature_count: 0, block_count: 15, linked_building_count: null, imported_at: "2026-10-02T11:00:00Z", ...over,
});
const small = { min_latitude: 10, min_longitude: 10, max_latitude: 10.005, max_longitude: 10.005 };

describe("formatCentre", () => {
  it("rounds the centre to four decimals with hemispheres", () => {
    expect(formatCentre(bbox)).toBe("52.5300° N, 13.4000° E");
  });

  it("uses S and W below zero, and N and E on the line", () => {
    expect(formatCentre({ min_latitude: -34, min_longitude: -71, max_latitude: -33, max_longitude: -70 })).toBe("33.5000° S, 70.5000° W");
    expect(formatCentre({ min_latitude: -1, min_longitude: -1, max_latitude: 1, max_longitude: 1 })).toBe("0.0000° N, 0.0000° E");
  });
});

describe("formatWhen", () => {
  it.each<[string | null, string]>([
    [null, "Never completed"],
    ["not a date", "Never completed"],
    ["2026-10-02T11:59:30Z", "just now"],
    ["2026-10-02T12:30:00Z", "just now"], // a clock slightly ahead of ours
    ["2026-10-02T11:59:00Z", "1 min ago"],
    ["2026-10-02T11:00:01Z", "59 min ago"],
    ["2026-10-02T11:00:00Z", "1 h ago"],
    ["2026-10-01T12:00:01Z", "23 h ago"],
    ["2026-10-01T12:00:00Z", "1 d ago"],
    ["2026-09-25T12:00:01Z", "6 d ago"],
    ["2026-09-25T12:00:00Z", "25 Sep 2026"],
    ["2025-03-07T08:00:00Z", "7 Mar 2025"],
  ])("%s reads %s", (iso, expected) => {
    expect(formatWhen(iso, NOW)).toBe(expected);
  });
});

describe("toCard", () => {
  it("summarises a completed area", () => {
    const card = toCard(area("a"), NOW);

    expect(card).toMatchObject({
      id: "a",
      title: "52.5300° N, 13.4000° E",
      when: "1 h ago",
      importedAt: "2026-10-02T11:00:00Z",
      status: "completed",
      statusLabel: "Imported",
      bbox,
    });
    expect(card.squareMeters).toBe(areaSquareMeters(bbox));
    expect(card.subtitle).toBe(formatSquareKilometers(card.squareMeters));
    expect(card.counts).toEqual([
      { key: "buildings", label: "buildings", value: 147 },
      { key: "roads", label: "roads", value: 61 },
      { key: "blocks", label: "blocks", value: 15 },
    ]);
  });

  it("counts a missing count as zero", () => {
    const card = toCard(area("a", { building_count: null, road_count: null }), NOW);

    expect(card.counts.map((count) => count.value)).toEqual([0, 0, 15]);
  });

  it.each([
    ["pending", "Waiting to import"],
    ["importing", "Importing"],
    ["failed", "Import failed"],
  ] as const)("shows a %s area as such, with no counts", (status, label) => {
    const card = toCard(area("a", { status, imported_at: null }), NOW);

    expect(card.status).toBe(status);
    expect(card.statusLabel).toBe(label);
    expect(card.counts).toEqual([]);
    expect(card.when).toBe("Never completed");
  });
});

describe("toCard place name", () => {
  it("titles the card by place name, keeping the context and coordinates", () => {
    const card = toCard(area("a", { place_name: "Mitte", place_context: "Berlin, Germany" }), NOW);

    expect(card).toMatchObject({ title: "Mitte", place: "Mitte", context: "Berlin, Germany", coordinates: "52.5300° N, 13.4000° E" });
  });

  it.each<[string | null | undefined, string | null | undefined]>([
    [null, null],
    [undefined, undefined],
    ["  ", ""],
  ])("falls back to the coordinates for place %j and context %j", (place_name, place_context) => {
    const card = toCard(area("a", { place_name, place_context }), NOW);

    expect(card).toMatchObject({ title: "52.5300° N, 13.4000° E", place: null, context: null });
  });
});

describe("filterCards", () => {
  const cards = [
    toCard(area("berlin"), NOW),
    toCard(area("far", { bbox: small, status: "failed", imported_at: null }), NOW),
  ];

  it("returns everything for blank text, as a copy", () => {
    const all = filterCards(cards, "  ");

    expect(all.map((card) => card.id)).toEqual(["berlin", "far"]);
    expect(all).not.toBe(cards);
  });

  it("matches the place", () => {
    expect(filterCards(cards, "52.53").map((card) => card.id)).toEqual(["berlin"]);
    expect(filterCards(cards, "10.0025° N").map((card) => card.id)).toEqual(["far"]);
  });

  it("matches the place name and context", () => {
    const named = [toCard(area("mitte", { place_name: "Mitte", place_context: "Berlin, Germany" }), NOW), ...cards];

    expect(filterCards(named, "mitte").map((card) => card.id)).toEqual(["mitte"]);
    expect(filterCards(named, "germany berlin").map((card) => card.id)).toEqual(["mitte"]);
  });

  it("matches the status, ignoring case", () => {
    expect(filterCards(cards, "FAILED").map((card) => card.id)).toEqual(["far"]);
  });

  it("requires every word to match", () => {
    expect(filterCards(cards, "failed 52.53")).toEqual([]);
    expect(filterCards(cards, "imported 52.53").map((card) => card.id)).toEqual(["berlin"]);
  });
});

describe("sortCards", () => {
  const big = { ...bbox, max_latitude: 52.6 }; // 0.08 degrees tall, against 0.02 and 0.005
  const cards = [
    toCard(area("old", { imported_at: "2026-01-01T00:00:00Z" }), NOW),
    toCard(area("never", { status: "failed", imported_at: null, bbox: small }), NOW),
    toCard(area("new", { imported_at: "2026-10-01T00:00:00Z", bbox: big }), NOW),
  ];

  it("puts the latest import first and areas never completed last", () => {
    expect(sortCards(cards, "recent").map((card) => card.id)).toEqual(["new", "old", "never"]);
  });

  it("puts the largest rectangle first", () => {
    expect(sortCards(cards, "size").map((card) => card.id)).toEqual(["new", "old", "never"]);
    expect(sortCards([cards[1], cards[0]], "size").map((card) => card.id)).toEqual(["old", "never"]);
  });

  it("sorts by name A-Z ignoring case and accents, unnamed cards last by coordinates, ties by id", () => {
    const named = [
      toCard(area("z", { place_name: "zürich" }), NOW),
      toCard(area("far", { bbox: small }), NOW),
      toCard(area("b2", { place_name: "Berlin" }), NOW),
      toCard(area("e", { place_name: "Écully" }), NOW),
      toCard(area("b1", { place_name: "berlin" }), NOW),
      toCard(area("here"), NOW),
    ];

    expect(sortCards(named, "name").map((card) => card.id)).toEqual(["b1", "b2", "e", "z", "far", "here"]);
  });

  it("breaks ties by id and leaves the input alone", () => {
    const twins = [toCard(area("b"), NOW), toCard(area("a"), NOW)];

    expect(sortCards(twins, "recent").map((card) => card.id)).toEqual(["a", "b"]);
    expect(sortCards(twins, "size").map((card) => card.id)).toEqual(["a", "b"]);
    expect(twins.map((card) => card.id)).toEqual(["b", "a"]);
  });
});
