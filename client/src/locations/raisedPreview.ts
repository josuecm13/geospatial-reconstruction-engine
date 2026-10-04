/**
 * The tilted ("raised") view of a location preview, as pure geometry: numbers in, numbers out.
 *
 * At tilt amount `t` (0 = top-down, 1 = fully raised) the ground is foreshortened vertically by `cos(angle)`
 * around the canvas centre, and a point `h` metres up is lifted `h * pxPerMetre * sin(angle)` pixels up the screen,
 * where `angle = t * MAX_TILT`. Screen y grows downward, so "near" the viewer is a larger y.
 */

export type Point = [number, number];

/** The tilt reached at `t = 1`: 55 degrees off straight down. */
export const MAX_TILT = (55 * Math.PI) / 180;

export interface RaiseView {
  /** Tilt amount, 0 (top-down) to 1 (fully raised). */
  t: number;
  /** The screen y the ground is foreshortened around (the canvas centre). */
  pivotY: number;
  /** Pixels per metre on the flat picture. */
  pxPerMetre: number;
}

/** A building's footprint in flat canvas pixels (outer ring) with its height in metres. */
export interface FlatBuilding {
  ring: Point[];
  height: number;
}

export interface RaisedBuilding {
  /** Wall quads (four points each) of the edges facing the viewer. */
  walls: Point[][];
  /** The footprint lifted to the building's height. */
  roof: Point[];
}

export function tiltAngle(t: number): number {
  return Math.min(1, Math.max(0, t)) * MAX_TILT;
}

/** The vertical scale of the ground at tilt amount `t`: 1 top-down, `cos(MAX_TILT)` fully raised. */
export function groundScale(t: number): number {
  return Math.cos(tiltAngle(t));
}

/** Ease-out (cubic): fast at first, settling at the end. Clamped to 0..1. */
export function easeOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - (1 - p) ** 3;
}

/** A flat canvas point `height` metres above the ground, as it appears at the view's tilt. */
export function raisePoint(view: RaiseView, [x, y]: Point, height = 0): Point {
  const angle = tiltAngle(view.t);
  return [x, view.pivotY + (y - view.pivotY) * groundScale(view.t) - height * view.pxPerMetre * Math.sin(angle)];
}

/** Twice the signed area of a ring (shoelace); the sign says which way it winds. */
function signedArea2(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** The ring without a repeated closing point. */
function openRing(ring: Point[]): Point[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1);
  return ring;
}

/** Centroid y of a ring's vertices on the flat picture: the key buildings are sorted by. */
export function centroidY(ring: Point[]): number {
  const pts = openRing(ring);
  return pts.length ? pts.reduce((sum, p) => sum + p[1], 0) / pts.length : 0;
}

/** Orders buildings far to near (top of the picture first), so nearer ones paint over farther ones. Does not mutate. */
export function sortFarToNear<T extends FlatBuilding>(buildings: T[]): T[] {
  return buildings
    .map((b) => ({ b, y: centroidY(b.ring) }))
    .sort((a, b) => a.y - b.y)
    .map((e) => e.b);
}

/** The screen polygons of one building at the view's tilt: viewer-facing walls and the lifted roof. */
export function raiseBuilding(view: RaiseView, building: FlatBuilding): RaisedBuilding {
  const ring = openRing(building.ring);
  if (ring.length < 3) return { walls: [], roof: [] };
  // For a ring winding with positive area the outward normal of edge (dx, dy) is (dy, -dx); otherwise (-dy, dx).
  // It faces the viewer when its y component is positive, which foreshortening does not change.
  const winding = Math.sign(signedArea2(ring)) || 1;
  const walls: Point[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const normalY = winding * -(b[0] - a[0]);
    if (normalY <= 0) continue;
    walls.push([raisePoint(view, a), raisePoint(view, b), raisePoint(view, b, building.height), raisePoint(view, a, building.height)]);
  }
  return { walls, roof: ring.map((p) => raisePoint(view, p, building.height)) };
}
