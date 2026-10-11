import { RISE_SECONDS } from "./buildAnimation";
import { REVEAL_TOTAL_SECONDS, revealStart } from "./revealSchedule";

/** One block's items that are due to appear together. */
export interface RevealGroup<T> {
  block: string;
  items: T[];
}

/**
 * The streamed reveal: items arrive block by block (nearest the centre first), and `update(delta)` releases
 * them on the reveal schedule's clock, which starts at `start`. A block takes the next slot when its first
 * items arrive; if its slot has passed by then it is released on the next update, so a slow source is never
 * delayed further and a fast one is spread over about `total` seconds. Pure: the caller draws what is released.
 */
export class RevealQueue<T> {
  private clock = 0;
  private expected = 0;
  private readonly slots = new Map<string, number>();
  private waiting: { block: string; due: number; items: T[] }[] = [];

  constructor(
    private readonly total: number = REVEAL_TOTAL_SECONDS,
    private readonly rise: number = RISE_SECONDS,
  ) {}

  /** Items still waiting for their slot. */
  get size(): number {
    return this.waiting.reduce((n, group) => n + group.items.length, 0);
  }

  /** A new run: the clock restarts at 0 and anything waiting is dropped. `blocks` is how many blocks to expect (0: unknown). */
  start(blocks = 0): void {
    this.clock = 0;
    this.expected = blocks;
    this.slots.clear();
    this.waiting = [];
  }

  /** Updates the expected block count (a later event knows better). */
  expect(blocks: number): void {
    if (blocks > 0) this.expected = blocks;
  }

  add(block: string, items: T[]): void {
    if (!items.length) return;
    let due = this.slots.get(block);
    if (due === undefined) {
      due = revealStart(this.slots.size, Math.max(this.expected, this.slots.size + 1), this.total, this.rise);
      this.slots.set(block, due);
    }
    const existing = this.waiting.find((group) => group.block === block);
    if (existing) existing.items.push(...items);
    else this.waiting.push({ block, due, items: [...items] });
  }

  /** Advances the clock; returns the groups now due, earliest first. */
  update(delta: number): RevealGroup<T>[] {
    this.clock += Math.max(delta, 0);
    const due = this.waiting.filter((group) => group.due <= this.clock);
    if (!due.length) return [];
    this.waiting = this.waiting.filter((group) => group.due > this.clock);
    return due.sort((a, b) => a.due - b.due).map(({ block, items }) => ({ block, items }));
  }

  /** Everything waiting, due or not (Skip animation). */
  flush(): RevealGroup<T>[] {
    const all = this.waiting.sort((a, b) => a.due - b.due).map(({ block, items }) => ({ block, items }));
    this.waiting = [];
    return all;
  }
}
