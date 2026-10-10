import type { Eligibility } from "../api/types";
import type { Local } from "./projection";

/** How far inside a block's boundary its outline is drawn (metres), so it sits off the road edge and reads as the block's own. */
export const OUTLINE_INSET = 1.5;

/** A miter longer than this many insets is cut back, so a sharp corner can't throw a vertex across the block. */
const MAX_MITER = 3;

/** Points closer than this are one point. */
const SAME_POINT = 1e-6;

/** Twice the signed area of a ring (x, z), positive when it runs counter-clockwise as drawn on x right, z up. */
function signedArea(ring: Local[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return sum;
}

/** The ring without its closing point and without repeated points. */
function open(ring: Local[]): Local[] {
  const points: Local[] = [];
  for (const p of ring) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > SAME_POINT) points.push(p);
  }
  while (points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].z - points[points.length - 1].z) <= SAME_POINT) points.pop();
  return points;
}

const closed = (points: Local[]): Local[] => (points.length ? [...points, points[0]] : points);

/**
 * A ring moved `distance` metres inward: every vertex slides along the bisector of its two edges (a miter,
 * cut back at sharp corners), which keeps the edges parallel to the originals. Winding doesn't matter.
 * Returns a closed ring. A ring too small to inset (the result would collapse or flip) is returned
 * unchanged, closed, so the block still gets an outline.
 */
export function insetRing(ring: Local[], distance: number = OUTLINE_INSET): Local[] {
  const points = open(ring);
  if (points.length < 3) return closed(points);
  const area = signedArea(points);
  if (area === 0) return closed(points);
  // The left normal of a direction (dx, dz) is (-dz, dx); it points inward for a counter-clockwise ring.
  const side = area > 0 ? 1 : -1;
  const moved = points.map((p, i) => {
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const unit = (a: Local, b: Local) => {
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    };
    const d1 = unit(previous, p);
    const d2 = unit(p, next);
    const n1 = { x: -d1.z * side, z: d1.x * side };
    const n2 = { x: -d2.z * side, z: d2.x * side };
    const along = 1 + n1.x * n2.x + n1.z * n2.z; // 1 + cos(turn); near 0 when the edge doubles back
    let sx = n1.x + n2.x;
    let sz = n1.z + n2.z;
    let scale = along > 1e-6 ? 1 / along : MAX_MITER;
    const length = Math.hypot(sx, sz) * scale;
    if (length > MAX_MITER) scale *= MAX_MITER / length;
    sx *= scale;
    sz *= scale;
    return { x: p.x + sx * distance, z: p.z + sz * distance };
  });
  const after = signedArea(moved);
  // Collapsed, flipped, or barely there: the block is too narrow for an inset outline.
  if (Math.sign(after) !== Math.sign(area) || Math.abs(after) < Math.abs(area) * 0.05) return closed(points);
  return closed(moved);
}

/** A closed ring with points added so no edge is longer than `maxStep` metres (a draped line needs a vertex per grid cell). */
export function densify(ring: Local[], maxStep: number): Local[] {
  if (ring.length < 2 || !(maxStep > 0)) return ring;
  const out: Local[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxStep));
    for (let k = 1; k <= parts; k++) out.push({ x: a.x + ((b.x - a.x) * k) / parts, z: a.z + ((b.z - a.z) * k) / parts });
  }
  return out;
}

/** Even-odd test of a point against one ring (closed or not). */
function insideRing(x: number, z: number, ring: Local[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether (x, z) is inside a polygon given as its outer ring followed by its holes. Works in any plane: local metres, or lon/lat. */
export function pointInRings(x: number, z: number, rings: Local[][]): boolean {
  if (!rings.length || !insideRing(x, z, rings[0])) return false;
  return !rings.slice(1).some((hole) => insideRing(x, z, hole));
}

/** The id of the block whose polygon (outer ring, then holes) contains (x, z), or null. The first match wins. */
export function blockAt(blocks: readonly { id: string; polygons: Local[][][] }[], x: number, z: number): string | null {
  for (const block of blocks) if (block.polygons.some((rings) => pointInRings(x, z, rings))) return block.id;
  return null;
}

/** How a block's outline is drawn: crisp (eligible), reference (an exemplar), faint and dotted (not eligible), or selected. */
export type OutlineKind = "crisp" | "reference" | "faint" | "selected";

export function outlineKind(properties: { eligibility?: Eligibility | null; is_reference?: boolean | null }, selected = false): OutlineKind {
  if (selected) return "selected";
  // A block from before eligibility existed (an old staged event) is treated as eligible.
  if (properties.eligibility && properties.eligibility !== "eligible") return "faint";
  return properties.is_reference ? "reference" : "crisp";
}
