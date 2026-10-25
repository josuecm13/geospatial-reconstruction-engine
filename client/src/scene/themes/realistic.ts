import type { Theme, ThemeColors } from "./types";

/**
 * Realistic: textured buildings and ground, lit by the sun, in a slightly hazy low-poly look.
 *
 * The building colours here are what the textured materials roughly render (the facade's base colour times the
 * kind's tint, in `textures.tints`); the legibility guards read these.
 */
export const REALISTIC_COLORS: ThemeColors = {
  ground: "#bdb6a2",
  green: "#4f7d3a",
  water: "#2f5f8a",
  forest: "#2f5a2c",
  farmland: "#8e7a3c",
  cemetery: "#7f9a82",
  railway: "#6c6a6e",
  industrial: "#9a8a7a",
  roadNormal: "#4a4a4c",
  roadWide: "#3a3a3c",
  roadNarrow: "#5c5c5e",
  buildingMeasured: "#d2b8a0",
  buildingDefaulted: "#b0a090",
  buildingGenerated: "#6e7f96",
  buildable: "#d9efe9",
  blockOutline: "#14615a",
  blockSelected: "#7a4b00",
  blockReference: "#d3c6ff",
  zoneWater: "#5fb0ee",
  zoneSteep: "#f08a58",
  zoneLanduse: "#a5d96a",
  zoneSetback: "#f2d56a",
  gridCenter: "#8a8578",
  gridLine: "#7d786c",
  route: "#b32414",
  origin: "#ffffff",
  destination: "#b32414",
  pin: "#a0186a",
  waiting: "#e8e4dc",
  edge: "#4d4a44",
};

export const realistic: Theme = {
  id: "realistic",
  label: "Realistic",
  colors: REALISTIC_COLORS,
  sky: { zenith: "#7fa6cf", horizon: "#d6dad4", below: "#a9aea8" },
  skies: {
    dawn: { zenith: "#7d90b8", horizon: "#e8c0a8", below: "#8d8588" },
    midday: { zenith: "#7fa6cf", horizon: "#d6dad4", below: "#a9aea8" },
    "golden-hour": { zenith: "#7a88ae", horizon: "#e6b078", below: "#85705f" },
    night: { zenith: "#0d1428", horizon: "#27324e", below: "#12161f" },
  },
  // Hazy: the far edge of the world fades into the sky well before the clay themes' does.
  fog: { color: "#d6dad4", near: 250, far: 2600 },
  mode: "lit",
  followsSun: true,
  windows: "night",
  windowColors: { warm: "#ffc25a", cool: "#bcd8ff" },
  textures: {
    colors: {
      facade: "#d2b8a0",
      roof: "#8a8680",
      // The brightest road tier; the darker ones tint it down.
      asphalt: "#5c5c5e",
      grass: "#4f7d3a",
      forest: "#2f5a2c",
      water: "#2f5f8a",
    },
    // Multiplied into the facade: measured walls as drawn, assumed heights greyer, generated ones cooler.
    tints: { measured: "#ffffff", defaulted: "#c9c0b8", generated: "#8fa8d0" },
  },
};
