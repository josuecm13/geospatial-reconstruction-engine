import { describe, expect, it } from "vitest";
import { RISE_SECONDS } from "./buildAnimation";
import { REVEAL_RINGS, REVEAL_TOTAL_SECONDS, revealDelays, ringIndices, streamBatchDelay } from "./revealRings";

const centre = { x: 0, z: 0 };
const at = (distance: number) => ({ x: distance, z: 0 });

describe("ringIndices", () => {
  it("numbers rings from the centre out in equal bands of distance", () => {
    expect(ringIndices([at(0), at(10), at(50), at(100)], centre, 4)).toEqual([0, 0, 2, 3]);
  });

  it("is all ring 0 when nothing is away from the centre", () => {
    expect(ringIndices([at(0), at(0)], centre)).toEqual([0, 0]);
    expect(ringIndices([], centre)).toEqual([]);
  });

  it("never exceeds the last ring", () => {
    expect(Math.max(...ringIndices([at(1), at(7), at(100)], centre))).toBe(REVEAL_RINGS - 1);
  });
});

describe("revealDelays", () => {
  const points = [at(1), at(40), at(80), at(100), at(100)];
  const delays = revealDelays(points, centre, RISE_SECONDS);

  it("starts the nearest ring at once and the same ring together", () => {
    expect(delays[0]).toBe(0);
    expect(delays[3]).toBe(delays[4]);
  });

  it("starts rings later the farther they are", () => {
    expect([...delays]).toEqual([...delays].sort((a, b) => a - b));
    expect(delays[1]).toBeGreaterThan(0);
  });

  it("ends the last rise at the total", () => {
    expect(Math.max(...delays) + RISE_SECONDS).toBeCloseTo(REVEAL_TOTAL_SECONDS, 6);
  });

  it("takes about five seconds in all", () => {
    expect(REVEAL_TOTAL_SECONDS).toBe(5);
    expect(Math.max(...delays) + RISE_SECONDS).toBeCloseTo(5, 6);
  });

  it("starts everything at 0 when there is a single ring", () => {
    expect(revealDelays([at(5), at(5)], centre, RISE_SECONDS)).toEqual([0, 0]);
  });

  it("never waits when the rise alone is longer than the total", () => {
    expect(Math.max(...revealDelays(points, centre, 2, 1.3))).toBe(0);
  });
});

describe("streamBatchDelay", () => {
  const spread = REVEAL_TOTAL_SECONDS - RISE_SECONDS;

  it("targets the total minus the rise when every block is done", () => {
    expect(streamBatchDelay(10, 10, 0, RISE_SECONDS)).toBeCloseTo(spread, 6);
  });

  it("finishes a fast stream at about five seconds", () => {
    // Four batches, all arriving within half a second.
    const ends = [0.1, 0.2, 0.3, 0.5].map((arrival, i) => arrival + streamBatchDelay((i + 1) * 5, 20, arrival, RISE_SECONDS) + RISE_SECONDS);
    expect(Math.max(...ends)).toBeCloseTo(REVEAL_TOTAL_SECONDS, 6);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
  });

  it("does not delay a batch that arrives after its target", () => {
    expect(streamBatchDelay(5, 20, 3, RISE_SECONDS)).toBe(0);
    expect(streamBatchDelay(20, 20, 9, RISE_SECONDS)).toBe(0);
  });

  it("is 0 without a block count", () => {
    expect(streamBatchDelay(3, 0, 0, RISE_SECONDS)).toBe(0);
  });
});
