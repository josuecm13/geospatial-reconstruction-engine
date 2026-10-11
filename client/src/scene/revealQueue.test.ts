import { describe, expect, it } from "vitest";
import { RevealQueue } from "./revealQueue";

const drain = (queue: RevealQueue<string>, seconds: number, step = 0.1) => {
  const released: { t: number; block: string }[] = [];
  for (let t = step; t <= seconds + 1e-9; t += step) for (const g of queue.update(step)) released.push({ t, block: g.block });
  return released;
};

describe("RevealQueue", () => {
  it("releases blocks on the accelerating schedule, nearest first", () => {
    const queue = new RevealQueue<string>();
    queue.start(100);
    for (let i = 0; i < 100; i++) queue.add(`b${i}`, [`x${i}`]);
    const released = drain(queue, 5);
    expect(released).toHaveLength(100);
    expect(released[0].block).toBe("b0");
    const by = (s: number) => released.filter((r) => r.t <= s).length;
    expect(by(1)).toBeGreaterThan(3);
    expect(by(1)).toBeLessThan(8);
    expect(by(2) - by(1)).toBeGreaterThan(by(1));
    expect(queue.size).toBe(0);
  });
  it("releases a block that arrives after its slot on the next update", () => {
    const queue = new RevealQueue<string>();
    queue.start(10);
    expect(queue.update(3)).toEqual([]);
    queue.add("late", ["x"]); // the first slot is at 0
    expect(queue.update(0.016)).toEqual([{ block: "late", items: ["x"] }]);
  });
  it("adds later items of a block waiting for its slot to the same group", () => {
    const queue = new RevealQueue<string>();
    queue.start(4);
    queue.add("a", ["1"]);
    queue.add("b", ["2"]);
    queue.add("b", ["3"]);
    expect(queue.update(0)).toEqual([{ block: "a", items: ["1"] }]);
    expect(queue.flush()).toEqual([{ block: "b", items: ["2", "3"] }]);
  });
  it("flushes everything, and start drops what is waiting", () => {
    const queue = new RevealQueue<string>();
    queue.start(5);
    queue.add("a", ["1"]);
    queue.add("b", ["2"]);
    queue.add("c", ["3"]);
    expect(queue.flush().map((g) => g.block)).toEqual(["a", "b", "c"]);
    expect(queue.size).toBe(0);
    queue.add("d", ["4"]);
    queue.start(1);
    expect(queue.size).toBe(0);
  });
  it("copes with more blocks than expected, and with none expected", () => {
    const queue = new RevealQueue<string>();
    queue.start(0);
    for (let i = 0; i < 5; i++) queue.add(`b${i}`, [`x${i}`]);
    expect(drain(queue, 5)).toHaveLength(5);
  });
});
