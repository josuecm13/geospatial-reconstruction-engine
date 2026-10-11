import * as THREE from "three";
import { shade } from "../shading";
import type { Theme, ThemeColors } from "./types";

/** Night clay's colours: the scene's original palette, and the ones the 2D map, the previews and the page read. */
export const NIGHT_CLAY_COLORS: ThemeColors = {
  ground: "#1b2024",
  green: "#34503d",
  water: "#22405a",
  // Land uses that aren't a park: deeper woodland, olive fields, a grey-green cemetery, neutral greys for rail and industry.
  forest: "#2e6b46",
  farmland: "#5c6234",
  cemetery: "#4a5c52",
  railway: "#4c4f55",
  industrial: "#5e5a55",
  roadNormal: "#3e454c",
  roadWide: "#4b535b",
  roadNarrow: "#343a40",
  buildingMeasured: "#ddd6c9",
  // Dimmer and cool: the height was assumed, not stated by the source.
  buildingDefaulted: "#8e959c",
  // Cool blue: generated, not observed. Apart from the pale measured roofs and the grey defaulted ones.
  buildingGenerated: "#8fb8d8",
  buildable: "#4fb3a9",
  // Block outlines: the crisp dashed line of an eligible block, the selected one, and a reference (exemplar) block.
  blockOutline: "#4fb3a9",
  blockSelected: "#ffd166",
  blockReference: "#b7a1ff",
  // Generation zones, by why buildings don't go there.
  zoneWater: "#3d8fd1",
  zoneSteep: "#d9774a",
  zoneLanduse: "#8fbf5a",
  zoneSetback: "#e0c15a",
  gridCenter: "#3a4147",
  gridLine: "#2a3035",
  route: "#ff6b3d",
  origin: "#e8e4dc",
  destination: "#ff6b3d",
  // The Set point pin and its ground ring.
  pin: "#ffd166",
  // The waiting wireframe of a staged build.
  waiting: "#8e959c",
  // The pale outline of each building's edges.
  edge: "#f2eee6",
};

/**
 * The ground colour times the shade of an upward face (`shade(UP)`), as the renderer multiplies it
 * (`THREE.Color` holds linear values, so this is the same product as the vertex-colour multiply).
 * The ground plane renders exactly this colour, so the scene's edge is invisible against it.
 */
export const NIGHT_CLAY_BACKGROUND = `#${new THREE.Color(NIGHT_CLAY_COLORS.ground).multiplyScalar(shade(new THREE.Vector3(0, 1, 0))).getHexString()}`;

export const nightClay: Theme = {
  id: "night-clay",
  label: "Night clay",
  colors: NIGHT_CLAY_COLORS,
  sky: { zenith: NIGHT_CLAY_BACKGROUND, horizon: NIGHT_CLAY_BACKGROUND, below: NIGHT_CLAY_BACKGROUND },
  fog: null,
  mode: "baked",
  followsSun: false,
  windows: "always",
  windowColors: { warm: "#ffc25a", cool: "#bcd8ff" },
};
