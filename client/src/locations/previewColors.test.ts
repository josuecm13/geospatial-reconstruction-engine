import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { COLORS, SCENE_BACKGROUND } from "../scene/palette";
import { AMBIENT, LIGHT_DIRECTION, shade } from "../scene/shading";
import { PREVIEW_COLORS, shadowOffset } from "./previewColors";

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

  it("does not draw the buildable blocks, which the 3D scene hides by default", () => {
    expect(PREVIEW_COLORS).not.toHaveProperty("block");
  });

  it("shades the ground in a shadow by ambient light only, mixed half way to black so it shows on the dark ground", () => {
    expect(PREVIEW_COLORS.shadow).toBe(hexTimes(COLORS.ground, AMBIENT * 0.5));
    expect(lightness(PREVIEW_COLORS.shadow)).toBeLessThan(lightness(hexTimes(COLORS.ground, AMBIENT)));
    expect(lightness(PREVIEW_COLORS.shadow)).toBeLessThan(lightness(PREVIEW_COLORS.ground));
  });
});

describe("shadowOffset", () => {
  it("is zero for a zero height", () => {
    expect(shadowOffset(0, 2)).toEqual([0, 0]);
  });

  it("points away from the light: east and north (right and up on screen) for the current light", () => {
    expect(LIGHT_DIRECTION.x).toBeLessThan(0); // light from the west
    expect(LIGHT_DIRECTION.z).toBeGreaterThan(0); // and the south
    const [dx, dy] = shadowOffset(10, 1);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
    expect(dx).toBeCloseTo(-LIGHT_DIRECTION.x * 10 / LIGHT_DIRECTION.y);
    expect(dy).toBeCloseTo(-LIGHT_DIRECTION.z * 10 / LIGHT_DIRECTION.y);
  });

  it("scales linearly with height and with the pixels per metre", () => {
    const [dx, dy] = shadowOffset(5, 1.5);
    const [dx2, dy2] = shadowOffset(10, 1.5);
    expect(dx2).toBeCloseTo(2 * dx);
    expect(dy2).toBeCloseTo(2 * dy);
    expect(shadowOffset(5, 3)[0]).toBeCloseTo(2 * dx);
  });
});
