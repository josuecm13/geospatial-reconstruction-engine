import * as THREE from "three";
import { shade } from "./shading";

/** Every color and shared material of the scene, the only place a scene color is written. One material per kind, never one per mesh. */
export const COLORS = {
  ground: "#e6e1d8",
  green: "#bccaa8",
  water: "#a7c0cc",
  roadNormal: "#cdc7bc",
  roadWide: "#bfb8ab",
  roadNarrow: "#d8d3ca",
  buildingMeasured: "#f6f3ee",
  // Cool grey against the warm white: the height was assumed, not stated by the source.
  buildingDefaulted: "#d5d6d8",
  buildable: "#5f9e98",
  gridCenter: "#cfc9be",
  gridLine: "#d9d4ca",
  route: "#e4572e",
  origin: "#2e3a40",
  destination: "#e4572e",
  // The waiting wireframe of a staged build.
  waiting: "#2e3a40",
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
  buildable: decal(COLORS.buildable, { transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  route: flat(COLORS.route, { side: THREE.DoubleSide }),
  origin: flat(COLORS.origin),
  destination: flat(COLORS.destination),
  // A wireframe, not faces: no shade.
  waiting: new THREE.MeshBasicMaterial({ color: COLORS.waiting, wireframe: true }),
};

export const roadMaterial = (laneType: string) =>
  laneType === "wide" ? MATERIALS.roadWide : laneType === "narrow" ? MATERIALS.roadNarrow : MATERIALS.roadNormal;
