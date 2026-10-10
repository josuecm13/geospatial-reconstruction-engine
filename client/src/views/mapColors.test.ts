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

  it("derives the lifted colours from the 3D palette, lighter than the scene's own", () => {
    expect(MAP_COLORS.roadNormal).toBe(lifted(COLORS.roadNormal));
    expect(luminance(MAP_COLORS.roadNormal)).toBeGreaterThan(luminance(COLORS.roadNormal));
  });
});
