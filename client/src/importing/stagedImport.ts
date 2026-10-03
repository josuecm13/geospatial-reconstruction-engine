import { ApiError } from "../api/client";
import { IMPORT_STAGES, type BoundingBox, type ImportArea, type ImportStage, type ImportStarted, type MapData, type StageEvent } from "../api/types";
import { StagedBuild } from "../scene/stagedBuild";
import type { StagedHandle } from "../scene/stagedScene";

/** Where a staged build is drawn: opens the scene and starts a build there. */
export interface StagedTarget {
  begin(bbox: BoundingBox): Promise<StagedHandle>;
}

/** The part of `EventSource` this flow uses. */
export interface EventStream {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  readonly readyState: number;
}

export interface StagedImportApi {
  startImport(bbox: BoundingBox): Promise<ImportStarted>;
  importEvents(areaId: string): EventStream;
  mapData(areaId: string): Promise<MapData>;
}

/** `EventSource.CLOSED`: the browser has given up reconnecting. */
const CLOSED = 2;

/**
 * Imports a rectangle in the server's background and draws each stage as its event arrives.
 * Resolves with the completed area (the animation may still be playing; the target's handle knows
 * when it ends). Rejects with an `ApiError` carrying the `failed` event's code, or `network_error`
 * if the stream is lost. A failure to start (for example 409 `import_in_progress`) rejects before
 * the scene is touched. Aborting `signal` closes the stream and rejects with an `AbortError`, without
 * abandoning the build.
 */
export async function runStagedImport(api: StagedImportApi, target: StagedTarget, bbox: BoundingBox, signal?: AbortSignal): Promise<ImportArea> {
  const aborted = () => new DOMException("aborted", "AbortError");
  if (signal?.aborted) throw aborted();
  const started = await api.startImport(bbox);
  if (signal?.aborted) throw aborted();
  const handle = await target.begin(bbox);
  if (signal?.aborted) throw aborted();
  const stream = api.importEvents(started.import_area_id);
  const build = new StagedBuild();

  return new Promise<ImportArea>((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      stream.close();
      finish();
    };

    const onEvent = (stage: ImportStage) => (message: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      for (const step of build.push({ stage, data } as StageEvent)) {
        handle.apply(step);
        // Inner areas are already built: show them fully, at once, without waiting for the rings.
        if (step.layer === "fetched") {
          for (const id of step.innerAreaIds) api.mapData(id).then((inner) => handle.addBuilt(inner), () => undefined);
        }
      }
      const end = build.end;
      if (end?.kind === "done") {
        settle(() => {
          handle.complete();
          resolve(end.area);
        });
      } else if (end?.kind === "failed") {
        settle(() => {
          handle.abandon();
          reject(new ApiError(0, end.code, end.message, end.details));
        });
      }
    };

    // Aborting (the page is being left) only closes the stream: the server's import carries on, and the
    // scene goes away with the page, so the build is not abandoned.
    signal?.addEventListener("abort", () => settle(() => reject(aborted())), { once: true });

    for (const stage of IMPORT_STAGES) stream.addEventListener(stage, onEvent(stage));
    // While the browser is reconnecting there is nothing to do; once it has given up, the build is lost.
    stream.addEventListener("error", () => {
      if (stream.readyState !== CLOSED) return;
      settle(() => {
        handle.abandon();
        reject(new ApiError(0, "network_error", "the import's event stream was lost"));
      });
    });
  });
}
