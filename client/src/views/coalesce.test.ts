import { describe, expect, it } from "vitest";
import { Coalescer, type CoalescerClock } from "./coalesce";

/** A clock that only moves when told to, running the timers that come due. */
function fakeClock() {
  let time = 10_000;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let next = 0;
  const clock: CoalescerClock = {
    now: () => time,
    set(run, ms) {
      timers.push({ at: time + ms, run, id: ++next });
      return next;
    },
    clear(handle) {
      timers = timers.filter((timer) => timer.id !== handle);
    },
  };
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer !== due);
      time = due.at;
      due.run();
    }
    time = end;
  };
  return { clock, advance, pending: () => timers.length };
}

describe("Coalescer", () => {
  it("applies the first value at once, then at most once per interval, with a trailing apply for the last", () => {
    const { clock, advance } = fakeClock();
    const applied: number[] = [];
    const coalescer = new Coalescer<number>((value) => applied.push(value), 1000, clock);
    coalescer.push(1);
    expect(applied).toEqual([1]);
    advance(100);
    coalescer.push(2);
    advance(100);
    coalescer.push(3);
    expect(applied).toEqual([1]);
    advance(799);
    expect(applied).toEqual([1]);
    advance(1);
    expect(applied).toEqual([1, 3]); // 2 was dropped; 3 landed at the interval
    advance(5000);
    expect(applied).toEqual([1, 3]);
  });

  it("applies at once again after a quiet interval", () => {
    const { clock, advance } = fakeClock();
    const applied: number[] = [];
    const coalescer = new Coalescer<number>((value) => applied.push(value), 1000, clock);
    coalescer.push(1);
    advance(1000);
    coalescer.push(2);
    expect(applied).toEqual([1, 2]);
  });

  it("applies nothing while hidden, and the latest value when shown", () => {
    const { clock, advance, pending } = fakeClock();
    const applied: number[] = [];
    const coalescer = new Coalescer<number>((value) => applied.push(value), 1000, clock);
    coalescer.setVisible(false);
    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    advance(10_000);
    expect(applied).toEqual([]);
    expect(pending()).toBe(0);
    coalescer.setVisible(true);
    expect(applied).toEqual([3]);
  });

  it("stops a trailing apply when hidden and applies it when shown again", () => {
    const { clock, advance } = fakeClock();
    const applied: number[] = [];
    const coalescer = new Coalescer<number>((value) => applied.push(value), 1000, clock);
    coalescer.push(1);
    coalescer.push(2);
    coalescer.setVisible(false);
    advance(5000);
    expect(applied).toEqual([1]);
    coalescer.setVisible(true);
    expect(applied).toEqual([1, 2]);
  });

  it("applies a null value like any other, and cancel drops what waits", () => {
    const { clock, advance } = fakeClock();
    const applied: (number | null)[] = [];
    const coalescer = new Coalescer<number | null>((value) => applied.push(value), 1000, clock);
    coalescer.push(1);
    coalescer.push(null);
    advance(1000);
    expect(applied).toEqual([1, null]);
    coalescer.push(2);
    coalescer.push(3);
    coalescer.cancel();
    advance(5000);
    expect(applied).toEqual([1, null, 2]);
  });
});
