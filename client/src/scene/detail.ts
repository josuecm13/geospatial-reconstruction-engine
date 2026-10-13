import type { Local } from "./projection";

/** How much of a cell is drawn: `near` is everything (edges too), `mid` drops the edges, `far` swaps the buildings for boxes. */
export type DetailLevel = "near" | "mid" | "far";

/** A cell whose bounding radius shows at least this many CSS pixels on screen is `near` (a 106 m radius at 1080 px high and 50 degrees: about 800 m away). */
export const DETAIL_NEAR_PX = 150;
/** A cell below this is `far`: boxes only (the same cell: about 2.2 km away). */
export const DETAIL_FAR_PX = 55;
/** Hysteresis: a cell moves up only at a threshold times (1 + band), and down only below the threshold times (1 - band), so one sitting on a boundary doesn't flicker. */
export const DETAIL_BAND = 0.15;
/** `applyDetail` re-evaluates at most this often (about 5 Hz). */
export const DETAIL_INTERVAL_MS = 200;
/** A super-cell is this many cells on a side (4 x 150 m = 600 m): the unit the far boxes are merged and shown by. */
export const SUPER_CELLS = 4;
/** The thinnest side a box gets, metres (a degenerate footprint, a segment or a point, is still drawn). */
export const MIN_BOX_SIDE = 0.1;

/** Half the cell's size on screen, in CSS pixels: the bounding radius over the distance, scaled by the viewport height and the vertical field of view (so a narrow lens reads bigger). */
export function projectedRadius(radius: number, distance: number, viewportHeight: number, fovDegrees: number): number {
  return (radius / Math.max(distance, 1e-6)) * (viewportHeight / 2 / Math.tan((fovDegrees * Math.PI) / 360));
}

const RANK: DetailLevel[] = ["far", "mid", "near"];
/** The size from which a level is wanted, by rank: `far` has none, `mid` starts at DETAIL_FAR_PX and `near` at DETAIL_NEAR_PX. */
const FLOOR = [0, DETAIL_FAR_PX, DETAIL_NEAR_PX];

/**
 * The level for a cell `sizePx` big (`projectedRadius`). Given the level it had before, a threshold is crossed only
 * through its band: up at `floor * (1 + DETAIL_BAND)`, down below `floor * (1 - DETAIL_BAND)`. A cell with no history
 * is taken at the plain thresholds.
 */
export function detailLevel(sizePx: number, previous?: DetailLevel): DetailLevel {
  if (!previous) return sizePx >= DETAIL_NEAR_PX ? "near" : sizePx >= DETAIL_FAR_PX ? "mid" : "far";
  let rank = RANK.indexOf(previous);
  while (rank < 2 && sizePx >= FLOOR[rank + 1] * (1 + DETAIL_BAND)) rank++;
  while (rank > 0 && sizePx < FLOOR[rank] * (1 - DETAIL_BAND)) rank--;
  return RANK[rank];
}

/** The two indices of a cell key like `3,-2`. */
export function parseCellKey(key: string): [number, number] {
  const [i, j] = key.split(",");
  return [Number(i), Number(j)];
}

/** The super-cell (4 x 4 cells) holding cell `key`, as a key like `0,-1`: floored, so `-1,-1` and `0,0` are different ones. */
export function superKey(key: string): string {
  const [i, j] = parseCellKey(key);
  return `${Math.floor(i / SUPER_CELLS)},${Math.floor(j / SUPER_CELLS)}`;
}

/** A rectangle on the ground: its centre, its long side `width` along the direction at `angle` (radians from +x toward +z, in [0, pi)) and its short side `depth` across. */
export interface GroundRect {
  x: number;
  z: number;
  width: number;
  depth: number;
  angle: number;
}

