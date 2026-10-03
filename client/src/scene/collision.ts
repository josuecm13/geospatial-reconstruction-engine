/** Walking collision against building footprints. Pure: no Three.js, so it runs under vitest. */
export interface Point {
  x: number;
  z: number;
}

export interface Footprint {
  id: string;
  ring: Point[];
}

interface Indexed extends Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FootprintIndex {
  cellSize: number;
  cells: Map<string, Indexed[]>;
}

const key = (cx: number, cz: number) => `${cx},${cz}`;

/** A uniform grid: each cell lists the footprints whose bounding box overlaps it. */
export function buildFootprintIndex(footprints: Footprint[], cellSize = 25): FootprintIndex {
  const cells = new Map<string, Indexed[]>();
  for (const footprint of footprints) {
    if (!footprint.ring.length) continue;
    const xs = footprint.ring.map((p) => p.x);
    const zs = footprint.ring.map((p) => p.z);
    const item: Indexed = { ...footprint, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    for (let cx = Math.floor(item.minX / cellSize); cx <= Math.floor(item.maxX / cellSize); cx++) {
      for (let cz = Math.floor(item.minZ / cellSize); cz <= Math.floor(item.maxZ / cellSize); cz++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list) list.push(item);
        else cells.set(k, [item]);
      }
    }
  }
  return { cellSize, cells };
}

function insideRing(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** True when a circle of `radius` at `point` is inside the ring or within `radius` of its edge. */
export function circleHitsRing(point: Point, ring: Point[], radius: number): boolean {
  if (ring.length < 2) return false;
  if (insideRing(point, ring)) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (distanceToSegment(point, ring[j], ring[i]) <= radius) return true;
  }
  return false;
}

/** Footprints whose grid cells the circle at `point` touches. */
function candidates(index: FootprintIndex, point: Point, radius: number): Set<Indexed> {
  const found = new Set<Indexed>();
  const { cellSize, cells } = index;
  for (let cx = Math.floor((point.x - radius) / cellSize); cx <= Math.floor((point.x + radius) / cellSize); cx++) {
    for (let cz = Math.floor((point.z - radius) / cellSize); cz <= Math.floor((point.z + radius) / cellSize); cz++) {
      cells.get(key(cx, cz))?.forEach((item) => found.add(item));
    }
  }
  return found;
}

/** True when a circle at `point` overlaps any footprint. */
export function blocked(index: FootprintIndex, point: Point, radius = 0.3): boolean {
  for (const item of candidates(index, point, radius)) if (circleHitsRing(point, item.ring, radius)) return true;
  return false;
}

/** Moves from `from` to `to`, sliding along x then z when `to` is blocked; stays put when both are. */
export function resolveMove(index: FootprintIndex, from: Point, to: Point, radius = 0.3): Point {
  if (!blocked(index, to, radius)) return to;
  const alongX = { x: to.x, z: from.z };
  if (!blocked(index, alongX, radius)) return alongX;
  const alongZ = { x: from.x, z: to.z };
  if (!blocked(index, alongZ, radius)) return alongZ;
  return from;
}

/** The centroid of the road outline closest to `center`, or `center` when there are no roads. */
export function nearestRoadStart(roadOutlines: Point[][], center: Point = { x: 0, z: 0 }): Point {
  let best: Point | undefined;
  let bestDistance = Infinity;
  for (const outline of roadOutlines) {
    if (!outline.length) continue;
    const centroid = {
      x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
      z: outline.reduce((sum, p) => sum + p.z, 0) / outline.length,
    };
    const distance = Math.hypot(centroid.x - center.x, centroid.z - center.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = centroid;
    }
  }
  return best ?? center;
}
