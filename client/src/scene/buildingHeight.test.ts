import { describe, expect, it } from "vitest";
import { buildingHeight } from "./buildingHeight";

describe("buildingHeight", () => {
  it("prefers the stated height over levels", () => {
    expect(buildingHeight({ height_meters: 12.5, levels: 3, category: "house" })).toEqual({ height: 12.5, defaulted: false });
  });

  it("uses levels at 3.2 m each when there is no height", () => {
    const { height, defaulted } = buildingHeight({ height_meters: null, levels: 5, category: "house" });
    expect(height).toBeCloseTo(16);
    expect(defaulted).toBe(false);
  });

  it("falls back to the category table, marked as defaulted", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "church" })).toEqual({ height: 20, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "shed" })).toEqual({ height: 3, defaulted: true });
  });

  it("uses 9 m for an unlisted category", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "hangar" })).toEqual({ height: 9, defaulted: true });
  });
});
