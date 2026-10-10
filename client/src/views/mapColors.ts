import * as THREE from "three";
import { COLORS } from "../scene/palette";

/**
 * How far the scene's road, water and green colours are lifted toward `COLORS.edge` for the 2D basemap (a linear-space
 * mix, so the tiers keep their order). The 3D palette's dark colours are only 1.7-2.5:1 against the basemap's #0c0c0c;
 * at 0.1 every road tier is 3.2:1 or more, in order (wide 3.9, normal 3.5, narrow 3.2), and water and green 3.3 and 3.7.
 */
export const MAP_LIFT = 0.1;
export const lifted = (color: string): string => `#${new THREE.Color(color).lerp(new THREE.Color(COLORS.edge), MAP_LIFT).getHexString()}`;

/**
 * Every paint colour of the 2D map's overlays (mapDataLayers.ts, boundaries/boundaryTool.ts,
 * importing/rectangleTool.ts), the only place one is written. They sit on the dark basemap. Where a role
 * matches the 3D scene (water, green, road tiers, buildings, buildable) the colour is the scene palette's,
 * so the two views agree; the rest are chosen to read on dark.
 */
export const MAP_COLORS = {
  water: lifted(COLORS.water),
  green: lifted(COLORS.green),
  roadWide: lifted(COLORS.roadWide),
  roadNormal: lifted(COLORS.roadNormal),
  roadNarrow: lifted(COLORS.roadNarrow),
  buildingMeasured: COLORS.buildingMeasured,
  // Dimmer and cool, as in 3D: the height was assumed.
  buildingDefaulted: COLORS.buildingDefaulted,
  buildingOutline: COLORS.edge,
  buildable: COLORS.buildable,
  buildableOutline: COLORS.buildable,
  blockMedian: "#c9a24a",
  poi: "#f06292",
  poiStroke: COLORS.edge,
  /** The boundary being traced: warm orange, distinct from the route's `--accent`. */
  boundaryDraft: "#f5a524",
  /** Saved boundaries. */
  boundarySaved: "#b388ff",
  /** The vertex dots and selection handles. */
  handleFill: COLORS.edge,
  /** The selection rectangle: the UI's link blue, and the danger red when it is too large. */
  selection: "#7db7f0",
  selectionTooLarge: "#ff8f80",
} as const;
