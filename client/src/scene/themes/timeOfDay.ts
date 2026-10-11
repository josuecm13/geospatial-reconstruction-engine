import type { Sky, TimeOfDay } from "./types";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The light of one time of day. Colours are hex strings; the direction is a unit vector pointing toward the sun (x east, y up, z south). */
export interface Lighting {
  sunDirection: Vec3;
  sunColor: string;
  sunIntensity: number;
  /** The hemisphere light: the sky's colour from above, the ground's from below. */
  skyColor: string;
  groundColor: string;
  hemisphereIntensity: number;
  /** 0 by day, 1 at night: windows glow by it, and the dome draws the moon instead of the sun. */
  night: number;
}

/** The unit vector toward a point `elevation` degrees above the horizon, `heading` degrees from east toward south (east 0, south 90, west 180, north 270). */
function toward(elevation: number, heading: number): Vec3 {
  const [e, h] = [(elevation * Math.PI) / 180, (heading * Math.PI) / 180];
  return { x: Math.cos(e) * Math.cos(h), y: Math.sin(e), z: Math.cos(e) * Math.sin(h) };
}

/**
 * Intensities are scaled for three.js's physically based lights, whose diffuse term divides by pi: a sun of about 2.2
 * on an upward face plus the sky light lands near white at midday.
 */
export const LIGHTING: Readonly<Record<TimeOfDay, Lighting>> = {
  // Low in the east, pink-orange.
  dawn: { sunDirection: toward(8, 0), sunColor: "#ff9f7a", sunIntensity: 1.5, skyColor: "#f2b5a0", groundColor: "#4a3a44", hemisphereIntensity: 0.75, night: 0 },
  // High and a little south, near-white.
  midday: { sunDirection: toward(65, 90), sunColor: "#fffaf0", sunIntensity: 2.2, skyColor: "#cfe4ff", groundColor: "#6b665e", hemisphereIntensity: 0.9, night: 0 },
  // Low in the west, deep amber.
  "golden-hour": { sunDirection: toward(12, 180), sunColor: "#ff9a3c", sunIntensity: 1.9, skyColor: "#f5b87a", groundColor: "#3e2f2a", hemisphereIntensity: 0.6, night: 0 },
  // Cool, dim moonlight.
  night: { sunDirection: toward(35, 300), sunColor: "#8fa8d8", sunIntensity: 0.6, skyColor: "#4a6096", groundColor: "#10131c", hemisphereIntensity: 1.4, night: 1 },
};

/** `t` of the way from hex colour `a` to `b`, as a hex colour (blended per channel in sRGB, which at these distances reads the same). */
export function lerpHex(a: string, b: string, t: number): string {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  const channel = (shift: number) => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

/** The unit direction `t` of the way from `a` to `b` along the arc between them (a straight blend when they are nearly the same or opposite). */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const angle = Math.acos(dot);
  const sin = Math.sin(angle);
  const [wa, wb] = sin < 1e-6 ? [1 - t, t] : [Math.sin((1 - t) * angle) / sin, Math.sin(t * angle) / sin];
  const v = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** `t` of the way from `a` to `b`: colours and numbers lerped, the sun's direction slerped. */
export function blendLighting(a: Lighting, b: Lighting, t: number): Lighting {
  return {
    sunDirection: slerp(a.sunDirection, b.sunDirection, t),
    sunColor: lerpHex(a.sunColor, b.sunColor, t),
    sunIntensity: mix(a.sunIntensity, b.sunIntensity, t),
    skyColor: lerpHex(a.skyColor, b.skyColor, t),
    groundColor: lerpHex(a.groundColor, b.groundColor, t),
    hemisphereIntensity: mix(a.hemisphereIntensity, b.hemisphereIntensity, t),
    night: mix(a.night, b.night, t),
  };
}

/** `t` of the way from sky `a` to `b`. */
export function blendSky(a: Sky, b: Sky, t: number): Sky {
  return { zenith: lerpHex(a.zenith, b.zenith, t), horizon: lerpHex(a.horizon, b.horizon, t), below: lerpHex(a.below, b.below, t) };
}
