import type { BoundingBox, Position } from "../api/types";
import { metersPerDegree } from "../geo/localMeters";

/** The rule names the server reports in `details.rule` that the client can check before saving. */
export type RingProblem = "too_few_vertices" | "self_intersecting" | "outside_import_area";

const samePoint = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** The ring with its first point repeated at the end, unless it already is. */
export function closeRing(points: Position[]): Position[] {
  if (points.length === 0 || samePoint(points[0], points[points.length - 1])) return [...points];
  return [...points, points[0]];
}

/**
 * Douglas-Peucker on an open path, measured in local meters around `latitude`. The first and last
 * points always stay. Freehand input has hundreds of points; this keeps the ring to a sane size.
 */
export function simplifyFreehand(points: Position[], toleranceMeters: number, latitude: number): Position[] {
  if (points.length < 3) return [...points];
  const scale = metersPerDegree(latitude);
  const xy = points.map(([lon, lat]) => [lon * scale.lon, lat * scale.lat] as const);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceMeters;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(xy[i], xy[first], xy[last]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distanceToSegment(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * A client-side precheck with the server's rule names, so one message table serves both. The server
 * stays the authority; this only avoids a round trip for the obvious cases.
 */
export function ringProblem(ring: Position[], bbox: BoundingBox): RingProblem | null {
  const closed = closeRing(ring);
  if (new Set(closed.slice(0, -1).map(([x, y]) => `${x},${y}`)).size < 3) return "too_few_vertices";
  const outside = closed.some(
    ([lon, lat]) => lon < bbox.min_longitude || lon > bbox.max_longitude || lat < bbox.min_latitude || lat > bbox.max_latitude,
  );
  if (outside) return "outside_import_area";
  return selfIntersects(closed) ? "self_intersecting" : null;
}

function selfIntersects(closed: Position[]): boolean {
  const edges = closed.length - 1;
  for (let i = 0; i < edges; i++) {
    for (let j = i + 1; j < edges; j++) {
      // Neighbouring edges share a vertex by construction (the last and first edge too).
      if (j === i + 1 || (i === 0 && j === edges - 1)) {
        if (foldsBack(closed[i], closed[i + 1], closed[j], closed[j + 1])) return true;
        continue;
      }
      if (segmentsIntersect(closed[i], closed[i + 1], closed[j], closed[j + 1])) return true;
    }
  }
  return false;
}

const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Two edges that share a vertex still cross themselves if they fold back along one line. */
function foldsBack(a: Position, b: Position, c: Position, d: Position): boolean {
  const shared = samePoint(b, c) ? b : samePoint(a, d) ? a : null;
  if (!shared) return false;
  const p = samePoint(shared, b) ? a : b;
  const q = samePoint(shared, c) ? d : c;
  if (cross(shared, p, q) !== 0) return false;
  return (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]) > 0;
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && onSegment(a, b, c)) || (d2 === 0 && onSegment(a, b, d)) || (d3 === 0 && onSegment(c, d, a)) || (d4 === 0 && onSegment(c, d, b))
  );
}
