import { describe, expect, it } from "vitest";
import { RISE_SECONDS } from "./buildAnimation";
import { orderBlocks, pointDelays, REVEAL_TOTAL_SECONDS, revealSchedule } from "./revealSchedule";

describe("revealSchedule", () => {
  it("is monotonic, starting at 0", () => {
    const times = revealSchedule(200);
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  });
  it("reveals about N/25 to N/15 of the blocks in the first second, and accelerates", () => {
    const n = 500;
    const times = revealSchedule(n);
    const within = (seconds: number) => times.filter((t) => t <= seconds).length;
    expect(within(1)).toBeGreaterThan(n / 25);
    expect(within(1)).toBeLessThan(n / 15);
    expect(within(2) - within(1)).toBeGreaterThan(within(1));
    expect(within(3) - within(2)).toBeGreaterThan(within(2) - within(1));
  });
  it("starts the last block about a rise before the total, so the last building lands at about the total", () => {
    const times = revealSchedule(300);
    expect(times[times.length - 1] + RISE_SECONDS).toBeGreaterThan(REVEAL_TOTAL_SECONDS - 0.1);
    expect(times[times.length - 1] + RISE_SECONDS).toBeLessThanOrEqual(REVEAL_TOTAL_SECONDS);
  });
  it("handles one block and none", () => {
    expect(revealSchedule(1)).toEqual([0]);
    expect(revealSchedule(0)).toEqual([]);
  });
});

describe("orderBlocks and pointDelays", () => {
  const centre = { x: 0, z: 0 };
  const points = [
    { block: "far", x: 100, z: 0 },
    { block: "near", x: 5, z: 0 },
    { block: "near", x: -5, z: 2 },
    { block: "mid", x: 0, z: 40 },
  ];
  it("orders blocks nearest first by mean position, id breaking a tie", () => {
    expect(orderBlocks(points, centre)).toEqual(["near", "mid", "far"]);
    expect(orderBlocks([{ block: "b", x: 1, z: 0 }, { block: "a", x: -1, z: 0 }], centre)).toEqual(["a", "b"]);
    expect(orderBlocks([], centre)).toEqual([]);
  });
  it("gives a block's buildings the same slot plus a tiny stagger, nearer blocks first", () => {
    const delays = pointDelays(points, centre);
    expect(delays[1]).toBe(0);
    expect(delays[2]).toBeGreaterThan(0);
    expect(delays[2]).toBeLessThan(0.1);
    expect(delays[3]).toBeGreaterThan(delays[2]);
    expect(delays[0]).toBeGreaterThan(delays[3]);
  });
});
