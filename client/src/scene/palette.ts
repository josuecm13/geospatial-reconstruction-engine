import * as THREE from "three";
import type { OutlineKind } from "./blockOutline";
import { DEFAULT_THEME } from "./themes";
import { NIGHT_CLAY_BACKGROUND, NIGHT_CLAY_COLORS } from "./themes/nightClay";
import { patchWindows } from "./nightWindows";
import type { Theme, ThemeColors } from "./themes/types";

/**
 * Night clay's colours. The 2D map, the location previews and `--scene-background` read these and don't follow
 * the scene's theme; the scene's own colours come from the active theme (`activeTheme().colors`).
 */
export const COLORS: Readonly<ThemeColors> = NIGHT_CLAY_COLORS;

/** The scene's background in Night clay: the ground colour as it renders on an upward face. `--scene-background` in style.css must equal it. */
export const SCENE_BACKGROUND = NIGHT_CLAY_BACKGROUND;

type Extra = THREE.MeshBasicMaterialParameters & THREE.MeshLambertMaterialParameters;
type Surface = THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;

/** Unlit: the shade is baked into the geometry's vertex colors (shading.ts), and the material multiplies it into the palette color. */
const flat = (color: string, extra: Extra = {}): Surface => new THREE.MeshBasicMaterial({ color, vertexColors: true, ...extra });

/** Lit: three.js lights shade it, flat per face from the geometry's face normals. The baked shade is off, or it would darken twice. */
const lit = (color: string, extra: Extra = {}): Surface => new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: false, ...extra });

/** Zones tint the ground under them, at low opacity so what they cover shows through. */
const ZONE: Extra = { transparent: true, opacity: 0.3, side: THREE.DoubleSide };

const GRID_VERTEX = /* glsl */ `
varying vec2 vGridPos;`;

/** A grid line of cell size `cell` metres at world position `p`: 1 where a line runs, antialiased with `fwidth`. Also gives how many cells a pixel spans, to fade lines that get too dense. */
const GRID_FRAGMENT = /* glsl */ `
varying vec2 vGridPos;
uniform vec3 gridMinor;
uniform vec3 gridMajor;
float gridLine(vec2 p, float cell, out float density) {
  vec2 c = p / cell;
  vec2 w = max(fwidth(c), vec2(1e-6));
  density = max(w.x, w.y);
  vec2 d = abs(fract(c - 0.5) - 0.5) / w;
  return 1.0 - min(min(d.x, d.y), 1.0);
}`;

/**
 * Blueprint's ground: the ground material with thin lines every 10 m and a stronger one every 100 m, from the world x and z.
 * The vertex shader takes the world position through `modelMatrix` (the ground mesh is positioned, so its local position isn't it).
 * The 10 m lines fade out once they are closer than about 4 px.
 */
