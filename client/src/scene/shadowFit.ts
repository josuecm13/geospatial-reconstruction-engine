import type { Vec3 } from "./themes/timeOfDay";

export const MIN_HALF_SIZE = 150;
export const MAX_HALF_SIZE = 1500;
/** How much of the camera's distance to the orbit target the shadow box covers on each side of the target. */
const HALF_SIZE_PER_DISTANCE = 0.8;
/** The half-size moves in geometric steps of this ratio from the minimum, so zooming redraws the shadow map only when it crosses one. */
export const HALF_SIZE_STEP = 1.25;

/** The smallest step 150 * 1.25^k that is at least `wanted`, so the box still covers the view. */
export const quantiseHalfSize = (wanted: number) => {
  const k = Math.ceil(Math.log(wanted / MIN_HALF_SIZE) / Math.log(HALF_SIZE_STEP) - 1e-9);
  return MIN_HALF_SIZE * Math.pow(HALF_SIZE_STEP, Math.max(0, k));
};

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/** The axes of the sun's shadow camera as three.js builds it (at the sun, looking at the target, world up): its right and up in world space. */
export function lightAxes(sunDirection: Vec3): { right: Vec3; up: Vec3 } {
  const s = unit(sunDirection);
  const reference = Math.abs(s.y) > 0.999 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
  const right = unit(cross(reference, s));
  return { right, up: cross(s, right) };
}

/**
 * The orthographic shadow box that covers the view: centred on the orbit target, with a half-size of 0.8 times the
 * camera's distance to it, rounded up to a step of 150 m * 1.25^k and clamped to 150-1500 m. The centre is snapped to whole shadow texels across the light's view
 * (one texel is 2 * halfSize / mapSize), so the shadow edges don't shimmer as the target moves.
 */
export function fitShadow(target: Vec3, distance: number, sunDirection: Vec3, mapSize: number): { centre: Vec3; halfSize: number } {
  const halfSize = Math.min(MAX_HALF_SIZE, quantiseHalfSize(Math.max(MIN_HALF_SIZE, distance * HALF_SIZE_PER_DISTANCE)));
  const texel = (2 * halfSize) / mapSize;
  const { right, up } = lightAxes(sunDirection);
  const [x, y] = [dot(target, right), dot(target, up)];
  const [dx, dy] = [Math.round(x / texel) * texel - x, Math.round(y / texel) * texel - y];
  return {
    centre: { x: target.x + right.x * dx + up.x * dy, y: target.y + right.y * dx + up.y * dy, z: target.z + right.z * dx + up.z * dy },
    halfSize,
  };
}
