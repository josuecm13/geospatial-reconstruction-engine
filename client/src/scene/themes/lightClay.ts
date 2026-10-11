import type { Theme, ThemeColors } from "./types";

/** Light clay: a pale clay model, lit by the sun. Warm off-white buildings on a soft grey ground. */
export const LIGHT_CLAY_COLORS: ThemeColors = {
  ground: "#cdc9c0",
  green: "#97ad86",
  water: "#6f93b0",
  forest: "#738f66",
  farmland: "#b3a873",
  cemetery: "#93a394",
  railway: "#8d8a8b",
  industrial: "#a4978a",
  roadNormal: "#9a968f",
  roadWide: "#85817b",
  roadNarrow: "#aeaaa2",
  buildingMeasured: "#f2ece0",
  // A little greyer: the height was assumed.
  buildingDefaulted: "#cac4b9",
  // A pale cool tint: generated, not observed.
  buildingGenerated: "#7fa3c9",
  buildable: "#d9efe9",
  blockOutline: "#1f6f68",
  blockSelected: "#7a4b00",
  blockReference: "#d3c6ff",
  zoneWater: "#5fb0ee",
  zoneSteep: "#f08a58",
  zoneLanduse: "#a5d96a",
  zoneSetback: "#f2d56a",
  gridCenter: "#7b8085",
  gridLine: "#70757a",
  route: "#b8380f",
  origin: "#ffffff",
  destination: "#b8380f",
  pin: "#a0186a",
  waiting: "#e8e4dc",
  edge: "#4d4a44",
};

export const lightClay: Theme = {
  id: "light-clay",
  label: "Light clay",
  colors: LIGHT_CLAY_COLORS,
  sky: { zenith: "#5f9bd8", horizon: "#c9dff0", below: "#aab4bb" },
  skies: {
    dawn: { zenith: "#6f86b8", horizon: "#f3b49a", below: "#8a7f86" },
    midday: { zenith: "#5f9bd8", horizon: "#c9dff0", below: "#aab4bb" },
    "golden-hour": { zenith: "#6a7fae", horizon: "#f0a45e", below: "#7d6a5c" },
    night: { zenith: "#0b1226", horizon: "#1f2b4a", below: "#0f141f" },
  },
  fog: { color: "#c9dff0", near: 700, far: 5000 },
  mode: "lit",
  followsSun: true,
  windows: "night",
  windowColors: { warm: "#ffc25a", cool: "#bcd8ff" },
};
