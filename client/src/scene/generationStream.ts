import type { Feature, GeneratedBuildingProperties, GeneratedEvent } from "../api/types";

export type GeneratedFeature = Feature<GeneratedBuildingProperties>;

/** The generated buildings a running job has streamed so far. They are provisional until the job completes. */
export interface StreamState {
  /** The ids already streamed, so a replayed event (`Last-Event-ID`) adds nothing twice. */
  seen: ReadonlySet<string>;
  /** Every streamed feature, in arrival order. */
  features: readonly GeneratedFeature[];
  blocksDone: number;
  blockCount: number | null;
  /** Whether the previous run's buildings have been cleared for this run. */
  cleared: boolean;
}

/** What to do to the scene for one event: clear the group first, then add these. */
export interface StreamStep {
  state: StreamState;
  clear: boolean;
  add: GeneratedFeature[];
}

export const initialStream = (): StreamState => ({ seen: new Set(), features: [], blocksDone: 0, blockCount: null, cleared: false });

/** The `generation` event: a new run is starting, so the previous run's buildings go. */
export function streamStarted(blockCount: number | null): StreamStep {
  return { state: { ...initialStream(), blockCount, cleared: true }, clear: true, add: [] };
}

/** A `generated` event: its buildings not seen yet are added; the first one clears the previous run's if the `generation` event hasn't. */
export function streamBatch(state: StreamState, event: Pick<GeneratedEvent, "blocks_done" | "block_count" | "buildings">): StreamStep {
  const seen = new Set(state.seen);
  const add: GeneratedFeature[] = [];
  for (const feature of event.buildings?.features ?? []) {
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    add.push(feature);
  }
  const next: StreamState = { seen, features: [...state.features, ...add], blocksDone: event.blocks_done, blockCount: event.block_count, cleared: true };
  return { state: next, clear: !state.cleared, add };
}

/** `failed`: everything streamed goes. */
export function streamFailed(): StreamState {
  return initialStream();
}
