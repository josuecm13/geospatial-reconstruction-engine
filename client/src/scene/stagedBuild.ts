import type {
  AreaFeatureProperties,
  BlockProperties,
  BuildingProperties,
  FeatureCollection,
  ImportArea,
  PoiProperties,
  Projection,
  RoadSegmentProperties,
  StageEvent,
} from "../api/types";

/** One thing to show, in the order to show it. `fetched` has nothing to draw: it ends the waiting animation. */
export type RevealStep =
  | { layer: "fetched"; projection: Projection; innerAreaIds: string[] }
  | { layer: "ground"; projection: Projection; areaFeatures: FeatureCollection<AreaFeatureProperties>; pois: FeatureCollection<PoiProperties> }
  | { layer: "roads"; projection: Projection; roadSegments: FeatureCollection<RoadSegmentProperties> }
  | { layer: "buildings"; projection: Projection; ring: number; buildings: FeatureCollection<BuildingProperties> }
  | { layer: "blocks"; projection: Projection; blocks: FeatureCollection<BlockProperties> };

export type BuildEnd =
  | { kind: "done"; area: ImportArea }
  | { kind: "failed"; code: string; message: string; details: Record<string, unknown> | null };

/** Where each stage sits in the order. A stage is accepted only if it is later than everything seen so far. */
const RANK = { fetched: 0, ground: 1, roads: 2, blocks: 3, buildings: 4, generated: 5, completed: 6 } as const;

/**
 * The staged build as a state machine: feed it the server's events as they arrive and it returns the
 * reveal steps now ready to play. It enforces the order ground, roads, buildings (one step per ring,
 * centre outward), then blocks, and ignores an event that repeats or arrives out of order (an
 * `EventSource` reconnect replays from `Last-Event-ID`, so a duplicate is possible).
 *
 * The server streams blocks before buildings, because buildings link to their blocks. The blocks overlay
 * is held back and revealed after the last ring (when `generated` or `completed` arrives). A `failed`
 * event drops it and plays nothing more.
 */
export class StagedBuild {
  private rank = -1;
  private lastRing = -1;
  private held: RevealStep | null = null;
  private ended: BuildEnd | null = null;

  /** Set once the stream ended: `done` with the completed area, or `failed` with the server's code. */
  get end(): BuildEnd | null {
    return this.ended;
  }

  /** The reveal steps that `event` makes ready, in play order. */
  push(event: StageEvent): RevealStep[] {
    if (this.ended) return [];
    if (event.stage === "failed") {
      this.held = null;
      this.ended = { kind: "failed", ...event.data };
      return [];
    }
    const rank = RANK[event.stage];
    // Buildings come once per ring: the same stage repeats, with a rising ring.
    if (event.stage === "buildings") {
      if (rank < this.rank || event.data.ring <= this.lastRing) return [];
    } else if (rank <= this.rank) {
      return [];
    }
    this.rank = rank;

    switch (event.stage) {
      case "fetched":
        return [{ layer: "fetched", projection: event.data.projection, innerAreaIds: event.data.inner_area_ids ?? [] }];
      case "ground":
        return [{ layer: "ground", projection: event.data.projection, areaFeatures: event.data.area_features, pois: event.data.pois }];
      case "roads":
        return [{ layer: "roads", projection: event.data.projection, roadSegments: event.data.road_segments }];
      case "blocks":
        this.held = { layer: "blocks", projection: event.data.projection, blocks: event.data.blocks };
        return [];
      case "buildings":
        this.lastRing = event.data.ring;
        return [{ layer: "buildings", projection: event.data.projection, ring: event.data.ring, buildings: event.data.buildings }];
      case "generated": // a reserved slot: nothing to draw yet
        return this.release();
      case "completed":
        this.ended = { kind: "done", area: event.data };
        return this.release();
    }
  }

  private release(): RevealStep[] {
    const steps = this.held ? [this.held] : [];
    this.held = null;
    return steps;
  }
}
