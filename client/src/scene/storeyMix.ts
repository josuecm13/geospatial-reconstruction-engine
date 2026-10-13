import type { BuildingProperties } from "../api/types";

/** The share of two-storey buildings when nothing in the data says. The server uses the same figure. */
export const TWO_STOREY_SHARE_DEFAULT = 0.3;
/** Buildings stating 1 or 2 levels that a block or area needs before its own share is trusted. */
export const TWO_STOREY_MIN_EVIDENCE = 3;

/**
 * A stable value in [0, 1) for `seed`: FNV-1a (32-bit) over its UTF-8 bytes, then murmur3's fmix32 finalizer
 * (FNV-1a alone mixes its high bits poorly when seeds differ only in trailing characters, as ids do),
 * divided by 2^32. The server has the same function.
 */
export function stableUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** 2 when the seed's unit value falls under `share`, else 1. */
export function drawStoreys(seed: string, share: number): 1 | 2 {
  return stableUnit(seed) < share ? 2 : 1;
}

export interface StoreyShares {
  /** The share for a building in this block (null: no block); the block's own when it has enough evidence, else the area's, else the default. */
  forBlock(blockId: string | null): number;
}

type Counts = { two: number; low: number };

/** Shares of two-storey buildings among those stating 1 or 2 levels (a building with only a height says nothing). */
export function storeyShares(buildings: Pick<BuildingProperties, "block_id" | "levels">[]): StoreyShares {
  const area: Counts = { two: 0, low: 0 };
  const blocks = new Map<string, Counts>();
  for (const { block_id, levels } of buildings) {
    if (levels !== 1 && levels !== 2) continue;
    area.low += 1;
    if (levels === 2) area.two += 1;
    if (block_id == null) continue;
    const counts = blocks.get(block_id) ?? { two: 0, low: 0 };
    counts.low += 1;
    if (levels === 2) counts.two += 1;
    blocks.set(block_id, counts);
  }
  const trusted = (counts: Counts | undefined): number | null =>
    counts && counts.low >= TWO_STOREY_MIN_EVIDENCE ? counts.two / counts.low : null;
  const fromArea = trusted(area) ?? TWO_STOREY_SHARE_DEFAULT;
  return { forBlock: (blockId) => (blockId != null ? trusted(blocks.get(blockId)) : null) ?? fromArea };
}
