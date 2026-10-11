import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { areaFeatureMaterial, COLORS, MATERIALS, SCENE_BACKGROUND, zoneMaterial } from "./palette";
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

  it("tells generated buildings from measured and defaulted ones, by tone and by a cool hue", () => {
    expect(ratio(COLORS.buildingGenerated, COLORS.buildingMeasured)).toBeGreaterThanOrEqual(1.3);
    expect(ratio(COLORS.buildingGenerated, COLORS.buildingDefaulted)).toBeGreaterThanOrEqual(1.3);
    expect(ratio(COLORS.buildingGenerated, COLORS.ground)).toBeGreaterThanOrEqual(5);
    const { r, b } = new THREE.Color(COLORS.buildingGenerated);
    expect(b).toBeGreaterThan(r);
    expect(MATERIALS.buildingGenerated).not.toBe(MATERIALS.buildingDefaulted);
  });

  it("reads every land-use kind against the ground, each apart from park green and from the others", () => {
    const kinds = ["forest", "farmland", "cemetery", "railway", "industrial"] as const;
    for (const kind of kinds) {
      expect(ratio(COLORS[kind], COLORS.ground), kind).toBeGreaterThanOrEqual(1.4);
      expect(COLORS[kind], kind).not.toBe(COLORS.green);
    }
    expect(new Set(kinds.map((kind) => COLORS[kind])).size).toBe(kinds.length);
    expect(areaFeatureMaterial("forest")).toBe(MATERIALS.forest);
    expect(areaFeatureMaterial("water")).toBe(MATERIALS.water);
    expect(areaFeatureMaterial("park")).toBe(MATERIALS.green);
    expect(areaFeatureMaterial("something_new")).toBe(MATERIALS.green);
  });

  it("shades each zone reason in its own translucent colour", () => {
    const reasons = ["water", "steep", "landuse", "setback"];
    expect(new Set(reasons.map((reason) => zoneMaterial(reason))).size).toBe(reasons.length);
    for (const reason of reasons) expect((zoneMaterial(reason) as THREE.MeshBasicMaterial).opacity, reason).toBeLessThan(0.5);
  });

  it("draws block outlines dashed, with the selected one solid", () => {
    for (const dashed of [MATERIALS.blockOutline, MATERIALS.blockOutlineFaint, MATERIALS.blockOutlineReference]) expect(dashed.isLineDashedMaterial).toBe(true);
    expect(MATERIALS.blockOutlineFaint.dashSize).toBeLessThan(MATERIALS.blockOutline.dashSize);
    expect((MATERIALS.blockOutlineSelected as unknown as { isLineDashedMaterial?: boolean }).isLineDashedMaterial).toBeUndefined();
  });

  it("draws building edges as one shared, translucent, unshaded line material", () => {
    expect(MATERIALS.edge.isLineBasicMaterial).toBe(true);
    expect(MATERIALS.edge.transparent).toBe(true);
    expect(MATERIALS.edge.opacity).toBe(0.35);
    expect(MATERIALS.edge.vertexColors).toBe(false);
  });
});
