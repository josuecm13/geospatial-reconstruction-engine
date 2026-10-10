import { describe, expect, it } from "vitest";
import type { BlockProperties, Feature, MapData, Position } from "../api/types";
import { toLocal } from "../scene/projection";
import { blockEntries, blockOutlines, blockUnder, insetLonLat } from "./blockOutlines";

const D = 0.0001; // about 11 m
const projection = { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 };
const square = (lon: number, lat: number): Position[][] => [[[lon, lat], [lon + D, lat], [lon + D, lat + D], [lon, lat + D], [lon, lat]]];
const block = (id: string, lat: number, extra: Partial<BlockProperties> = {}): Feature<BlockProperties> => ({
  type: "Feature",
  id,
  geometry: { type: "Polygon", coordinates: square(-84, lat) },
  properties: {
    area_square_meters: 100,
    buildable_area: null,
    buildable_area_square_meters: 0,
    is_median: false,
    is_clipped: false,
    import_area_id: "a1",
    eligibility: "eligible",
    real_building_count: 0,
    generated_building_count: 0,
    is_reference: false,
    reference_block_id: null,
    style: null,
    feedback: null,
    ...extra,
  },
});
const data = (blocks: Feature<BlockProperties>[]): Pick<MapData, "blocks" | "projection"> => ({ blocks: { type: "FeatureCollection", features: blocks }, projection });

describe("insetLonLat", () => {
  it("moves a ring 1.5 m inward, measured on the ground", () => {
    const [ring] = square(-84, 10);
    const inset = insetLonLat(ring, projection).map((p) => toLocal(projection, p));
    const xs = inset.map((p) => p.x);
    const zs = inset.map((p) => p.z);

    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(D * 109_000 - 3, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(D * 110_000 - 3, 6);
  });
});

describe("blockOutlines", () => {
  it("makes a closed inset line per block, with its id and how it is drawn", () => {
    const outlines = blockOutlines(data([block("b1", 10), block("b2", 10.0003, { eligibility: "median" }), block("b3", 10.0006, { is_reference: true })]));

    expect(outlines.features.map((f) => f.properties)).toEqual([
      { id: "b1", kind: "crisp" },
      { id: "b2", kind: "faint" },
      { id: "b3", kind: "reference" },
    ]);
    const { coordinates } = outlines.features[0].geometry as { type: "LineString"; coordinates: Position[] };
    expect(coordinates[0]).toEqual(coordinates[coordinates.length - 1]);
    expect(coordinates).toHaveLength(5);
  });

  it("makes a line per polygon of a MultiPolygon block, all with the block's id", () => {
    const multi: Feature<BlockProperties> = { ...block("m", 10), geometry: { type: "MultiPolygon", coordinates: [square(-84, 10), square(-84, 10.001)] } };

    expect(blockOutlines(data([multi])).features.map((f) => f.properties.id)).toEqual(["m", "m"]);
  });

  it("draws nothing for a block with no geometry we can use", () => {
    const point: Feature<BlockProperties> = { ...block("p", 10), geometry: { type: "Point", coordinates: [-84, 10] } };

    expect(blockOutlines(data([point])).features).toEqual([]);
  });
});

describe("blockUnder", () => {
  const entries = blockEntries(data([block("b1", 10), block("b2", 10.0003)]));

  it("finds the block containing a clicked [lon, lat]", () => {
    expect(blockUnder(entries, { lng: -84 + D / 2, lat: 10 + D / 2 })?.id).toBe("b1");
    expect(blockUnder(entries, { lng: -84 + D / 2, lat: 10.0003 + D / 2 })?.id).toBe("b2");
  });

  it("is null on a road between blocks, and returns the block's own properties", () => {
    expect(blockUnder(entries, { lng: -84 + D / 2, lat: 10.00015 })).toBeNull();
    expect(blockUnder(entries, { lng: -84 + D / 2, lat: 10 + D / 2 })?.properties.import_area_id).toBe("a1");
  });
});