const withGrid = (material: Surface, colors: ThemeColors): Surface => {
  const minor = new THREE.Color(colors.gridMinor ?? colors.gridLine);
  const major = new THREE.Color(colors.gridMajor ?? colors.gridCenter);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gridMinor = { value: minor };
    shader.uniforms.gridMajor = { value: major };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${GRID_VERTEX}\nvoid main() {`)
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vGridPos = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${GRID_FRAGMENT}\nvoid main() {`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float minorDensity;
  float majorDensity;
  float minorLine = gridLine(vGridPos, 10.0, minorDensity) * (1.0 - smoothstep(0.125, 0.25, minorDensity));
  float majorLine = gridLine(vGridPos, 100.0, majorDensity);
  diffuseColor.rgb = mix(diffuseColor.rgb, gridMinor, minorLine);
  diffuseColor.rgb = mix(diffuseColor.rgb, gridMajor, majorLine);`,
      );
  };
  material.customProgramCacheKey = () => "blueprint-grid";
  return material;
};

/** Blueprint's building fills: unlit, faint, and they write depth. */
const blueprintFill = (color: string): Surface => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: true });

const buildMaterials = (theme: Theme) => {
  const { colors } = theme;
  const line = theme.mode === "line";
  const surface = theme.mode === "lit" ? lit : flat;
  /** Ground-level layers write no depth: their draw order (LAYER_ORDER in buildWorld.ts) decides what shows on top. */
  const decal = (color: string, extra: Extra = {}) => surface(color, { depthWrite: false, ...extra });
  const building = (color: string, generated: boolean) => {
    const material = line ? blueprintFill(color) : surface(color);
    if (theme.windows !== "never") patchWindows(material, { generated });
    return material;
  };
  return {
    ground: line ? withGrid(decal(colors.ground), colors) : decal(colors.ground),
    green: decal(colors.green),
    water: decal(colors.water),
    forest: decal(colors.forest),
    farmland: decal(colors.farmland),
    cemetery: decal(colors.cemetery),
    railway: decal(colors.railway),
    industrial: decal(colors.industrial),
    roadNormal: decal(colors.roadNormal),
    roadWide: decal(colors.roadWide),
    roadNarrow: decal(colors.roadNarrow),
    buildingMeasured: building(colors.buildingMeasured, false),
    buildingDefaulted: building(colors.buildingDefaulted, false),
    buildingGenerated: building(colors.buildingGenerated, true),
    buildable: decal(colors.buildable, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    zoneWater: decal(colors.zoneWater, ZONE),
    zoneSteep: decal(colors.zoneSteep, ZONE),
    zoneLanduse: decal(colors.zoneLanduse, ZONE),
    zoneSetback: decal(colors.zoneSetback, ZONE),
    // Block outlines are lines, so no shade. Dashes are in metres (the scene's unit); `computeLineDistances()` on each line makes them show.
    blockOutline: new THREE.LineDashedMaterial({ color: colors.blockOutline, dashSize: 4, gapSize: 2 }),
    blockOutlineFaint: new THREE.LineDashedMaterial({ color: colors.blockOutline, dashSize: 0.6, gapSize: 2.4, transparent: true, opacity: 0.45 }),
    blockOutlineReference: new THREE.LineDashedMaterial({ color: colors.blockReference, dashSize: 10, gapSize: 2 }),
    blockOutlineSelected: new THREE.LineBasicMaterial({ color: colors.blockSelected }),
    // The route, the markers and the pin stay unlit in every theme.
    route: flat(colors.route, { side: THREE.DoubleSide }),
    origin: flat(colors.origin),
    destination: flat(colors.destination),
    pin: flat(colors.pin),
    pinRing: flat(colors.pin, { depthWrite: false, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    // A wireframe, not faces: no shade.
    waiting: new THREE.MeshBasicMaterial({ color: colors.waiting, wireframe: true }),
    // Building edge lines, shared by every building: lines, so no shade.
    // In Blueprint they are bright and opaque.
    edge: line ? new THREE.LineBasicMaterial({ color: colors.edge }) : new THREE.LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.35 }),
    // The edges of generated buildings: dashed in Blueprint (`computeLineDistances()` on each edge object makes them show), a twin of `edge` elsewhere (its own object, so restyle keeps the two apart).
    edgeGenerated: line
      ? new THREE.LineDashedMaterial({ color: colors.buildingGenerated, dashSize: 1.5, gapSize: 1 })
      : new THREE.LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.35 }),
    // The outlines of the roads: drawn in Blueprint only (`roadOutlineLines` in buildWorld.ts), a line of the edge colour elsewhere.
    roadOutline: new THREE.LineBasicMaterial({ color: colors.roadOutline ?? colors.edge }),
  };
};

export type MaterialSet = ReturnType<typeof buildMaterials>;
export type MaterialKey = keyof MaterialSet;

const cache = new Map<string, MaterialSet>();

/** The full material set of a theme, built once per theme id and kept (never disposed). Each material records its key in `userData.key`. */
export function materialsFor(theme: Theme): MaterialSet {
  let set = cache.get(theme.id);
  if (!set) {
    set = buildMaterials(theme);
    for (const key of Object.keys(set) as MaterialKey[]) set[key].userData.key = key;
    cache.set(theme.id, set);
  }
  return set;
}

let active: Theme = DEFAULT_THEME;

/** What meshes take when they are built: the active theme's set, replaced in place by `setActiveTheme`. */
export const MATERIALS: MaterialSet = { ...materialsFor(DEFAULT_THEME) };

export const activeTheme = (): Theme => active;

/** Makes `theme` the one new meshes are built with. Meshes already built keep their materials until `restyle`. */
export function setActiveTheme(theme: Theme): void {
  active = theme;
  Object.assign(MATERIALS, materialsFor(theme));
}

/** Gives every mesh and line under `root` the active theme's material for its key. Material sets are cached, never disposed. */
export function restyle(root: THREE.Object3D): void {
  root.traverse((object) => {
    const target = object as THREE.Mesh | THREE.Line;
    if (!(target as THREE.Mesh).isMesh && !(target as THREE.Line).isLine) return;
    const material = target.material;
    if (Array.isArray(material)) return;
    const key = material?.userData.key as MaterialKey | undefined;
    if (key && MATERIALS[key]) target.material = MATERIALS[key];
  });
}

export const roadMaterial = (laneType: string) =>
  laneType === "wide" ? MATERIALS.roadWide : laneType === "narrow" ? MATERIALS.roadNarrow : MATERIALS.roadNormal;

/** The ground material of an area feature of this kind: water, a land use above, or park green (also for a kind this client doesn't know). */
export function areaFeatureMaterial(kind: string): THREE.Material {
  switch (kind) {
    case "water":
      return MATERIALS.water;
    case "forest":
      return MATERIALS.forest;
    case "farmland":
      return MATERIALS.farmland;
    case "cemetery":
      return MATERIALS.cemetery;
    case "railway":
      return MATERIALS.railway;
    case "industrial":
      return MATERIALS.industrial;
    default:
      return MATERIALS.green;
  }
}

/** The line material of a block outline (blockOutline.ts decides which kind a block gets). */
export function outlineMaterial(kind: OutlineKind): THREE.LineBasicMaterial {
  switch (kind) {
    case "selected":
      return MATERIALS.blockOutlineSelected;
    case "reference":
      return MATERIALS.blockOutlineReference;
    case "faint":
      return MATERIALS.blockOutlineFaint;
    default:
      return MATERIALS.blockOutline;
  }
}

/** The colour of a generation zone's reason, for the legend's swatch. */
export const zoneColor = (reason: string): string =>
  reason === "water"
    ? active.colors.zoneWater
    : reason === "steep"
      ? active.colors.zoneSteep
      : reason === "landuse"
        ? active.colors.zoneLanduse
        : active.colors.zoneSetback;

/** The shading of a generation zone, by reason. */
export const zoneMaterial = (reason: string): THREE.Material =>
  reason === "water" ? MATERIALS.zoneWater : reason === "steep" ? MATERIALS.zoneSteep : reason === "landuse" ? MATERIALS.zoneLanduse : MATERIALS.zoneSetback;
