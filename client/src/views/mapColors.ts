import { COLORS } from "../scene/palette";

/**
 * Every paint colour of the 2D map's overlays (mapDataLayers.ts, boundaries/boundaryTool.ts,
 * importing/rectangleTool.ts), the only place one is written. They sit on the dark basemap. Where a role
 * matches the 3D scene (water, green, road tiers, buildings, buildable) the colour is the scene palette's,
 * so the two views agree; the rest are chosen to read on dark.
 */
export const MAP_COLORS = {
  water: COLORS.water,
  green: COLORS.green,
  roadWide: COLORS.roadWide,
  roadNormal: COLORS.roadNormal,
  roadNarrow: COLORS.roadNarrow,
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
