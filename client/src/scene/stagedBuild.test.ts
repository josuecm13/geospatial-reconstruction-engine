import { describe, expect, it } from "vitest";
import type { ImportArea, ImportStage, Projection, StageEvent } from "../api/types";
import { StagedBuild, type RevealStep } from "./stagedBuild";

const projection: Projection = { origin: { latitude: 10, longitude: -84 }, meters_per_degree_latitude: 110_000, meters_per_degree_longitude: 109_000 };
const empty = { type: "FeatureCollection" as const, features: [] };
const area = { id: "area-1" } as ImportArea;

/** One event per stage; a buildings event takes its ring. Casts keep the fixture to the fields the machine reads. */
function event(stage: ImportStage, ring = 0): StageEvent {
  const data = {
    fetched: { projection, element_count: 3, inner_area_ids: ["inner-1"] },
    ground: { projection, area_features: empty, pois: empty },
    roads: { projection, road_segments: empty },
    blocks: { projection, blocks: empty },
    buildings: { projection, ring, buildings: empty },
    generated: {},
    completed: area,
    failed: { code: "ingestion_failed", message: "bad way", details: null },
  }[stage];
  return { stage, data } as StageEvent;
}

/** Feeds the events and lists the layer of every step they produce ("buildings:k" carries the ring). */
function play(machine: StagedBuild, events: StageEvent[]): string[] {
  return events.flatMap((e) => machine.push(e)).map(label);
}
const label = (step: RevealStep) => (step.layer === "buildings" ? `buildings:${step.ring}` : step.layer);

describe("StagedBuild", () => {
  it("plays the stages in the server's order, with blocks revealed last", () => {
    const machine = new StagedBuild();
    const steps = play(machine, [event("fetched"), event("ground"), event("roads"), event("blocks"), event("buildings", 0), event("buildings", 1), event("completed")]);
    expect(steps).toEqual(["fetched", "ground", "roads", "buildings:0", "buildings:1", "blocks"]);
    expect(machine.end).toEqual({ kind: "done", area });
  });

  it("holds the blocks back until after the last ring", () => {
    const machine = new StagedBuild();
    play(machine, [event("fetched"), event("ground"), event("roads")]);
    expect(machine.push(event("blocks"))).toEqual([]);
    expect(play(machine, [event("buildings", 0)])).toEqual(["buildings:0"]);
    expect(machine.end).toBeNull();
    expect(play(machine, [event("completed")])).toEqual(["blocks"]);
  });

  it("carries the inner area ids of fetched, and none when the server sends none", () => {
    const withInner = new StagedBuild().push(event("fetched"));
    expect(withInner).toEqual([{ layer: "fetched", projection, innerAreaIds: ["inner-1"] }]);
    const without = { stage: "fetched", data: { projection, element_count: 0 } } as StageEvent;
    expect(new StagedBuild().push(without)).toEqual([{ layer: "fetched", projection, innerAreaIds: [] }]);
  });

  it("ignores a repeated stage and a repeated ring", () => {
    const machine = new StagedBuild();
    const steps = play(machine, [
      event("fetched"),
      event("fetched"), // a reconnect replays it
      event("ground"),
      event("ground"),
      event("roads"),
      event("buildings", 0),
      event("buildings", 0),
      event("buildings", 1),
      event("buildings", 1),
      event("completed"),
      event("completed"),
    ]);
    expect(steps).toEqual(["fetched", "ground", "roads", "buildings:0", "buildings:1"]);
  });

  it("ignores a stage that arrives after a later one", () => {
    const machine = new StagedBuild();
    const steps = play(machine, [event("roads"), event("ground"), event("buildings", 0), event("roads"), event("buildings", 0), event("blocks"), event("buildings", 1), event("completed")]);
    // ground and the second roads come late; the blocks event follows buildings, so it is late too.
    expect(steps).toEqual(["roads", "buildings:0", "buildings:1"]);
  });

  it("skips the reserved generated slot when it is absent, and ignores it when present", () => {
    const absent = new StagedBuild();
    expect(play(absent, [event("roads"), event("completed")])).toEqual(["roads"]);
    const present = new StagedBuild();
    expect(play(present, [event("roads"), event("blocks"), event("generated"), event("completed")])).toEqual(["roads", "blocks"]);
    expect(present.end).toEqual({ kind: "done", area });
  });

  it("ends failed mid-way with the server's code and plays nothing after", () => {
    const machine = new StagedBuild();
    const steps = play(machine, [event("fetched"), event("ground"), event("blocks"), event("failed"), event("roads"), event("buildings", 0), event("completed")]);
    expect(steps).toEqual(["fetched", "ground"]);
    expect(machine.end).toEqual({ kind: "failed", code: "ingestion_failed", message: "bad way", details: null });
  });

  it("drops the held blocks when the build fails before they are released", () => {
    const machine = new StagedBuild();
    play(machine, [event("blocks"), event("buildings", 0)]);
    expect(play(machine, [event("failed"), event("completed")])).toEqual([]);
    expect(machine.end?.kind).toBe("failed");
  });
});
