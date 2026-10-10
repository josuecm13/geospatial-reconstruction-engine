import type { GenerationRun } from "../api/types";
import { generateBuildings, newSeed, type GenerationApi } from "./generationJob";
import { generateButtonState, generationFailureMessage, generationProgressText } from "./generationMessages";

/** What Generate needs: the API, the open area, and a way to reload the scene once the run is stored. */
export interface GenerationDeps {
  api: GenerationApi;
  areaId(): string | null;
  /** Loads the open area's map-data again and rebuilds the world from it. */
  reload(): void;
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
 */
export function createGenerationControls(actions: HTMLElement, container: HTMLElement, toggles: HTMLElement, deps: GenerationDeps, onShow: (shown: boolean) => void): GenerationControls {
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

  const render = () => {
    const state = generateButtonState(run);
    button.textContent = running ? "Generating…" : state.label;
    button.title = running ? "" : state.title;
    button.classList.toggle("stale", state.stale && !running);
    button.hidden = !present;
    button.disabled = running;
    showLabel.hidden = !present || !run;
  };
  show.addEventListener("change", () => onShow(show.checked));

  button.addEventListener("click", async () => {
    const areaId = deps.areaId();
    if (!areaId || running) return;
    running = true;
    render();
    say(generationProgressText(null));
    try {
      await generateBuildings(deps.api, areaId, run ? newSeed() : undefined, (blocks) => say(generationProgressText(blocks)));
      say(null);
      deps.reload(); // the new world arrives through `setWorld`
    } catch (error) {
      say(generationFailureMessage(error), true);
    } finally {
      running = false;
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
      if (!running) say(null); // a job in progress keeps its progress line
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
