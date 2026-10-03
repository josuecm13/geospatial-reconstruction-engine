import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { BoundingBox, MapData } from "../api/types";
import { runStagedImport, type EventStream } from "./stagedImport";

const bbox: BoundingBox = { min_latitude: 10, min_longitude: -84, max_latitude: 10.001, max_longitude: -83.999 };
const projection = { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 };
const empty = { type: "FeatureCollection", features: [] };
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

function setup(options: { startError?: Error } = {}) {
  const log: string[] = [];
  const stream = new FakeStream();
  const api = {
    startImport: async () => {
      if (options.startError) throw options.startError;
      return { import_area_id: "a1", events_url: "/import-areas/a1/events" };
    },
    importEvents: () => stream,
    mapData: async (id: string) => ({ scope: { id } }) as unknown as MapData,
  };
  const target = {
    begin: async () => {
      log.push("begin");
      return {
        apply: (step: { layer: string }) => void log.push(`apply:${step.layer}`),
        addBuilt: (data: MapData) => void log.push(`built:${data.scope.id}`),
        complete: () => void log.push("complete"),
        abandon: () => void log.push("abandon"),
        finished: Promise.resolve(),
      };
    },
  };
  return { log, stream, run: () => runStagedImport(api, target, bbox) };
}

describe("runStagedImport", () => {
  it("draws each stage as it arrives, shows inner areas at once, and resolves with the area", async () => {
    const { log, stream, run } = setup();
    const result = run();
    await flush();
    stream.emit("fetched", { projection, element_count: 4, inner_area_ids: ["inner-1"] });
    stream.emit("ground", { projection, area_features: empty, pois: empty });
    stream.emit("roads", { projection, road_segments: empty });
    stream.emit("blocks", { projection, blocks: empty });
    stream.emit("buildings", { projection, ring: 0, buildings: empty });
    stream.emit("completed", { id: "a1" });
    await expect(result).resolves.toEqual({ id: "a1" });
    await flush();
    // The blocks overlay is held until the end; the inner area's map-data lands after the first step.
    expect(log).toEqual(["begin", "apply:fetched", "apply:ground", "apply:roads", "apply:buildings", "apply:blocks", "complete", "built:inner-1"]);
    expect(stream.closed).toBe(true);
  });

  it("abandons the build and rejects with the failed event's code", async () => {
    const { log, stream, run } = setup();
    const result = run();
    await flush();
    stream.emit("ground", { projection, area_features: empty, pois: empty });
    stream.emit("failed", { code: "upstream_unavailable", message: "busy", details: null });
    stream.emit("roads", { projection, road_segments: empty }); // after the end: ignored
    await expect(result).rejects.toMatchObject({ code: "upstream_unavailable", message: "busy" });
    expect(log).toEqual(["begin", "apply:ground", "abandon"]);
    expect(stream.closed).toBe(true);
  });

  it("does not touch the scene when the import cannot start", async () => {
    const { log, run } = setup({ startError: new ApiError(409, "import_in_progress", "already running") });
    await expect(run()).rejects.toMatchObject({ code: "import_in_progress" });
    expect(log).toEqual([]);
  });

  it("gives up only once the browser has stopped reconnecting", async () => {
    const { log, stream, run } = setup();
    const result = run();
    await flush();
    stream.lose(0); // CONNECTING: the browser retries with Last-Event-ID
    expect(log).toEqual(["begin"]);
    stream.lose(2); // CLOSED
    await expect(result).rejects.toMatchObject({ code: "network_error" });
    expect(log).toEqual(["begin", "abandon"]);
  });
});
