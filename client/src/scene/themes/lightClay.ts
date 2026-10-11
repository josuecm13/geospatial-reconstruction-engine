import type { Theme, ThemeColors } from "./types";

/** Light clay: a pale clay model, lit by the sun. Warm off-white buildings on a soft grey ground. */
export const LIGHT_CLAY_COLORS: ThemeColors = {
  ground: "#64686c",
  green: "#a3b894",
  water: "#7aa1bd",
  forest: "#7fa47a",
  farmland: "#c2b987",
  cemetery: "#a9b8ac",
  railway: "#a3a1a6",
  industrial: "#b7a79b",
  roadNormal: "#9a9ea3",
  roadWide: "#b3b7bb",
  roadNarrow: "#83888d",
  buildingMeasured: "#f0eadd",
  // A little greyer: the height was assumed.
  buildingDefaulted: "#a39e94",
  // A pale cool tint: generated, not observed.
  buildingGenerated: "#a8c6e4",
  buildable: "#d9efe9",
  blockOutline: "#e6f4ff",
  blockSelected: "#ffe08a",
  blockReference: "#d3c6ff",
  zoneWater: "#5fb0ee",
  zoneSteep: "#f08a58",
  zoneLanduse: "#a5d96a",
  zoneSetback: "#f2d56a",
  gridCenter: "#7b8085",
  gridLine: "#70757a",
  route: "#ffb866",
  origin: "#ffffff",
  destination: "#ffb866",
  pin: "#ffd166",
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
};
