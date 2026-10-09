import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { COLORS, SCENE_BACKGROUND } from "../scene/palette";
import { shade } from "../scene/shading";
import { PREVIEW_COLORS } from "./previewColors";

const UP = shade(new THREE.Vector3(0, 1, 0));
const SOUTH = shade(new THREE.Vector3(0, 0, 1));
const hexTimes = (color: string, factor: number) => `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`;
const lightness = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;

describe("PREVIEW_COLORS", () => {
  it("blends into the scene: the background and the ground are the scene's background", () => {
    expect(PREVIEW_COLORS.background).toBe(SCENE_BACKGROUND);
    expect(PREVIEW_COLORS.ground).toBe(SCENE_BACKGROUND);
  });

  it("shades the palette as the 3D scene does: roofs and layers by the up shade, walls by the south shade", () => {
    expect(PREVIEW_COLORS.building).toBe(hexTimes(COLORS.buildingMeasured, UP));
    expect(PREVIEW_COLORS.buildingWall).toBe(hexTimes(COLORS.buildingMeasured, SOUTH));
    expect(PREVIEW_COLORS.buildingDefaulted).toBe(hexTimes(COLORS.buildingDefaulted, UP));
    expect(PREVIEW_COLORS.roadWide).toBe(hexTimes(COLORS.roadWide, UP));
    expect(PREVIEW_COLORS.water).toBe(hexTimes(COLORS.water, UP));
    expect(PREVIEW_COLORS.green).toBe(hexTimes(COLORS.green, UP));
  });

  it("draws a wall darker than its roof, and edges darker than the wall", () => {
    expect(lightness(PREVIEW_COLORS.buildingWall)).toBeLessThan(lightness(PREVIEW_COLORS.building));
    expect(lightness(PREVIEW_COLORS.buildingEdge)).toBeLessThan(lightness(PREVIEW_COLORS.buildingWall));
  });

  it("builds the translucent block colour from the buildable palette colour", () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexTimes(COLORS.buildable, UP).slice(i, i + 2), 16));
    expect(PREVIEW_COLORS.block).toBe(`rgba(${r}, ${g}, ${b}, 0.35)`);
  });
});
