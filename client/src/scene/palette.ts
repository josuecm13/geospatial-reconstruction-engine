import * as THREE from "three";
import { shade } from "./shading";

/** Every color and shared material of the scene, the only place a scene color is written. One material per kind, never one per mesh. */
export const COLORS = {
  ground: "#1b2024",
  green: "#34503d",
  water: "#22405a",
  roadNormal: "#3e454c",
  roadWide: "#4b535b",
  roadNarrow: "#343a40",
  buildingMeasured: "#ddd6c9",
  // Dimmer and cool: the height was assumed, not stated by the source.
  buildingDefaulted: "#8e959c",
  buildable: "#4fb3a9",
  gridCenter: "#3a4147",
  gridLine: "#2a3035",
  route: "#ff6b3d",
  origin: "#e8e4dc",
  destination: "#ff6b3d",
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

export const MATERIALS = {
  ground: decal(COLORS.ground),
  green: decal(COLORS.green),
  water: decal(COLORS.water),
  roadNormal: decal(COLORS.roadNormal),
  roadWide: decal(COLORS.roadWide),
  roadNarrow: decal(COLORS.roadNarrow),
  buildingMeasured: flat(COLORS.buildingMeasured),
  buildingDefaulted: flat(COLORS.buildingDefaulted),
  buildable: decal(COLORS.buildable, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  route: flat(COLORS.route, { side: THREE.DoubleSide }),
  origin: flat(COLORS.origin),
  destination: flat(COLORS.destination),
  // A wireframe, not faces: no shade.
  waiting: new THREE.MeshBasicMaterial({ color: COLORS.waiting, wireframe: true }),
  // Building edge lines, shared by every building: lines, so no shade.
  edge: new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.35 }),
};

export const roadMaterial = (laneType: string) =>
  laneType === "wide" ? MATERIALS.roadWide : laneType === "narrow" ? MATERIALS.roadNarrow : MATERIALS.roadNormal;
