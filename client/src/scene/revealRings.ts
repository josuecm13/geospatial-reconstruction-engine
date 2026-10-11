/** Rings the generated buildings are grouped into when "Show generated" is ticked. */
export const REVEAL_RINGS = 8;
/** From the first ring starting to the last building finishing. */
export const REVEAL_TOTAL_SECONDS = 5;

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

/**
 * Seconds from now that a streamed batch should start rising, so a stream is spread over at least `total`
 * seconds: the batch that brings `blocksDone` of `blockCount` blocks targets
 * `blocksDone / blockCount * (total - riseSeconds)` seconds after the stream started, and waits whatever of
 * that is left (`elapsed` seconds have gone). A stream slower than the pace gets 0: batches rise as they arrive.
 */
export function streamBatchDelay(blocksDone: number, blockCount: number, elapsed: number, riseSeconds: number, total: number = REVEAL_TOTAL_SECONDS): number {
  if (!(blockCount > 0)) return 0;
  const fraction = Math.min(Math.max(blocksDone / blockCount, 0), 1);
  const target = fraction * Math.max(total - riseSeconds, 0);
  return Math.max(0, target - elapsed);
}
