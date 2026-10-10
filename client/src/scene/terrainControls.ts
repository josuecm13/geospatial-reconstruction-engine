import { analyseTerrain, type TerrainApi } from "./terrainJob";
import { terrainFailureMessage } from "./terrainMessages";

/** What "Add terrain" needs: the API, the open area, and a way to reload the scene once the terrain is stored. */
export interface TerrainDeps {
  api: TerrainApi;
  areaId(): string | null;
  /** Loads the open area's map-data again and rebuilds the world from it. */
  reload(): void;
}

export interface TerrainControls {
  /** Called when a world is loaded: `true` when its area has no terrain, which shows the button. `false` hides it. */
  setWorld(flat: boolean): void;
}

const LABEL = "Add terrain";
const WORKING = "Adding terrain…";

/**
 * The quiet "Add terrain" button for an area that was imported flat. It asks the server to analyse the
 * area's ground, shows progress while the job runs, then reloads the world on `completed`. A failure
 * shows its sentence (terrainMessages.ts) and leaves the button to try again. The button goes in
 * `actions`; the status line in `container`.
 */
export function createTerrainControls(actions: HTMLElement, container: HTMLElement, deps: TerrainDeps): TerrainControls {
  const button = Object.assign(document.createElement("button"), { className: "scene-terrain", type: "button", textContent: LABEL, hidden: true });
  const note = Object.assign(document.createElement("div"), { className: "scene-terrain-note", hidden: true });
  note.setAttribute("role", "status");
  actions.appendChild(button);
  container.appendChild(note);

  const say = (text: string | null, error = false) => {
    note.hidden = text === null;
    note.textContent = text ?? "";
    note.classList.toggle("error", error);
  };
  let running = false;
  let flat = false; // whether the world on show has no terrain; kept while a job runs, for when it ends

  button.addEventListener("click", async () => {
    const areaId = deps.areaId();
    if (!areaId || running) return;
    running = true;
    button.disabled = true;
    button.textContent = WORKING;
    say("Fetching the ground heights for this place…");
    try {
      await analyseTerrain(deps.api, areaId, () => say("Terrain analysed, loading it…"));
      say(null);
      flat = false; // until the reloaded world says otherwise
      deps.reload(); // the new world arrives through `setWorld`
    } catch (error) {
      say(terrainFailureMessage(error), true);
    } finally {
      running = false;
      button.disabled = false;
      button.textContent = LABEL;
      button.hidden = !flat;
    }
  });

  return {
    setWorld(isFlat) {
      flat = isFlat;
      if (running) return; // a job in progress keeps its button and its progress line
      button.hidden = !flat;
      say(null);
    },
  };
}
