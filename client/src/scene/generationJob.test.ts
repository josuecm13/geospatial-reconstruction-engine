import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { GeneratedEvent } from "../api/types";
import type { EventStream } from "../importing/stagedImport";
import { generateBuildings, newSeed } from "./generationJob";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeStream implements EventStream {
  readyState = 1;
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent) => void>();
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: unknown): void {
    this.listeners.get(type)!({ data: JSON.stringify(data) } as MessageEvent);
  }
  lose(readyState: number): void {
    this.readyState = readyState;
    this.listeners.get("error")!({} as MessageEvent);
  }
}

function setup(startError?: Error) {
  const stream = new FakeStream();
  const calls: string[] = [];
  const api = {
    startGeneration: async (id: string, seed?: number) => {
      calls.push(`start:${id}:${seed ?? "none"}`);
      if (startError) throw startError;
      return { import_area_id: id, events_url: `/import-areas/${id}/events` };
    },
    importEvents: (id: string) => {
      calls.push(`events:${id}`);
      return stream;
    },
  };
  return { stream, calls, run: (seed?: number, onProgress?: (blocks: number | null) => void, onGenerated?: (event: GeneratedEvent) => void) => generateBuildings(api, "a1", seed, onProgress, onGenerated) };
}

describe("generateBuildings", () => {
  it("starts the run with its seed, reports the block count, and resolves on completed", async () => {
    const { stream, calls, run } = setup();
    const progress: (number | null)[] = [];
    const done = run(7, (blocks) => progress.push(blocks));
    await flush();

    stream.emit("generation", { block_count: 57 });
    expect(progress).toEqual([57]);
    expect(stream.closed).toBe(false);
    stream.emit("completed", { run: {} });

    await expect(done).resolves.toBeUndefined();
    expect(calls).toEqual(["start:a1:7", "events:a1"]);
    expect(stream.closed).toBe(true);
  });

  it("hands each generated batch to onGenerated and ignores a malformed one", async () => {
    const { stream, run } = setup();
    const batches: GeneratedEvent[] = [];
    const done = run(undefined, undefined, (event) => batches.push(event));
    await flush();

    stream.emit("generation", { block_count: 4 });
    stream.emit("generated", { projection: { origin: { latitude: 1, longitude: 2 } }, ring: 0, blocks_done: 2, block_count: 4, buildings: { type: "FeatureCollection", features: [{ id: "g1" }] } });
    stream.emit("generated", { ring: 1 });
    stream.emit("completed", {});
    await done;

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ ring: 0, blocks_done: 2, block_count: 4 });
    expect(batches[0].buildings.features).toHaveLength(1);
  });

  it("starts without a seed when none is given", async () => {
    const { stream, calls, run } = setup();
    const done = run();
    await flush();
    stream.emit("completed", {});
    await done;

    expect(calls[0]).toBe("start:a1:none");
  });

  it("rejects with the failed event's code, and closes the stream", async () => {
    const { stream, run } = setup();
    const done = run(1);
    await flush();

    stream.emit("failed", { code: "internal_error", message: "boom", details: null });

    await expect(done).rejects.toMatchObject({ code: "internal_error", message: "boom" });
    expect(stream.closed).toBe(true);
  });

  it("rejects before opening a stream when the server refuses to start", async () => {
    const { calls, run } = setup(new ApiError(409, "import_in_progress", "running"));

    await expect(run(1)).rejects.toMatchObject({ status: 409, code: "import_in_progress" });
    expect(calls).toEqual(["start:a1:1"]);
  });

  it("rides out a reconnecting stream but rejects with network_error once it is closed", async () => {
    const { stream, run } = setup();
    const done = run(1);
    await flush();

    stream.lose(0);
    expect(stream.closed).toBe(false);
    stream.lose(2);

    await expect(done).rejects.toMatchObject({ code: "network_error" });
  });

  it("ignores events after it has settled", async () => {
    const { stream, run } = setup();
    const done = run(1);
    await flush();
    stream.emit("completed", {});
    await done;

    expect(() => stream.emit("failed", { code: "internal_error" })).not.toThrow();
  });
});

describe("newSeed", () => {
  it("is an integer in [0, 2^31), from the random source", () => {
    expect(newSeed(() => 0)).toBe(0);
    expect(newSeed(() => 0.5)).toBe(2 ** 30);
    expect(newSeed(() => 0.999999999)).toBeLessThan(2 ** 31);
    expect(Number.isInteger(newSeed())).toBe(true);
  });
});
