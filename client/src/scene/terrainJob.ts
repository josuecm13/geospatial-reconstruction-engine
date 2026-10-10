import { ApiError } from "../api/client";
import type { ImportStarted } from "../api/types";
import type { EventStream } from "../importing/stagedImport";

/** What re-analysing an area's terrain needs of the API. */
export interface TerrainApi {
  analyseElevation(areaId: string): Promise<ImportStarted>;
  importEvents(areaId: string): EventStream;
}

/** `EventSource.CLOSED`: the browser has given up reconnecting. */
const CLOSED = 2;

/**
 * Asks the server to analyse an area's terrain in the background and follows its event stream: one
 * `elevation` event (reported through `onElevation`), then `completed` (resolves) or `failed` (rejects with
 * an `ApiError` carrying the event's code). A refusal to start (409 `import_in_progress` and the like)
 * rejects before any stream is opened; so does a lost stream, with `network_error`.
 */
export async function analyseTerrain(api: TerrainApi, areaId: string, onElevation: () => void = () => undefined): Promise<void> {
  const started = await api.analyseElevation(areaId);
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

    stream.addEventListener("elevation", (message) => {
      const { error } = parse(message);
      // The re-analysis reports a source failure as `failed`; an error here is treated the same way.
      if (typeof error === "string" && error) settle(() => reject(new ApiError(0, error, error)));
      else onElevation();
    });
    stream.addEventListener("completed", () => settle(resolve));
    stream.addEventListener("failed", (message) => {
      const { code, message: text, details } = parse(message) as { code?: string; message?: string; details?: Record<string, unknown> | null };
      settle(() => reject(new ApiError(0, code ?? "internal_error", text ?? "the terrain analysis failed", details ?? null)));
    });
    stream.addEventListener("error", () => {
      if (stream.readyState !== CLOSED) return; // the browser is reconnecting
      settle(() => reject(new ApiError(0, "network_error", "the terrain analysis's event stream was lost")));
    });
  });
}
