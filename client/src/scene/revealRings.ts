/** Rings the generated buildings are grouped into when "Show generated" is ticked. */
export const REVEAL_RINGS = 8;
/** From the first ring starting to the last building finishing. */
export const REVEAL_TOTAL_SECONDS = 1.3;

export interface Point {
  x: number;
  z: number;
}

/**
 * Which ring each point is in, 0 nearest `centre`: the distances from the centre are cut into `rings`
 * equal bands up to the farthest point.
 */
export function ringIndices(points: Point[], centre: Point, rings: number = REVEAL_RINGS): number[] {
  const distances = points.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z));
  const farthest = Math.max(0, ...distances);
  if (farthest === 0 || rings < 2) return distances.map(() => 0);
  return distances.map((d) => Math.min(rings - 1, Math.floor((d / farthest) * rings)));
}

/**
 * When each point's building starts rising, in seconds: all of a ring together, rings spread evenly from the
 * centre out, so that the last ring's rise (`riseSeconds`) ends at `total`. One ring (or none) starts at 0.
 */
export function revealDelays(points: Point[], centre: Point, riseSeconds: number, total: number = REVEAL_TOTAL_SECONDS, rings: number = REVEAL_RINGS): number[] {
  const indices = ringIndices(points, centre, rings);
  const last = Math.max(0, ...indices);
  const span = Math.max(total - riseSeconds, 0);
  return indices.map((index) => (last === 0 ? 0 : (index / last) * span));
}
