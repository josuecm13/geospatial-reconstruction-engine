import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { activeTheme, areaFeatureMaterial, COLORS, MATERIALS, materialsFor, restyle, SCENE_BACKGROUND, setActiveTheme, zoneColor, zoneMaterial } from "./palette";
import { shade } from "./shading";
import { DEFAULT_THEME, THEMES, themeById } from "./themes";
import { nightClay } from "./themes/nightClay";
import type { Theme } from "./themes/types";

const sceneDir = __dirname;
const viewsDir = join(__dirname, "..", "views");

/** Every non-test .ts file under `dir`, recursively. */
const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tsFilesUnder(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : [],
  );

const themesDir = join(sceneDir, "themes");

const sources = [
  // palette.ts and everything under scene/themes/ are where colours and materials are written.
  ...tsFilesUnder(sceneDir).filter((path) => !path.startsWith(themesDir) && !path.endsWith("palette.ts")),
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
    expect(tsFilesUnder(sceneDir).some((path) => path.startsWith(themesDir))).toBe(true); // the walk reaches subdirectories...
    expect(sources.some((path) => path.startsWith(themesDir))).toBe(false); // ...and exempts the theme files
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

/** Legibility guards, run over every theme: what must stay distinguishable whatever the palette. */
describe.each(THEMES.map((theme) => [theme.id, theme] as const))("the %s palette stays legible", (_id, theme) => {
  const { colors } = theme;
  const apart = (a: string, b: string, min: number, what: string) => expect(ratio(a, b), `${theme.id}: ${what}`).toBeGreaterThanOrEqual(min);

  it("keeps every road tier at least 1.3:1 from the ground, and each tier distinct from its neighbour", () => {
    for (const tier of ["roadNarrow", "roadNormal", "roadWide"] as const) apart(colors[tier], colors.ground, 1.3, `${tier} against the ground`);
    apart(colors.roadNarrow, colors.roadNormal, 1.15, "roadNarrow against roadNormal");
    apart(colors.roadNormal, colors.roadWide, 1.15, "roadNormal against roadWide");
  });

  it("tells green and water from the ground and from each other", () => {
    apart(colors.green, colors.ground, 1.4, "green against the ground");
    apart(colors.water, colors.ground, 1.4, "water against the ground");
    apart(colors.green, colors.water, 1.15, "green against water");
  });

  it("reads every land-use kind against the ground, each a different colour from park green and from the others", () => {
    const kinds = ["forest", "farmland", "cemetery", "railway", "industrial"] as const;
    for (const kind of kinds) {
      apart(colors[kind], colors.ground, 1.4, `${kind} against the ground`);
      expect(colors[kind], `${theme.id}: ${kind} is not park green`).not.toBe(colors.green);
    }
    expect(new Set(kinds.map((kind) => colors[kind])).size, `${theme.id}: land uses are distinct`).toBe(kinds.length);
  });

  it("tells generated buildings from measured and defaulted ones, and from the ground", () => {
    apart(colors.buildingGenerated, colors.buildingMeasured, 1.3, "generated against measured");
    apart(colors.buildingGenerated, colors.buildingDefaulted, 1.3, "generated against defaulted");
    apart(colors.buildingGenerated, colors.ground, 3, "generated against the ground");
  });

  it("keeps the route, the pin and the block outlines at least 3:1 from the ground", () => {
    for (const role of ["route", "pin", "blockOutline", "blockSelected"] as const) apart(colors[role], colors.ground, 3, `${role} against the ground`);
  });
});

describe("the night clay palette is its own character", () => {
  it("has the background it always had", () => {
    expect(COLORS.ground).toBe("#1b2024");
    expect(SCENE_BACKGROUND).toBe("#1a1f23");
    expect(COLORS).toBe(nightClay.colors);
    expect(nightClay.sky).toEqual({ zenith: SCENE_BACKGROUND, horizon: SCENE_BACKGROUND, below: SCENE_BACKGROUND });
  });

  it("keeps measured roofs at least 7:1 from the ground", () => {
    expect(ratio(COLORS.buildingMeasured, COLORS.ground)).toBeGreaterThanOrEqual(7);
  });

  it("draws defaulted buildings dimmer than measured ones", () => {
    expect(luminance(COLORS.buildingDefaulted)).toBeLessThan(luminance(COLORS.buildingMeasured));
  });

  it("draws generated buildings in a cool hue, with a material of their own", () => {
    expect(ratio(COLORS.buildingGenerated, COLORS.ground)).toBeGreaterThanOrEqual(5);
    const { r, b } = new THREE.Color(COLORS.buildingGenerated);
    expect(b).toBeGreaterThan(r);
    expect(MATERIALS.buildingGenerated).not.toBe(MATERIALS.buildingDefaulted);
  });

  it("maps area kinds to their materials", () => {
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

describe("themes and restyle", () => {
  afterEach(() => setActiveTheme(DEFAULT_THEME));

  const stub: Theme = { ...nightClay, id: "light-clay", label: "Stub", colors: { ...nightClay.colors, buildingMeasured: "#ffffff", pin: "#00ff00", zoneWater: "#112233" } };

  it("falls back to Night clay for an unknown, missing or null theme id", () => {
    expect(themeById("night-clay")).toBe(nightClay);
    for (const id of ["nope", "", null, undefined]) expect(themeById(id)).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe(nightClay);
  });

  it("builds one material set per theme id, each material carrying its key", () => {
    expect(materialsFor(nightClay)).toBe(materialsFor(nightClay));
    expect(materialsFor(stub)).not.toBe(materialsFor(nightClay));
    expect(materialsFor(stub)).toBe(materialsFor(stub));
    for (const [key, material] of Object.entries(materialsFor(stub))) expect(material.userData.key).toBe(key);
  });

  it("restyle swaps a mesh's and a line's material by key after setActiveTheme", () => {
    setActiveTheme(nightClay);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MATERIALS.buildingMeasured);
    const line = new THREE.Line(new THREE.BufferGeometry(), MATERIALS.edge);
    const stranger = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const strangerMaterial = stranger.material;
    const root = new THREE.Group().add(mesh, new THREE.Group().add(line), stranger);
    const before = mesh.material;

    setActiveTheme(stub);
    expect(activeTheme()).toBe(stub);
    expect(mesh.material).toBe(before); // built meshes keep their material until restyled
    expect(MATERIALS.buildingMeasured).toBe(materialsFor(stub).buildingMeasured);
    restyle(root);
    expect(mesh.material).toBe(materialsFor(stub).buildingMeasured);
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("ffffff");
    expect(line.material).toBe(materialsFor(stub).edge);
    expect(stranger.material).toBe(strangerMaterial); // no key, left alone

    setActiveTheme(nightClay);
    restyle(root);
    expect(mesh.material).toBe(materialsFor(nightClay).buildingMeasured);
    expect(mesh.material).toBe(before);
  });

  it("zoneColor reads the active theme", () => {
    expect(zoneColor("water")).toBe(nightClay.colors.zoneWater);
    setActiveTheme(stub);
    expect(zoneColor("water")).toBe("#112233");
  });
});
