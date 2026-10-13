import { describe, expect, it } from "vitest";
import { buildingHeight } from "./buildingHeight";

describe("buildingHeight", () => {
  it("prefers the stated height over levels", () => {
    expect(buildingHeight({ height_meters: 12.5, levels: 3, category: "residential", building_type: "house" })).toEqual({ height: 12.5, defaulted: false });
  });

  it("uses levels at 3 m each when there is no height", () => {
    expect(buildingHeight({ height_meters: null, levels: 2, category: "residential" })).toEqual({ height: 6, defaulted: false });
    expect(buildingHeight({ height_meters: null, levels: 5, category: "residential" })).toEqual({ height: 15, defaulted: false });
  });

  it("defaults building=yes with no levels to two storeys", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "residential", building_type: "yes" })).toEqual({ height: 6, defaulted: true });
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

  it("falls back to the category when the type is null or unknown", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "residential", building_type: null })).toEqual({ height: 6, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "residential" })).toEqual({ height: 6, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "commercial", building_type: "kiosk" })).toEqual({ height: 12, defaulted: true });
    expect(buildingHeight({ height_meters: null, levels: null, category: "civic" })).toEqual({ height: 12, defaulted: true });
  });

  it("uses 6 m for an unlisted category", () => {
    expect(buildingHeight({ height_meters: null, levels: null, category: "unspecified" })).toEqual({ height: 6, defaulted: true });
  });
});
