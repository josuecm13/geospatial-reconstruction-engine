import { blocked, type FootprintIndex, type Point } from "./collision";
import type { Terrain } from "./terrain";

/** A point in the scene's frame (y up, north is -z). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How long the orbit target takes to reach the pin, in milliseconds. */
export const EASE_MS = 400;

/** Smoothstep: 0 at t = 0, 1 at t = 1, flat at both ends. */
export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** The point `t` (0 to 1) of the way from `from` to `to`, eased. */
export function easeTarget(from: Vec3, to: Vec3, t: number): Vec3 {
  const k = easeInOut(t);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
}

/** A move of the orbit target: `step` is called each frame and returns where the target is now, or
 * null when nothing is moving. Instant (the first step lands on the destination) when `instant()`. */
export interface TargetEase {
  start(from: Vec3, to: Vec3): void;
  step(deltaMs: number): Vec3 | null;
}

export function createTargetEase(instant: () => boolean, durationMs = EASE_MS): TargetEase {
  let from: Vec3 | undefined;
  let to: Vec3 | undefined;
  let elapsed = 0;
  return {
    start(a, b) {
      from = a;
      to = b;
      elapsed = instant() ? durationMs : 0;
    },
    step(deltaMs) {
      if (!from || !to) return null;
      elapsed += deltaMs;
      const at = easeTarget(from, to, elapsed / durationMs);
      if (elapsed >= durationMs) from = to = undefined;
      return at;
    },
  };
}

/** The pin on the ground at local (x, z): its y is the terrain height there (0 on flat ground). */
export function pinOnTerrain(terrain: Terrain | undefined, x: number, z: number): Vec3 {
  return { x, y: terrain?.heightAtLocal(x, z) ?? 0, z };
}

/** `point` when it is open ground, else the nearest open point, searched outwards in rings of
 * `step` metres up to `maxRadius`. Falls back to `point` when nothing within reach is open. */
export function nearestOpenPoint(index: FootprintIndex, point: Point, step = 1, maxRadius = 200): Point {
  if (!blocked(index, point)) return point;
  for (let radius = step; radius <= maxRadius; radius += step) {
    const samples = Math.max(8, Math.ceil((2 * Math.PI * radius) / step));
    let best: Point | undefined;
    let bestDistance = Infinity;
    for (let i = 0; i < samples; i++) {
      const angle = (2 * Math.PI * i) / samples;
      const candidate = { x: point.x + radius * Math.cos(angle), z: point.z + radius * Math.sin(angle) };
      if (blocked(index, candidate)) continue;
      const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (best) return best;
  }
  return point;
}

/** Where walk mode starts for a pin: the pin, or the nearest open point when it is inside a
 * footprint, at eye height on the terrain; facing the camera's horizontal direction. A camera
 * looking straight down has no horizontal direction, so it faces north. */
export function walkStart(
  pin: Point,
  cameraDirection: Vec3,
  index: FootprintIndex | undefined,
  eye: (x: number, z: number) => number,
): { position: Vec3; lookAt: Vec3 } {
  const open = index ? nearestOpenPoint(index, pin) : pin;
  const length = Math.hypot(cameraDirection.x, cameraDirection.z);
  const heading = length < 1e-6 ? { x: 0, z: -1 } : { x: cameraDirection.x / length, z: cameraDirection.z / length };
  const y = eye(open.x, open.z);
  return { position: { x: open.x, y, z: open.z }, lookAt: { x: open.x + heading.x, y, z: open.z + heading.z } };
}
