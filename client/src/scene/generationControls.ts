import type { GenerationRun, Projection } from "../api/types";
import { type BlockFeedbackApi } from "./blockPanel";
import { generateBuildings, newSeed, type GenerationApi } from "./generationJob";
import { generateButtonState, generationFailureMessage, generationProgressText, generationStreamText } from "./generationMessages";
import { initialStream, streamBatch, streamFailed, streamStarted, type GeneratedFeature, type StreamState, type StreamStep } from "./generationStream";

/** What Generate needs: the API, the open area, and a way to reload the scene once the run is stored. The API also carries the block feedback calls the block panel makes. */
export interface GenerationDeps {
  api: GenerationApi & BlockFeedbackApi;
  areaId(): string | null;
  /** Loads the open area's map-data again and rebuilds the world from it. */
  reload(): void;
  /** The 2D map's generated layer: every building streamed so far (the run's provisional buildings), or `null` to go back to the stored ones. */
  streamed?(features: GeneratedFeature[] | null): void;
}

/** Where streamed generated buildings go in the 3D scene. */
export interface GenerationSink {
  /** Removes every generated building on show (the previous run's, or the streamed ones). */
  clear(): void;
  /** Queues a batch to rise block by block on the reveal schedule; a feature already on show is skipped. `blockCount` blocks are expected (0 when unknown). */
  add(features: GeneratedFeature[], projection: Projection, blocksDone: number, blockCount: number): void;
  /** Resolves when every streamed block has risen: `true`, or `false` if the world was replaced meanwhile (nothing to reload). */
  whenIdle(): Promise<boolean>;
}

export interface GenerationControls {
  /** Called when a world is loaded with its area's run (`null`: none). Updates the button, and the Show generated checkbox. */
  setWorld(run: GenerationRun | null): void;
  /** Called when the scene has no finished world (placeholder, staged build): hides everything. */
  clear(): void;
}

/**
 * The Generate / Regenerate button, the progress line, and the "Show generated" checkbox.
 *
 * Generate (no run yet) lets the server pick the seed; Regenerate asks for a new random one. Progress
 * follows the event stream as "Add terrain" does; on `completed` the world is reloaded, and arrives
 * through `setWorld`. A failure shows its sentence (generationMessages.ts) and leaves the button to
 * try again. "Show generated" is checked when a run first appears (a new run id), and the user's
 * choice is kept across reloads of the same run. The button goes in `actions`, the status line in
 * `container`, the checkbox in `toggles`; `onShow` is told whether generated buildings are shown.
 *
 * While a job runs its `generated` batches stream into the scene (`sink`) and the 2D map (`deps.streamed`):
 * the `generation` event clears the previous run's buildings, "Show generated" is ticked, and the status line
 * counts blocks. They are provisional: on `failed` they all go and the stored run is loaded again.
 */
export function createGenerationControls(
  actions: HTMLElement,
  container: HTMLElement,
  toggles: HTMLElement,
  deps: GenerationDeps,
  /** `animate`: the user just ticked or unticked the box with no job running, so the buildings fill in (ticked) or go (unticked). */
  onShow: (shown: boolean, animate?: boolean) => void,
  sink: GenerationSink,
): GenerationControls {
  const button = Object.assign(document.createElement("button"), { className: "scene-terrain scene-generate", type: "button", hidden: true });
  const note = Object.assign(document.createElement("div"), { className: "scene-terrain-note scene-generation-note", hidden: true });
  note.setAttribute("role", "status");
  const show = Object.assign(document.createElement("input"), { type: "checkbox", checked: true });
  const showLabel = Object.assign(document.createElement("label"), { hidden: true });
  showLabel.append(show, " Show generated");
  actions.appendChild(button);
  container.appendChild(note);
  toggles.appendChild(showLabel);

  const say = (text: string | null, error = false) => {
    note.hidden = text === null;
    note.textContent = text ?? "";
    note.classList.toggle("error", error);
  };
  let running = false;
  let run: GenerationRun | null = null; // the run of the world on show; kept while a job runs, for when it ends
  let present = false; // whether a finished world is on show
  let shownRun: string | null = null;
  let streaming = false; // a job's buildings are on show, with or without a stored run
  let failure = false; // the error line stays through the reload that restores the stored run

  const render = () => {
    const state = generateButtonState(run);
    button.textContent = running ? "Generating…" : state.label;
    button.title = running ? "" : state.title;
    button.classList.toggle("stale", state.stale && !running);
    button.hidden = !present;
    button.disabled = running;
    showLabel.hidden = !present || (!run && !streaming);
  };
  show.addEventListener("change", () => onShow(show.checked, !running));

  button.addEventListener("click", async () => {
    const areaId = deps.areaId();
    if (!areaId || running) return;
    running = true;
    failure = false;
    let state: StreamState = initialStream();
    const apply = (step: StreamStep, projection?: Projection) => {
      state = step.state;
      if (step.clear) sink.clear();
      if (step.add.length && projection) sink.add(step.add, projection, step.state.blocksDone, step.state.blockCount ?? 0);
      if (step.clear || step.add.length) deps.streamed?.([...state.features]);
      // Streaming shows the buildings at once, whatever the box said.
      streaming = true;
      show.checked = true;
      onShow(true);
    };
    render();
    say(generationProgressText(null));
    try {
      await generateBuildings(
        deps.api,
        areaId,
        run ? newSeed() : undefined,
        (blocks) => {
          apply(streamStarted(blocks));
          say(generationProgressText(blocks));
          render();
        },
        (event) => {
          apply(streamBatch(state, event), event.projection);
          say(generationStreamText(state.blocksDone, state.blockCount ?? event.block_count));
          render();
        },
      );
      say(null);
      // The reveal is still playing: reloading now would rebuild the world and finish every pending rise at once.
      if (await sink.whenIdle()) deps.reload(); // the new world arrives through `setWorld`, with the stored run's buildings
    } catch (error) {
      // The streamed buildings were provisional: remove them and load the stored run again.
      state = streamFailed();
      if (streaming) {
        sink.clear();
        deps.streamed?.(null);
        failure = true;
        deps.reload();
      }
      say(generationFailureMessage(error), true);
    } finally {
      running = false;
      streaming = false;
      render();
    }
  });

  return {
    setWorld(next) {
      run = next;
      present = true;
      if (next && next.run_id !== shownRun) show.checked = true;
      shownRun = next?.run_id ?? null;
      onShow(!!next && show.checked);
      render();
      if (failure) failure = false; // the reload after a failed job keeps its error line
      else if (!running) say(null); // a job in progress keeps its progress line
    },
    clear() {
      run = null;
      present = false;
      shownRun = null;
      if (!running) say(null);
      render();
    },
  };
}
