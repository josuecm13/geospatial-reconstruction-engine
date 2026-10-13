import { describe, expect, it } from "vitest";
import type { PlaceResult } from "../api/types";
import { describePlace, keyAction, normalizeQuery, placeBounds } from "./placeResults";

const BERLIN: PlaceResult = {
  display_name: "Berlin, Germany",
  name: "Berlin",
  latitude: 52.5,
  longitude: 13.4,
  bbox: { south: 52.3, west: 13.1, north: 52.7, east: 13.8 },
  category: "boundary",
  type: "administrative",
};

describe("describePlace", () => {
  it("splits the name from where it is, and names the kind", () => {
    expect(describePlace(BERLIN)).toEqual({ title: "Berlin", subtitle: "Germany", kind: "Administrative" });
  });

  it("falls back to the first part of the display name, and to the category for a plain type", () => {
    const line = describePlace({ ...BERLIN, name: "", display_name: "Cafe Uno, Main St, Town", type: "yes", category: "amenity" });
    expect(line).toEqual({ title: "Cafe Uno", subtitle: "Main St, Town", kind: "Amenity" });
  });

  it("keeps the whole display name as the subtitle when it does not start with the name", () => {
    expect(describePlace({ ...BERLIN, name: "Mitte", display_name: "Berlin, Germany" }).subtitle).toBe("Berlin, Germany");
  });
});

describe("normalizeQuery", () => {
  it("trims, and refuses what the server would", () => {
    expect(normalizeQuery("  Berlin ")).toBe("Berlin");
    expect(normalizeQuery(" a ")).toBeNull();
    expect(normalizeQuery("x".repeat(201))).toBeNull();
  });
});

describe("placeBounds", () => {
  it("is south-west then north-east, longitude first", () => {
    expect(placeBounds(BERLIN)).toEqual([
      [13.1, 52.3],
      [13.8, 52.7],
    ]);
  });
});

describe("keyAction", () => {
  it("moves down and up, wrapping", () => {
    expect(keyAction("ArrowDown", -1, 3)).toEqual({ type: "move", active: 0 });
    expect(keyAction("ArrowDown", 2, 3)).toEqual({ type: "move", active: 0 });
    expect(keyAction("ArrowUp", 0, 3)).toEqual({ type: "move", active: 2 });
    expect(keyAction("ArrowUp", -1, 3)).toEqual({ type: "move", active: 2 });
    expect(keyAction("ArrowDown", 0, 3)).toEqual({ type: "move", active: 1 });
  });

  it("jumps with Home and End", () => {
    expect(keyAction("Home", 2, 3)).toEqual({ type: "move", active: 0 });
    expect(keyAction("End", 0, 3)).toEqual({ type: "move", active: 2 });
  });

  it("chooses on Enter only when an entry is highlighted", () => {
    expect(keyAction("Enter", 1, 3)).toEqual({ type: "choose", index: 1 });
    expect(keyAction("Enter", -1, 3)).toBeNull();
  });

  it("closes on Escape, even with nothing listed, and ignores other keys", () => {
    expect(keyAction("Escape", -1, 0)).toEqual({ type: "close" });
    expect(keyAction("ArrowDown", -1, 0)).toBeNull();
    expect(keyAction("a", 0, 3)).toBeNull();
  });
});
