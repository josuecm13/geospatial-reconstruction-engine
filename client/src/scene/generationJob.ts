import { ApiError } from "../api/client";
import type { ImportStarted } from "../api/types";
import type { EventStream } from "../importing/stagedImport";

/** What generating an area's buildings needs of the API. */
export interface GenerationApi {
  startGeneration(areaId: string, seed?: number): Promise<ImportStarted>;
  importEvents(areaId: string): EventStream;
}

/** `EventSource.CLOSED`: the browser has given up reconnecting. */
const CLOSED = 2;

/** A seed for a Regenerate: a fresh run of the same blocks (contract section 9). `random` is injectable for tests. */
export const newSeed = (random: () => number = Math.random): number => Math.floor(random() * 2 ** 31);

/**
 * Asks the server to generate an area's buildings in the background and follows its event stream: one
 * `generation` event (reported through `onProgress` with its block count), then `completed` (resolves)
 * or `failed` (rejects with an `ApiError` carrying the event's code). A refusal to start (409
 * `import_in_progress` and the like) rejects before any stream is opened; so does a lost stream, with
 * `network_error`. Without a `seed` the server reuses the current run's (or 1).
 */
export async function generateBuildings(api: GenerationApi, areaId: string, seed?: number, onProgress: (blockCount: number | null) => void = () => undefined): Promise<void> {
  const started = await api.startGeneration(areaId, seed);
  const stream = api.importEvents(started.import_area_id);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      stream.close();
      finish();
    };
    const parse = (message: MessageEvent): Record<string, unknown> => {
      try {
        return JSON.parse(message.data) ?? {};
      } catch {
        return {};
      }
    };

    stream.addEventListener("generation", (message) => {
      const { block_count } = parse(message);
      onProgress(typeof block_count === "number" ? block_count : null);
    });
    stream.addEventListener("completed", () => settle(resolve));
    stream.addEventListener("failed", (message) => {
      const { code, message: text, details } = parse(message) as { code?: string; message?: string; details?: Record<string, unknown> | null };
      settle(() => reject(new ApiError(0, code ?? "internal_error", text ?? "the generation failed", details ?? null)));
    });
    stream.addEventListener("error", () => {
      if (stream.readyState !== CLOSED) return; // the browser is reconnecting
      settle(() => reject(new ApiError(0, "network_error", "the generation's event stream was lost")));
    });
  });
}
