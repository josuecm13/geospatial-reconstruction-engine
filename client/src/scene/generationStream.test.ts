import { describe, expect, it } from "vitest";
import type { Feature, GeneratedBuildingProperties } from "../api/types";
import { initialStream, streamBatch, streamFailed, streamStarted } from "./generationStream";

const feature = (id: string) =>
  ({ type: "Feature", id, geometry: { type: "Polygon", coordinates: [] }, properties: { height_meters: 6 } }) as unknown as Feature<GeneratedBuildingProperties>;
const batch = (done: number, ...ids: string[]) => ({ blocks_done: done, block_count: 10, buildings: { type: "FeatureCollection" as const, features: ids.map(feature) } });

describe("the generated stream", () => {
  it("clears the previous run on the generation event, then accumulates batches", () => {
    const started = streamStarted(10);
    expect(started.clear).toBe(true);
    const first = streamBatch(started.state, batch(2, "a", "b"));
    expect(first.clear).toBe(false);
    expect(first.add.map((f) => f.id)).toEqual(["a", "b"]);
    const second = streamBatch(first.state, batch(5, "c"));
    expect(second.add.map((f) => f.id)).toEqual(["c"]);
    expect(second.state.features.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(second.state.blocksDone).toBe(5);
    expect(second.state.blockCount).toBe(10);
  });

  it("skips ids already streamed, so a replay adds nothing twice", () => {
    const first = streamBatch(streamStarted(10).state, batch(2, "a", "b"));
    const replay = streamBatch(first.state, batch(2, "a", "b", "c"));
    expect(replay.add.map((f) => f.id)).toEqual(["c"]);
    expect(replay.state.features).toHaveLength(3);
  });

  it("clears the previous run's buildings before the first batch when no generation event came", () => {
    const first = streamBatch(initialStream(), batch(1, "a"));
    expect(first.clear).toBe(true);
    expect(streamBatch(first.state, batch(2, "b")).clear).toBe(false);
  });

  it("a regenerate's generation event starts again from nothing", () => {
    const run = streamBatch(streamStarted(10).state, batch(2, "a"));
    const again = streamStarted(12);
    expect(again.clear).toBe(true);
    expect(again.state.features).toEqual([]);
    expect(streamBatch(again.state, batch(1, "a")).add.map((f) => f.id)).toEqual(["a"]);
    expect(run.state.features).toHaveLength(1);
  });

  it("failed leaves nothing", () => {
    const run = streamBatch(streamStarted(10).state, batch(2, "a"));
    expect(run.state.features).toHaveLength(1);
    expect(streamFailed().features).toEqual([]);
    expect(streamFailed().seen.size).toBe(0);
  });
});
