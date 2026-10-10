import { describe, expect, it } from "vitest";
import { COLORS } from "../scene/palette";
import { contrast, luminance } from "../testing/cssTokens";
import { MAP_COLORS, lifted } from "./mapColors";

/** The OpenFreeMap dark basemap's background. */
const BASEMAP = "#0c0c0c";

describe("MAP_COLORS on the dark basemap", () => {
  it("draws every road tier at 3:1 or more against the basemap, and keeps the tiers in order", () => {
    for (const tier of ["roadWide", "roadNormal", "roadNarrow"] as const) {
      expect(contrast(MAP_COLORS[tier], BASEMAP), tier).toBeGreaterThanOrEqual(3);
    }
    expect(luminance(MAP_COLORS.roadWide)).toBeGreaterThan(luminance(MAP_COLORS.roadNormal));
    expect(luminance(MAP_COLORS.roadNormal)).toBeGreaterThan(luminance(MAP_COLORS.roadNarrow));
  });

  it("draws water and green at 3:1 or more, and apart", () => {
    expect(contrast(MAP_COLORS.water, BASEMAP)).toBeGreaterThanOrEqual(3);
    expect(contrast(MAP_COLORS.green, BASEMAP)).toBeGreaterThanOrEqual(3);
    expect(MAP_COLORS.water).not.toBe(MAP_COLORS.green);
  });

  it("draws the land-use kinds at 3:1 or more, apart from park green and from each other", () => {
    const kinds = ["forest", "farmland", "cemetery", "railway", "industrial"] as const;
    for (const kind of kinds) {
      expect(contrast(MAP_COLORS[kind], BASEMAP), kind).toBeGreaterThanOrEqual(3);
      expect(MAP_COLORS[kind], kind).not.toBe(MAP_COLORS.green);
    }
    expect(new Set(kinds.map((kind) => MAP_COLORS[kind])).size).toBe(kinds.length);
  });

  it("draws generated buildings, zones and block outlines readable on the basemap, generated apart from the others", () => {
    for (const key of ["buildingGenerated", "blockOutline", "blockReference", "blockSelected", "zoneWater", "zoneSteep", "zoneLanduse", "zoneSetback"] as const) {
      expect(contrast(MAP_COLORS[key], BASEMAP), key).toBeGreaterThanOrEqual(3);
    }
    expect(MAP_COLORS.buildingGenerated).not.toBe(MAP_COLORS.buildingMeasured);
    expect(MAP_COLORS.buildingGenerated).not.toBe(MAP_COLORS.buildingDefaulted);
  });

  it("derives the lifted colours from the 3D palette, lighter than the scene's own", () => {
    expect(MAP_COLORS.roadNormal).toBe(lifted(COLORS.roadNormal));
    expect(luminance(MAP_COLORS.roadNormal)).toBeGreaterThan(luminance(COLORS.roadNormal));
  });
});
