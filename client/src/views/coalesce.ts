/** How often a visible view takes a new value: at most once per interval, the last one always landing. */
export const COALESCE_INTERVAL_MS = 1000;

export interface CoalescerClock {
  now(): number;
  /** Schedules `run` after `ms`; returns a handle for `clear`. */
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realClock: CoalescerClock = { now: () => Date.now(), set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * Hands values to `apply` no faster than a view can use them. Only the latest value matters, so the ones in between are dropped.
 * - Hidden: nothing is applied; the latest value waits and is applied when the view is shown.
 * - Visible: the first value applies at once; later ones wait for the interval since the last apply, with a trailing
 *   apply so the last value always lands.
 */
export class Coalescer<T> {
  private pending: { value: T } | null = null;
  private visible = true;
  private last = -Infinity;
  private timer: unknown = null;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly interval = COALESCE_INTERVAL_MS,
    private readonly clock: CoalescerClock = realClock,
  ) {}

  push(value: T): void {
    this.pending = { value };
    if (this.visible) this.schedule();
  }

  /** Showing flushes the latest value held back; hiding stops the trailing apply and keeps the value. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.flush();
    else this.stop();
  }

  /** Drops the waiting value (something newer replaced everything). */
  cancel(): void {
    this.pending = null;
    this.stop();
  }

  private schedule(): void {
    if (this.timer !== null) return; // the trailing apply will carry the latest value
    const wait = this.last + this.interval - this.clock.now();
    if (wait <= 0) this.flush();
    else
      this.timer = this.clock.set(() => {
        this.timer = null;
        this.flush();
      }, wait);
  }

  private flush(): void {
    this.stop();
    const next = this.pending;
    if (!next) return;
    this.pending = null;
    this.last = this.clock.now();
    this.apply(next.value);
  }

  private stop(): void {
    if (this.timer === null) return;
    this.clock.clear(this.timer);
    this.timer = null;
  }
}
