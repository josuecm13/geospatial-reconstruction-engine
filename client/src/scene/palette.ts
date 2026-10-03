import * as THREE from "three";

/** Every color and shared material of the scene. One material per kind, never one per mesh. */
export const COLORS = {
  ground: "#d9d4c7",
  green: "#9fd08a",
  water: "#7fb8e6",
  roadNormal: "#f4f1ea",
  roadWide: "#e0a33a",
  roadNarrow: "#b9b9b9",
  buildingMeasured: "#6f5a8c",
  // Paler, as on the 2D map: the height was assumed, not stated by the source.
  buildingDefaulted: "#b7a8c9",
  buildable: "#e8b84a",
} as const;

const flat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** Ground-level layers write no depth: their draw order (LAYER_ORDER in buildWorld.ts) decides what shows on top. */
const decal = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => flat(color, { depthWrite: false, ...extra });

export const MATERIALS = {
  ground: decal(COLORS.ground),
  green: decal(COLORS.green),
  water: decal(COLORS.water),
  roadNormal: decal(COLORS.roadNormal),
  roadWide: decal(COLORS.roadWide),
  roadNarrow: decal(COLORS.roadNarrow),
  buildingMeasured: flat(COLORS.buildingMeasured),
  buildingDefaulted: flat(COLORS.buildingDefaulted),
  buildable: decal(COLORS.buildable, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
};

export const roadMaterial = (laneType: string) =>
  laneType === "wide" ? MATERIALS.roadWide : laneType === "narrow" ? MATERIALS.roadNarrow : MATERIALS.roadNormal;
