import { describe, expect, it } from "vitest";
import { LruCache, previewKey, TaskQueue } from "./previewScheduler";

/** A task that starts when called and finishes when `finish` is called. */
function gate<T>(value: T) {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<T>((resolve, reject) => {
    finish = () => resolve(value);
    fail = reject;
  });
  return { done, finish, fail };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("previewKey", () => {
  it("names the area and when it was imported", () => {
    expect(previewKey("a1", "2026-10-02T11:00:00Z")).toBe("a1@2026-10-02T11:00:00Z");
    expect(previewKey("a1", null)).toBe("a1@");
    expect(previewKey("a1", "x")).not.toBe(previewKey("a1", "y"));
  });
});

describe("TaskQueue", () => {
  it("runs at most `limit` tasks at once, starting the next as one finishes", async () => {
    const started: number[] = [];
    const gates = [0, 1, 2, 3].map((n) => gate(n));
    const queue = new TaskQueue(2);
    const results = gates.map((g, n) => queue.add(() => (started.push(n), g.done)));

    expect(started).toEqual([0, 1]);

    gates[0].finish();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    gates[2].finish();
    gates[1].finish();
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3].finish();
    expect(await Promise.all(results.map((r) => r.result))).toEqual([0, 1, 2, 3]);
  });

  it("drops a task cancelled before it starts, and the others still run", async () => {
    const started: string[] = [];
    const first = gate("a");
    const queue = new TaskQueue(1);
    const a = queue.add(() => (started.push("a"), first.done));
    const b = queue.add(async () => (started.push("b"), "b"));
    const c = queue.add(async () => (started.push("c"), "c"));

    b.cancel();
    expect(await b.result).toBeUndefined();

    first.finish();
    expect(await a.result).toBe("a");
    expect(await c.result).toBe("c");
    expect(started).toEqual(["a", "c"]);
  });

  it("cannot cancel a task that is already running", async () => {
    const running = gate("done");
    const queue = new TaskQueue(1);
    const task = queue.add(() => running.done);

    task.cancel();
    running.finish();

    expect(await task.result).toBe("done");
  });

  it("frees the slot when a task fails", async () => {
    const failing = gate("never");
    const queue = new TaskQueue(1);
    const bad = queue.add(() => failing.done);
    const good = queue.add(async () => "ok");

    failing.fail(new Error("boom"));

    await expect(bad.result).rejects.toThrow("boom");
    expect(await good.result).toBe("ok");
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry past its capacity", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now newer than b
    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("replaces a key without growing", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("a", 5);

    expect(cache.get("a")).toBe(5);
    expect(cache.size).toBe(1);
  });
});
