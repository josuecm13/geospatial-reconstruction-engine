import { describe, expect, it } from "vitest";
import type { Feature } from "../api/types";
import { LAYERS, SOURCE_KEYS, slimCollection } from "./mapSources";

const feature = (id: string, properties: Record<string, unknown>): Feature<Record<string, unknown>> => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [0, 0] },
  properties,
});

describe("slimCollection", () => {
  it("keeps only the named properties, gives each feature its index as a numeric id, and looks the full ones up by it", () => {
    const full = { lane_type: "wide", width_meters: 7, street: { name: "Torstraße" }, distance_meters: 42 };
    const slim = slimCollection({ features: [feature("a", full), feature("b", { lane_type: "narrow", width_meters: 3, other: 1 })] }, SOURCE_KEYS.road_segments);
    expect(slim.data.features.map((f) => [f.id, f.properties])).toEqual([
      [0, { lane_type: "wide", width_meters: 7 }],
      [1, { lane_type: "narrow", width_meters: 3 }],
    ]);
    expect(slim.properties.get(0)).toBe(full);
    expect(slim.properties.get(1)).toEqual({ lane_type: "narrow", width_meters: 3, other: 1 });
  });

  it("leaves out a key a feature lacks, so a `has` filter still tells it from a null one", () => {
    const slim = slimCollection({ features: [feature("a", { eligibility: null, is_median: false }), feature("b", { is_median: true, area_square_meters: 5 })] }, SOURCE_KEYS.blocks);
    expect(slim.data.features.map((f) => f.properties)).toEqual([{ eligibility: null, is_median: false }, { is_median: true }]);
  });

  it("carries no properties for the generated buildings, and an empty collection for none", () => {
    expect(slimCollection({ features: [feature("g", { block_id: "x", height_meters: 6 })] }, SOURCE_KEYS.generated_buildings).data.features[0].properties).toEqual({});
    const none = slimCollection(null, []);
    expect(none.data).toEqual({ type: "FeatureCollection", features: [] });
    expect(none.properties.size).toBe(0);
  });

  it("does not change the geometry or the input", () => {
    const input = feature("a", { kind: "water", name: "x" });
    const slim = slimCollection({ features: [input] }, SOURCE_KEYS.area_features);
    expect(slim.data.features[0].geometry).toBe(input.geometry);
    expect(input.id).toBe("a");
    expect(input.properties).toEqual({ kind: "water", name: "x" });
  });
});

describe("SOURCE_KEYS", () => {
  it("names the properties each layer's paint and filter read, and no POI source exists", () => {
    expect(SOURCE_KEYS).toEqual({
      area_features: ["kind"],
      generation_zones: ["reason"],
      blocks: ["eligibility", "is_median"],
      road_segments: ["lane_type", "width_meters"],
      buildings: ["height_meters"],
      generated_buildings: [],
    });
    expect([...LAYERS]).not.toContain("pois");
  });
});
