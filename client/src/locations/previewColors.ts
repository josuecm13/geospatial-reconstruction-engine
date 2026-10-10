import * as THREE from "three";
import { COLORS, SCENE_BACKGROUND } from "../scene/palette";
import { AMBIENT, LIGHT_DIRECTION, shade } from "../scene/shading";

const UP = shade(new THREE.Vector3(0, 1, 0));
/** The south-facing wall of a building, the side the raised preview shows. */
const WALL = shade(new THREE.Vector3(0, 0, 1));
/** The alpha of the pale `COLORS.edge` strokes over the ground: the area outline is 2.9:1 against it, the hatch a quiet 1.4:1, the building outline in between. */
const OUTLINE_ALPHA = 0.35;
const HATCH_ALPHA = 0.12;
const BUILDING_EDGE_ALPHA = 0.5;
/** How far toward black the shadow is mixed (0.5 is half way): on the dark ground, ambient light alone is a barely visible step (1.10:1). */
const SHADOW_DARKEN = 0.5;

/** A palette colour times a shade, as the 3D scene's vertex colours multiply it. */
const clay = (color: string, factor: number): string => `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`;

/** The same colour with an alpha, for the canvas layers that are translucent. */
const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** The 2D previews' colours, derived from the scene palette and shading so they match what the 3D scene shows. */
export const PREVIEW_COLORS = {
  background: SCENE_BACKGROUND,
  ground: clay(COLORS.ground, UP),
  edge: withAlpha(COLORS.edge, OUTLINE_ALPHA),
  hatch: withAlpha(COLORS.edge, HATCH_ALPHA),
  water: clay(COLORS.water, UP),
  green: clay(COLORS.green, UP),
  roadWide: clay(COLORS.roadWide, UP),
  roadNormal: clay(COLORS.roadNormal, UP),
  roadNarrow: clay(COLORS.roadNarrow, UP),
  building: clay(COLORS.buildingMeasured, UP),
  buildingWall: clay(COLORS.buildingMeasured, WALL),
  buildingDefaulted: clay(COLORS.buildingDefaulted, UP),
  buildingDefaultedWall: clay(COLORS.buildingDefaulted, WALL),
  buildingEdge: withAlpha(COLORS.edge, BUILDING_EDGE_ALPHA),
  /** The ground in a building's shadow: lit by ambient light only, mixed toward black so it stays a visible darker tone. */
  shadow: clay(COLORS.ground, AMBIENT * (1 - SHADOW_DARKEN)),
} as const;

/**
 * Where the top of a `heightMeters` building's shadow lands relative to its roof, in preview pixels (x right/east,
 * y down/south): a point at height h casts its shadow `-(l.x, l.z) * h / l.y` metres along the ground, l being the light.
 */
export function shadowOffset(heightMeters: number, pxPerMetre: number): [number, number] {
  const k = (heightMeters * pxPerMetre) / LIGHT_DIRECTION.y;
  return [-LIGHT_DIRECTION.x * k + 0, -LIGHT_DIRECTION.z * k + 0]; // + 0 turns -0 into 0
}
