import { describe, expect, it } from "vitest";
import { buildingHeight, buildingHeights } from "./buildingHeight";

describe("buildingHeight", () => {
  it("prefers the stated height over levels", () => {
    expect(buildingHeight({ height_meters: 12.5, levels: 3, category: "residential", building_type: "house" })).toEqual({ height: 12.5, defaulted: false });
  });

  it("uses levels at 3 m each when there is no height", () => {
    expect(buildingHeight({ height_meters: null, levels: 2, category: "residential" })).toEqual({ height: 6, defaulted: false });
    expect(buildingHeight({ height_meters: null, levels: 5, category: "residential" })).toEqual({ height: 15, defaulted: false });
  });

  it("draws one or two storeys for low-rise types with no levels, by the mix", () => {
    const of = (building_type: string | null, category: string, share: number) =>
      buildingHeight({ height_meters: null, levels: null, category, building_type }, { seed: "w1", share });
    for (const type of ["yes", "house", "detached", "semidetached_house", "terrace", "bungalow", "hut", "cabin", "residential"]) {
      expect(of(type, "residential", 0)).toEqual({ height: 3, defaulted: true });
      expect(of(type, "residential", 1)).toEqual({ height: 6, defaulted: true });
    }
    expect(of(null, "residential", 1)).toEqual({ height: 6, defaulted: true });
    expect(of(null, "unspecified", 0)).toEqual({ height: 3, defaulted: true });
  });

  it("gives each building of a set its own repeatable draw, from its block's evidence", () => {
    const feature = (id: string, block_id: string | null, levels: number | null) => ({
      type: "Feature" as const,
      id,
      geometry: { type: "Polygon" as const, coordinates: [] },
      properties: { category: "residential", block_id, height_meters: null, levels, building_type: "yes", import_area_id: "a", base_elevation_meters: null },
    });
    const evidence = [0, 1, 2].map((i) => feature(`e${i}`, "b1", 1));
    const blank = Array.from({ length: 200 }, (_, i) => feature(`h${i}`, "b1", null));
    const inBlock = buildingHeights([...evidence, ...blank]).slice(3);
    expect(inBlock.every((h) => h.height === 3 && h.defaulted)).toBe(true); // the block's evidence is all one-storey
    const noBlock = Array.from({ length: 1000 }, (_, i) => feature(`x${i}`, null, null));
    const elsewhere = buildingHeights(noBlock);
    const twoStorey = elsewhere.filter((h) => h.height === 6).length / 1000;
    expect(twoStorey).toBeGreaterThan(0.25);
    expect(twoStorey).toBeLessThan(0.35);
    expect(buildingHeights([noBlock[7]])).toEqual([elsewhere[7]]);
  });

  it("defaults apartments to five storeys", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "residential", building_type: "apartments" })).toEqual({ height: 15, defaulted: true });
  });

  it("defaults by building type, marked as defaulted", () => {
    const of = (building_type: string) => buildingHeight({ height_meters: null, levels: null, category: "unspecified", building_type });
    expect(of("church")).toEqual({ height: 20, defaulted: true });
    expect(of("shed")).toEqual({ height: 3, defaulted: true });
    expect(of("warehouse")).toEqual({ height: 10, defaulted: true });
    expect(of("retail")).toEqual({ height: 12, defaulted: true });
  });

  it("falls back to the category when the type is null or unlisted", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "commercial", building_type: "kiosk" })).toEqual({ height: 12, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "civic" })).toEqual({ height: 12, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "residential", building_type: "kiosk" }, { seed: "s", share: 1 })).toEqual({ height: 6, defaulted: true });
  });

  it("uses 6 m for an unlisted category that is not housing", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "other" })).toEqual({ height: 6, defaulted: true });
  });
});
