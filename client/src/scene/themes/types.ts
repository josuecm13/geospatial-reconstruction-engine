import type { RealisticColors } from "./textures";

/** The scene's colour roles. Every theme gives each one; the names are the keys of Night clay's palette. */
export interface ThemeColors {
  ground: string;
  green: string;
  water: string;
  forest: string;
  farmland: string;
  cemetery: string;
  railway: string;
  industrial: string;
  roadNormal: string;
  roadWide: string;
  roadNarrow: string;
  buildingMeasured: string;
  buildingDefaulted: string;
  buildingGenerated: string;
  buildable: string;
  blockOutline: string;
  blockSelected: string;
  blockReference: string;
  zoneWater: string;
  zoneSteep: string;
  zoneLanduse: string;
  zoneSetback: string;
  gridCenter: string;
  gridLine: string;
  route: string;
  origin: string;
  destination: string;
  pin: string;
  waiting: string;
  edge: string;
  /** Blueprint only: the ground grid's 10 m and 100 m lines, and the road outlines. */
  gridMinor?: string;
  gridMajor?: string;
  roadOutline?: string;
}

export const TIMES_OF_DAY = ["dawn", "midday", "golden-hour", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** A sky gradient: straight up, at the horizon, and below it. */
export interface Sky {
  zenith: string;
  horizon: string;
  below: string;
}

export type ThemeId = "night-clay" | "light-clay" | "blueprint" | "realistic";

export interface Theme {
  id: ThemeId;
  label: string;
  colors: ThemeColors;
  /** The sky gradient: straight up, at the horizon, and below it. */
  sky: Sky;
  /** For a theme that follows the sun: its sky at each time of day. Without it, `sky` serves every time. */
  skies?: Record<TimeOfDay, Sky>;
  /** Distance fog. The atmosphere colours it as the sky's horizon, so `color` only matters for the first frame; near and far are metres. */
  fog: { color: string; near: number; far: number } | null;
  /** How materials are drawn: shade baked into vertex colours, lit by lights, or line work. */
  mode: "baked" | "lit" | "line";
  followsSun: boolean;
  /** When building windows glow. */
  windows: "always" | "night" | "never";
  /** Lit-window colours: warm for real buildings, cool for generated ones. */
  windowColors?: { warm: string; cool: string };
  /** Realistic only: the base colours its procedural textures are drawn in, and the tint each kind of building multiplies into the facade. */
  textures?: {
    colors: RealisticColors;
    tints: { measured: string; defaulted: string; generated: string };
  };
}