/** The convex hull of the points (Andrew's monotone chain), counter-clockwise in x, z, without its closing point. */
export function convexHull(points: Local[]): Local[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;
  const cross = (o: Local, a: Local, b: Local) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list: Local[]) => {
    const out: Local[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The minimum-area rectangle around a footprint's rings (one side lies along an edge of the convex hull, so every hull
 * edge is tried), long side first. A footprint with no area (a point, a segment) gets a `MIN_BOX_SIDE` thick one;
 * `null` for no points at all.
 */
export function minAreaRect(rings: Local[][]): GroundRect | null {
  const hull = convexHull(rings.flat());
  if (!hull.length) return null;
  if (hull.length < 3) {
    const [a, b] = [hull[0], hull[hull.length - 1]];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const angle = length > 0 ? (Math.atan2(b.z - a.z, b.x - a.x) + Math.PI) % Math.PI : 0;
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, width: Math.max(length, MIN_BOX_SIDE), depth: MIN_BOX_SIDE, angle };
  }
  let best: GroundRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    const [ux, uz] = [(b.x - a.x) / length, (b.z - a.z) / length];
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of hull) {
      const u = p.x * ux + p.z * uz;
      const v = -p.x * uz + p.z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area >= bestArea - 1e-9) continue;
    bestArea = area;
    const [mu, mv] = [(minU + maxU) / 2, (minV + maxV) / 2];
    let [width, depth, angle] = [maxU - minU, maxV - minV, Math.atan2(uz, ux)];
    if (depth > width) [width, depth, angle] = [depth, width, angle + Math.PI / 2];
    angle = ((angle % Math.PI) + Math.PI) % Math.PI;
    if (angle > Math.PI - 1e-9) angle = 0;
    best = { x: mu * ux - mv * uz, z: mu * uz + mv * ux, width: Math.max(width, MIN_BOX_SIDE), depth: Math.max(depth, MIN_BOX_SIDE), angle };
  }
  return best;
}

/** Numbers per box in a chunk's `userData.boxes`: x, z, width, depth, angle, lift above the chunk's origin, height. */
export const BOX_STRIDE = 7;

/** One rectangle per outer ring, flat as `BOX_STRIDE` numbers each: what a chunk keeps (`userData.boxes`) to build its far boxes from later. */
export function boxesOf(rings: Local[][], lift: number, height: number): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    const rect = minAreaRect([ring]);
    if (rect) out.push(rect.x, rect.z, rect.width, rect.depth, rect.angle, lift, height);
  }
  return out;
}

/** Vertices of one box: 12 triangles, non-indexed. */
export const BOX_VERTICES = 36;

type Point = [number, number, number];

/**
 * Appends the boxes (`BOX_STRIDE` numbers each, see `boxesOf`) as triangles to `positions` (x y z per vertex), every
 * face wound outward, standing `yOffset` higher (the chunk's own `position.y`), and each vertex's `baseLift` (the box's
 * base above y = 0) to `lifts`.
 */
export function appendBoxes(positions: number[], lifts: number[], boxes: ArrayLike<number>, yOffset: number): void {
  for (let k = 0; k + BOX_STRIDE - 1 < boxes.length; k += BOX_STRIDE) {
    const [cx, cz, width, depth, angle, lift, height] = [boxes[k], boxes[k + 1], boxes[k + 2], boxes[k + 3], boxes[k + 4], boxes[k + 5], boxes[k + 6]];
    const [y0, y1] = [yOffset + lift, yOffset + lift + height];
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => [cx + (a * width * cos - b * depth * sin) / 2, cz + (a * width * sin + b * depth * cos) / 2]);
    const point = (i: number, top: boolean): Point => [corners[i][0], top ? y1 : y0, corners[i][1]];
    const centre: Point = [cx, (y0 + y1) / 2, cz];
    const quad = (a: Point, b: Point, c: Point, d: Point) => {
      // The normal of (a, b, c) must face away from the box's centre; otherwise the quad is wound the other way.
      const n = [
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      ];
      const outward = n[0] * (a[0] - centre[0]) + n[1] * (a[1] - centre[1]) + n[2] * (a[2] - centre[2]) > 0;
      for (const p of outward ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) positions.push(p[0], p[1], p[2]);
    };
    quad(point(0, true), point(1, true), point(2, true), point(3, true));
    quad(point(0, false), point(1, false), point(2, false), point(3, false));
    for (let i = 0; i < 4; i++) quad(point(i, false), point((i + 1) % 4, false), point((i + 1) % 4, true), point(i, true));
    for (let v = 0; v < BOX_VERTICES; v++) lifts.push(yOffset + lift);
  }
}
