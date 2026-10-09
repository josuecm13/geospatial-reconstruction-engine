import * as THREE from "three";
import { COLORS, SCENE_BACKGROUND } from "../scene/palette";
import { shade } from "../scene/shading";

const UP = shade(new THREE.Vector3(0, 1, 0));
/** The south-facing wall of a building, the side the raised preview shows. */
const WALL = shade(new THREE.Vector3(0, 0, 1));
/** How much darker than the face it outlines an edge is drawn. */
const EDGE = 0.7;

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
  edge: withAlpha(clay(COLORS.ground, UP * EDGE), 0.8),
  hatch: withAlpha(clay(COLORS.ground, UP * EDGE), 0.25),
  water: clay(COLORS.water, UP),
  green: clay(COLORS.green, UP),
  block: withAlpha(clay(COLORS.buildable, UP), 0.35),
  roadWide: clay(COLORS.roadWide, UP),
  roadNormal: clay(COLORS.roadNormal, UP),
  roadNarrow: clay(COLORS.roadNarrow, UP),
  building: clay(COLORS.buildingMeasured, UP),
  buildingWall: clay(COLORS.buildingMeasured, WALL),
  buildingDefaulted: clay(COLORS.buildingDefaulted, UP),
  buildingDefaultedWall: clay(COLORS.buildingDefaulted, WALL),
  buildingEdge: clay(COLORS.buildingMeasured, UP * EDGE * EDGE),
} as const;
