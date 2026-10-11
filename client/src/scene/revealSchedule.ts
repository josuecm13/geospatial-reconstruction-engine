import { RISE_SECONDS, staggerDelay } from "./buildAnimation";

/** From the first block starting to the last building landed. */
export const REVEAL_TOTAL_SECONDS = 5;

/**
 * When block `index` of `count` starts rising, in seconds: `(total - rise) * sqrt(index / count)`. The number of
 * blocks revealed grows like t squared: a couple in the first second, ten more by the second, then more and more.
 * The last block starts at about `total - rise`, so its buildings land at about `total`.
 */
export function revealStart(index: number, count: number, total: number = REVEAL_TOTAL_SECONDS, rise: number = RISE_SECONDS): number {
  if (!(count > 0)) return 0;
  return Math.max(total - rise, 0) * Math.sqrt(Math.min(Math.max(index, 0), count) / count);
}

/** The start time of each of `count` blocks, in reveal order (nearest first). Monotonic; empty for 0. */
export function revealSchedule(count: number, total: number = REVEAL_TOTAL_SECONDS, rise: number = RISE_SECONDS): number[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => revealStart(i, count, total, rise));
}

export interface BlockPoint {
  block: string;
  x: number;
  z: number;
}

/** The blocks of `points`, nearest `centre` first, by the mean position of each block's points; the block id breaks a tie. */
export function orderBlocks(points: BlockPoint[], centre: { x: number; z: number }): string[] {
  const sums = new Map<string, { x: number; z: number; n: number }>();
  for (const p of points) {
    const sum = sums.get(p.block) ?? { x: 0, z: 0, n: 0 };
    sums.set(p.block, { x: sum.x + p.x, z: sum.z + p.z, n: sum.n + 1 });
  }
  return [...sums.entries()]
    .map(([block, s]) => ({ block, d: Math.hypot(s.x / s.n - centre.x, s.z / s.n - centre.z) }))
    .sort((a, b) => a.d - b.d || (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))
    .map((entry) => entry.block);
}

/**
 * The delay of each point's building: all of a block together on the block's slot of the schedule, blocks from
 * the centre out, plus the tiny within-block stagger.
 */
export function pointDelays(points: BlockPoint[], centre: { x: number; z: number }, total: number = REVEAL_TOTAL_SECONDS, rise: number = RISE_SECONDS): number[] {
  const order = orderBlocks(points, centre);
  const starts = new Map(order.map((block, i) => [block, revealStart(i, order.length, total, rise)]));
  const seen = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const p of points) sizes.set(p.block, (sizes.get(p.block) ?? 0) + 1);
  return points.map((p) => {
    const within = seen.get(p.block) ?? 0;
    seen.set(p.block, within + 1);
    return (starts.get(p.block) ?? 0) + staggerDelay(within, sizes.get(p.block) ?? 1);
  });
}
