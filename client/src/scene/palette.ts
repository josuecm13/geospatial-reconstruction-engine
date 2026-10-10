import * as THREE from "three";
import { shade } from "./shading";

/** Every color and shared material of the scene, the only place a scene color is written. One material per kind, never one per mesh. */
export const COLORS = {
  ground: "#1b2024",
  green: "#34503d",
  water: "#22405a",
  // Land uses that aren't a park: deeper woodland, olive fields, a grey-green cemetery, neutral greys for rail and industry.
  forest: "#2e6b46",
  farmland: "#5c6234",
  cemetery: "#4a5c52",
  railway: "#4c4f55",
  industrial: "#5e5a55",
  roadNormal: "#3e454c",
  roadWide: "#4b535b",
  roadNarrow: "#343a40",
  buildingMeasured: "#ddd6c9",
  // Dimmer and cool: the height was assumed, not stated by the source.
  buildingDefaulted: "#8e959c",
  // Cool blue: generated, not observed. Apart from the pale measured roofs and the grey defaulted ones.
  buildingGenerated: "#8fb8d8",
  buildable: "#4fb3a9",
  // Block outlines: the crisp dashed line of an eligible block, the selected one, and a reference (exemplar) block.
  blockOutline: "#4fb3a9",
  blockSelected: "#ffd166",
  blockReference: "#b7a1ff",
  // Generation zones, by why buildings don't go there.
  zoneWater: "#3d8fd1",
  zoneSteep: "#d9774a",
  zoneLanduse: "#8fbf5a",
  zoneSetback: "#e0c15a",
  gridCenter: "#3a4147",
  gridLine: "#2a3035",
  route: "#ff6b3d",
  origin: "#e8e4dc",
  destination: "#ff6b3d",
  // The Set point pin and its ground ring.
  pin: "#ffd166",
  // The waiting wireframe of a staged build.
  waiting: "#8e959c",
  // The pale outline of each building's edges.
  edge: "#f2eee6",
} as const;

/**
 * The scene's background: the ground colour times the shade of an upward face (`shade(UP)`), as the
 * renderer multiplies it (`THREE.Color` holds linear values, so this is the same product as the
 * vertex-colour multiply). The ground plane renders exactly this colour, so the scene's edge is
 * invisible against the background. `--scene-background` in style.css must equal it.
 */
export const SCENE_BACKGROUND = `#${new THREE.Color(COLORS.ground).multiplyScalar(shade(new THREE.Vector3(0, 1, 0))).getHexString()}`;

/** Unlit: the shade is baked into the geometry's vertex colors (shading.ts), and the material multiplies it into the palette color. */
const flat = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, vertexColors: true, ...extra });

/** Ground-level layers write no depth: their draw order (LAYER_ORDER in buildWorld.ts) decides what shows on top. */
const decal = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) => flat(color, { depthWrite: false, ...extra });

/** Zones tint the ground under them, at low opacity so what they cover shows through. */
const ZONE: THREE.MeshBasicMaterialParameters = { transparent: true, opacity: 0.3, side: THREE.DoubleSide };

export const MATERIALS = {
  ground: decal(COLORS.ground),
  green: decal(COLORS.green),
  water: decal(COLORS.water),
  forest: decal(COLORS.forest),
  farmland: decal(COLORS.farmland),
  cemetery: decal(COLORS.cemetery),
  railway: decal(COLORS.railway),
  industrial: decal(COLORS.industrial),
  roadNormal: decal(COLORS.roadNormal),
  roadWide: decal(COLORS.roadWide),
  roadNarrow: decal(COLORS.roadNarrow),
  buildingMeasured: flat(COLORS.buildingMeasured),
  buildingDefaulted: flat(COLORS.buildingDefaulted),
  buildingGenerated: flat(COLORS.buildingGenerated),
  buildable: decal(COLORS.buildable, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  zoneWater: decal(COLORS.zoneWater, ZONE),
  zoneSteep: decal(COLORS.zoneSteep, ZONE),
  zoneLanduse: decal(COLORS.zoneLanduse, ZONE),
  zoneSetback: decal(COLORS.zoneSetback, ZONE),
  // Block outlines are lines, so no shade. Dashes are in metres (the scene's unit); `computeLineDistances()` on each line makes them show.
  blockOutline: new THREE.LineDashedMaterial({ color: COLORS.blockOutline, dashSize: 4, gapSize: 2 }),
  blockOutlineFaint: new THREE.LineDashedMaterial({ color: COLORS.blockOutline, dashSize: 0.6, gapSize: 2.4, transparent: true, opacity: 0.45 }),
  blockOutlineReference: new THREE.LineDashedMaterial({ color: COLORS.blockReference, dashSize: 10, gapSize: 2 }),
  blockOutlineSelected: new THREE.LineBasicMaterial({ color: COLORS.blockSelected }),
  route: flat(COLORS.route, { side: THREE.DoubleSide }),
  origin: flat(COLORS.origin),
  destination: flat(COLORS.destination),
  pin: flat(COLORS.pin),
  pinRing: decal(COLORS.pin, { side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
  // A wireframe, not faces: no shade.
  waiting: new THREE.MeshBasicMaterial({ color: COLORS.waiting, wireframe: true }),
  // Building edge lines, shared by every building: lines, so no shade.
  edge: new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.35 }),
};

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

/** The shading of a generation zone, by reason. */
export const zoneMaterial = (reason: string): THREE.Material =>
  reason === "water" ? MATERIALS.zoneWater : reason === "steep" ? MATERIALS.zoneSteep : reason === "landuse" ? MATERIALS.zoneLanduse : MATERIALS.zoneSetback;
