import type { Local } from "./projection";

const EPSILON = 1e-6;

/** Drops consecutive points that coincide, so every remaining edge has a direction. */
function distinct(points: Local[]): Local[] {
  const out: Local[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > EPSILON) out.push(p);
  }
  return out;
}

/** One side of the road: the polyline pushed `half` along its left normal (or right, for sign -1), with clamped miter joins. */
function offsetSide(points: Local[], half: number, sign: 1 | -1): Local[] {
  const normals = points.slice(1).map((p, i) => {
    const dx = p.x - points[i].x;
    const dz = p.z - points[i].z;
    const length = Math.hypot(dx, dz);
    return { x: (-dz / length) * sign, z: (dx / length) * sign };
  });
  const side: Local[] = [];
  const push = (p: Local, n: Local) => side.push({ x: p.x + n.x * half, z: p.z + n.z * half });
  push(points[0], normals[0]);
  for (let i = 1; i < points.length - 1; i++) {
    const a = normals[i - 1];
    const b = normals[i];
    const denominator = 1 + a.x * b.x + a.z * b.z; // 1 + cos(turn): zero for a full reversal
    const miter = { x: (a.x + b.x) / denominator, z: (a.z + b.z) / denominator };
    if (denominator > EPSILON && Math.hypot(miter.x, miter.z) <= 2) {
      push(points[i], miter);
    } else {
      // Too sharp: bevel instead, so the join can't spike far past the road.
      push(points[i], a);
      push(points[i], b);
    }
  }
  push(points[points.length - 1], normals[normals.length - 1]);
  return side;
}

/**
 * The outline of a road drawn `width` meters wide along `points`: the left side forward, then the
 * right side backward. Joins are mitered up to 2 x half-width, then beveled. Fewer than two
 * distinct points give an empty outline.
 */
export function roadPolygon(points: Local[], width: number): Local[] {
  const line = distinct(points);
  if (line.length < 2) return [];
  const half = width / 2;
  return [...offsetSide(line, half, 1), ...offsetSide(line, half, -1).reverse()];
}

const round = (p: Local) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;

/**
 * Two-way roads come back as two directed segments, a forward one and its reverse twin. Keeps the
 * first of each pair: an item is dropped when the same street already drew the same geometry in
 * either direction. `lines` is the item's polyline(s) in local meters.
 */
export function dedupeTwins<T>(items: T[], streetId: (item: T) => string, lines: (item: T) => Local[][]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const forward = lines(item).map((line) => line.map(round).join(";")).sort().join("|");
    const backward = lines(item).map((line) => [...line].reverse().map(round).join(";")).sort().join("|");
    const street = streetId(item);
    if (seen.has(`${street}#${forward}`) || seen.has(`${street}#${backward}`)) continue;
    seen.add(`${street}#${forward}`);
    kept.push(item);
  }
  return kept;
}
