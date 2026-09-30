import { describe, expect, it } from "vitest";
import { featureRows } from "./mapDataLayers";

describe("featureRows", () => {
  it("describes a road from MapLibre's flattened properties", () => {
    const rows = featureRows("engine-roads", {
      street: JSON.stringify({ id: "s1", name: "Torstraße", classification: "primary" }),
      lane_count: 2,
      lane_count_provenance: "defaulted",
      lane_type: "wide",
      width_meters: 7,
      distance_meters: 42.345,
    });
    expect(rows).toEqual([
      ["Street", "Torstraße"],
      ["Class", "primary"],
      ["Lanes", "2 (defaulted)"],
      ["Lane type", "wide"],
      ["Width", "7.0 m"],
      ["Length", "42.3 m"],
    ]);
  });

  it("shows an unknown building height as unknown, never as zero", () => {
    const rows = Object.fromEntries(featureRows("engine-buildings", { category: "residential", height_meters: null, levels: 5, block_id: null }));
    expect(rows).toEqual({ Category: "residential", Height: "unknown", Levels: "5", "In a block": "no" });
  });
});
