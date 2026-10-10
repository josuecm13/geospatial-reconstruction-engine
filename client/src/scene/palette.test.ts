import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { COLORS, MATERIALS, SCENE_BACKGROUND } from "./palette";
import { shade } from "./shading";

const sceneDir = __dirname;
const viewsDir = join(__dirname, "..", "views");

const sources = [
  ...readdirSync(sceneDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "palette.ts")
    .map((name) => join(sceneDir, name)),
  join(viewsDir, "sceneView.ts"),
  join(__dirname, "..", "landing", "featuredStage.ts"),
  // The 2D map's overlay colours live in views/mapColors.ts.
  join(viewsDir, "mapDataLayers.ts"),
  join(__dirname, "..", "boundaries", "boundaryTool.ts"),
  join(__dirname, "..", "importing", "rectangleTool.ts"),
];

/** A hex colour in a string (`#rgb`, `#rrggbb`), a `0x` colour, or a material built outside the palette. */
const FORBIDDEN = [/["'`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?["'`]/, /\b0x[0-9a-fA-F]{6}\b/, /new THREE\.\w*Material\(/, /\b(?:rgba?|hsla?)\(/];

describe("palette.ts is the only source of scene colors, and mapColors.ts of the 2D map's", () => {
  it("covers the scene sources and the scene view", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((path) => path.endsWith("sceneView.ts"))).toBe(true);
    expect(sources.some((path) => path.endsWith("featuredStage.ts"))).toBe(true);
    expect(sources.some((path) => path.endsWith("palette.ts"))).toBe(false);
    for (const name of ["mapDataLayers.ts", "boundaryTool.ts", "rectangleTool.ts"]) expect(sources.some((path) => path.endsWith(name)), name).toBe(true);
    expect(sources.some((path) => path.endsWith("mapColors.ts"))).toBe(false);
  });

  it.each(sources)("%s has no color literal or material of its own", (path) => {
    const text = readFileSync(path, "utf8");
    for (const pattern of FORBIDDEN) {
      const match = text.match(pattern);
      expect(match, `${path} contains ${match?.[0]}: put it in palette.ts instead`).toBeNull();
    }
  });
});

describe("SCENE_BACKGROUND", () => {
  it("is the ground colour as it renders on an upward face", () => {
    expect(COLORS.ground).toBe("#1b2024");
    expect(SCENE_BACKGROUND).toBe("#1a1f23");
  });
});

/** WCAG relative luminance of a colour as rendered on an upward face (palette colour times `shade(up)`, in linear space). */
const UP = shade(new THREE.Vector3(0, 1, 0));
const luminance = (color: string) => {
  const { r, g, b } = new THREE.Color(color).multiplyScalar(UP);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("the night clay palette reads on the dark ground", () => {
  it("keeps every road tier at least 1.3:1 from the ground, and each tier distinct from its neighbour", () => {
    for (const tier of ["roadNarrow", "roadNormal", "roadWide"] as const) expect(ratio(COLORS[tier], COLORS.ground), tier).toBeGreaterThanOrEqual(1.3);
    expect(ratio(COLORS.roadNarrow, COLORS.roadNormal)).toBeGreaterThanOrEqual(1.15);
    expect(ratio(COLORS.roadNormal, COLORS.roadWide)).toBeGreaterThanOrEqual(1.15);
  });

  it("keeps measured roofs at least 7:1 from the ground", () => {
    expect(ratio(COLORS.buildingMeasured, COLORS.ground)).toBeGreaterThanOrEqual(7);
  });

  it("tells green and water from the ground and from each other", () => {
    expect(ratio(COLORS.green, COLORS.ground)).toBeGreaterThanOrEqual(1.4);
    expect(ratio(COLORS.water, COLORS.ground)).toBeGreaterThanOrEqual(1.4);
    expect(ratio(COLORS.green, COLORS.water)).toBeGreaterThanOrEqual(1.15);
  });

  it("draws defaulted buildings dimmer than measured ones", () => {
    expect(luminance(COLORS.buildingDefaulted)).toBeLessThan(luminance(COLORS.buildingMeasured));
  });

  it("draws building edges as one shared, translucent, unshaded line material", () => {
    expect(MATERIALS.edge.isLineBasicMaterial).toBe(true);
    expect(MATERIALS.edge.transparent).toBe(true);
    expect(MATERIALS.edge.opacity).toBe(0.35);
    expect(MATERIALS.edge.vertexColors).toBe(false);
  });
});
