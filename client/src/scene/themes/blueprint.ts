import type { Theme, ThemeColors } from "./types";

/** Blueprint: navy paper with cyan line work. Faint building fills, bright edges, a metric grid on the ground. */
export const BLUEPRINT_COLORS: ThemeColors = {
  ground: "#0b2545",
  green: "#1d5a63",
  water: "#2f6fc4",
  forest: "#1b6a52",
  farmland: "#4c6a8c",
  cemetery: "#5a6fa6",
  railway: "#6c7f96",
  industrial: "#7a6a9a",
  roadNormal: "#2b5f94",
  roadWide: "#3a74ad",
  roadNarrow: "#1f4a78",
  buildingMeasured: "#4a90d9",
  buildingDefaulted: "#2f6aa6",
  // Generated buildings: pale cyan, and their edges are dashed.
  buildingGenerated: "#9be7ff",
  buildable: "#3fe0ff",
  blockOutline: "#3fe0ff",
  blockSelected: "#ffe14d",
  blockReference: "#b79cff",
  zoneWater: "#5fa8ff",
  zoneSteep: "#ff9a5c",
  zoneLanduse: "#8fe08a",
  zoneSetback: "#ffd966",
  gridCenter: "#2b5f94",
  gridLine: "#1f4a78",
  route: "#ff8a3d",
  origin: "#ffffff",
  destination: "#ff8a3d",
  pin: "#ffd23f",
  waiting: "#6fa8dc",
  // Building edges: near-white with a blue cast.
  edge: "#d6efff",
  gridMinor: "#17406f",
  gridMajor: "#2c6aa8",
  roadOutline: "#8fd3ff",
};

/** Flat navy paper: no gradient, no sun. */
const PAPER = { zenith: "#0b2545", horizon: "#0b2545", below: "#0b2545" };

export const blueprint: Theme = {
  id: "blueprint",
  label: "Blueprint",
  colors: BLUEPRINT_COLORS,
  sky: PAPER,
  fog: null,
  mode: "line",
  followsSun: false,
  windows: "never",
};
