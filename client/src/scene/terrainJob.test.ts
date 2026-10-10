import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { EventStream } from "../importing/stagedImport";
import { analyseTerrain } from "./terrainJob";

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
    analyseElevation: async (id: string) => {
      calls.push(`analyse:${id}`);
      if (startError) throw startError;
      return { import_area_id: id, events_url: `/import-areas/${id}/events` };
    },
    importEvents: (id: string) => {
      calls.push(`events:${id}`);
      return stream;
    },
  };
  return { stream, calls, run: (onElevation?: () => void) => analyseTerrain(api, "a1", onElevation) };
}

describe("analyseTerrain", () => {
  it("starts the analysis, follows its events, and resolves on completed", async () => {
    const { stream, calls, run } = setup();
    let elevations = 0;
    const done = run(() => elevations++);
    await flush();

    stream.emit("elevation", { projection: {}, elevation: { version: 2 }, error: null });
    expect(elevations).toBe(1);
    expect(stream.closed).toBe(false);
    stream.emit("completed", { id: "a1" });

    await expect(done).resolves.toBeUndefined();
    expect(calls).toEqual(["analyse:a1", "events:a1"]);
    expect(stream.closed).toBe(true);
  });

  it("rejects with the failed event's code", async () => {
    const { stream, run } = setup();
    const done = run();
    await flush();

    stream.emit("failed", { code: "elevation_unavailable", message: "no tiles", details: null });

    await expect(done).rejects.toMatchObject({ code: "elevation_unavailable", message: "no tiles" });
    expect(stream.closed).toBe(true);
  });

  it("rejects before opening a stream when the server refuses to start", async () => {
    const { calls, run } = setup(new ApiError(409, "import_in_progress", "running"));

    await expect(run()).rejects.toMatchObject({ status: 409, code: "import_in_progress" });
    expect(calls).toEqual(["analyse:a1"]);
  });

  it("treats an elevation event that carries an error as a failure", async () => {
    const { stream, run } = setup();
    const done = run();
    await flush();

    stream.emit("elevation", { projection: {}, elevation: null, error: "elevation_unavailable" });

    await expect(done).rejects.toMatchObject({ code: "elevation_unavailable" });
  });

  it("keeps waiting while the browser reconnects, and rejects once it gives up", async () => {
    const { stream, run } = setup();
    const done = run();
    await flush();

    stream.lose(0); // CONNECTING: reconnecting
    expect(stream.closed).toBe(false);
    stream.lose(2); // CLOSED

    await expect(done).rejects.toMatchObject({ code: "network_error" });
  });

  it("ignores events after it has settled", async () => {
    const { stream, run } = setup();
    const done = run();
    await flush();
    stream.emit("completed", {});
    await done;

    expect(() => stream.emit("failed", { code: "late", message: "late" })).not.toThrow();
    await expect(done).resolves.toBeUndefined();
  });
});
