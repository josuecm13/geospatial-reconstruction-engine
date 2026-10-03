import type * as maplibregl from "maplibre-gl";
import type { ApiClient } from "../api/client";
import type { BoundaryProperties, BoundingBox, Feature, FeatureCollection, Position } from "../api/types";
import { renderReportedError } from "../errors/errorReporter";
import { sameScope, type Scope, type SelectionStore } from "../state/selection";
import { ringProblem } from "./boundaryGeometry";
import { BOUNDARY_RULE_MESSAGES, reportBoundaryError } from "./boundaryMessages";
import { BoundaryTool, SavedBoundaryLayers, type TraceMode } from "./boundaryTool";

const WHOLE_AREA: Scope = { type: "import_area" };
const WHOLE_AREA_VALUE = "";

/**
 * The side-panel section for boundaries: trace a shape (by vertices or freehand), name and save it,
 * list the open area's saved boundaries, delete them, and choose the client-wide scope (the whole
 * area or one boundary) through the shared `SelectionStore`.
 */
export class BoundaryPanel {
  private readonly tool: BoundaryTool;
  private readonly saved: SavedBoundaryLayers;
  private boundaries: FeatureCollection<BoundaryProperties> = { type: "FeatureCollection", features: [] };
  private listedArea: string | null = null;
  private busy = false;
  private refreshes = 0;
  private readonly el: {
    mode: HTMLSelectElement;
    trace: HTMLButtonElement;
    name: HTMLInputElement;
    save: HTMLButtonElement;
    discard: HTMLButtonElement;
    status: HTMLElement;
    scope: HTMLSelectElement;
    list: HTMLElement;
  };

  constructor(
    container: HTMLElement,
    map: maplibregl.Map,
    private readonly api: ApiClient,
    private readonly selection: SelectionStore,
    /** The rectangle to precheck a traced shape against: the open area's, or the one being drawn. */
    private readonly bounds: () => BoundingBox | null,
    /** Told on every start, finish and cancel of a trace, so other layers can step aside while it runs. */
    private readonly onTracingChange: (tracing: boolean) => void = () => {},
  ) {
    container.innerHTML = `
      <h2>Boundaries</h2>
      <p class="hint">Trace a shape inside the rectangle, save it, and scope the map and scene to it.</p>
      <label class="field">Tracing mode
        <select data-role="mode">
          <option value="vertices">Click vertices</option>
          <option value="freehand">Freehand</option>
        </select>
      </label>
      <button type="button" data-role="trace">Trace boundary</button>
      <label class="field">Name <input type="text" data-role="name" maxlength="100" /></label>
      <button type="button" class="primary" data-role="save" disabled>Save boundary</button>
      <button type="button" data-role="discard" hidden>Discard shape</button>
      <p class="status" data-role="status" role="status" aria-live="polite"></p>
      <label class="field">Scope <select data-role="scope"></select></label>
      <ul class="recent" data-role="list"></ul>`;
    const pick = <T extends HTMLElement>(role: string) => container.querySelector<T>(`[data-role="${role}"]`)!;
    this.el = {
      mode: pick("mode"),
      trace: pick("trace"),
      name: pick("name"),
      save: pick("save"),
      discard: pick("discard"),
      status: pick("status"),
      scope: pick("scope"),
      list: pick("list"),
    };
    this.saved = new SavedBoundaryLayers(map);
    this.tool = new BoundaryTool(map, () => this.traceChanged());
    this.el.trace.addEventListener("click", () => {
      if (this.tool.isTracing) return this.tool.cancel();
      this.setStatus("", "ok");
      this.tool.start(this.el.mode.value as TraceMode);
    });
    this.el.save.addEventListener("click", () => void this.saveOpenArea());
    this.el.discard.addEventListener("click", () => {
      this.tool.clear();
      this.setStatus("", "ok");
    });
    this.el.scope.addEventListener("change", () => {
      this.selection.setScope(this.el.scope.value === WHOLE_AREA_VALUE ? WHOLE_AREA : { type: "boundary", boundaryId: this.el.scope.value });
    });
    this.selection.subscribe((selection) => {
      if (selection.areaId !== this.listedArea) void this.refresh();
      else this.render();
    });
    this.renderName();
    this.render();
    void this.refresh();
  }

  /** Ends a trace in progress and releases the tool's listeners, for when the page is left. Run it before the map is removed. */
  dispose(): void {
    this.tool.dispose();
  }

  /**
   * Saves the traced shape (if there is one) to a freshly imported area and scopes to it. The area
   * import stands whatever happens here: a rejected boundary is shown and the shape is kept, so the
   * user can fix the name or redraw and save again with the panel's button.
   */
  async saveTraced(areaId: string): Promise<void> {
    if (!this.tool.shape) return;
    await this.save(areaId);
  }

  private async saveOpenArea(): Promise<void> {
    const areaId = this.selection.get().areaId;
    if (areaId) await this.save(areaId);
  }

  private async save(areaId: string): Promise<void> {
    const ring = this.tool.shape;
    if (!ring || this.busy) return;
    const problem = this.precheck(ring);
    if (problem) {
      this.setStatus(BOUNDARY_RULE_MESSAGES[problem], "error");
      return;
    }
    this.busy = true;
    this.traceChanged();
    try {
      const created = await this.api.createBoundary(areaId, this.el.name.value.trim(), { type: "Polygon", coordinates: [ring] });
      this.tool.clear();
      this.setStatus(`Saved "${created.properties.name}".`, "ok");
      await this.refresh(areaId);
      this.selection.setScope({ type: "boundary", boundaryId: created.id });
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy = false;
      this.traceChanged();
    }
  }

  private precheck(ring: Position[]) {
    const bbox = this.bounds();
    return bbox ? ringProblem(ring, bbox) : null;
  }

  private async refresh(areaId = this.selection.get().areaId): Promise<void> {
    this.listedArea = areaId;
    const request = ++this.refreshes;
    if (!areaId) {
      this.boundaries = { type: "FeatureCollection", features: [] };
      return this.render();
    }
    try {
      const boundaries = await this.api.listBoundaries(areaId);
      if (request !== this.refreshes) return; // a newer refresh (or another area) superseded this one
      this.boundaries = boundaries;
      // A remembered scope can name a boundary deleted since (or by another client).
      const scope = this.selection.get().scope;
      if (scope.type === "boundary" && !boundaries.features.some((feature) => feature.id === scope.boundaryId)) {
        this.selection.setScope(WHOLE_AREA);
      }
    } catch (error) {
      this.showError(error);
    }
    this.renderName();
    this.render();
  }

  private async remove(boundary: Feature<BoundaryProperties>): Promise<void> {
    const areaId = this.selection.get().areaId;
    if (!areaId || !window.confirm(`Delete the boundary "${boundary.properties.name}"?`)) return;
    try {
      const scope = this.selection.get().scope;
      // Leave the scope first, so nothing asks the server for a boundary that is about to be gone.
      if (scope.type === "boundary" && scope.boundaryId === boundary.id) this.selection.setScope(WHOLE_AREA);
      await this.api.deleteBoundary(areaId, boundary.id);
      this.setStatus(`Deleted "${boundary.properties.name}".`, "ok");
    } catch (error) {
      this.showError(error);
    }
    await this.refresh(areaId);
  }

  private traceChanged(): void {
    const tracing = this.tool.isTracing;
    const shape = this.tool.shape;
    this.onTracingChange(tracing);
    this.el.trace.textContent = tracing ? "Cancel tracing (Esc)" : shape ? "Trace again" : "Trace boundary";
    this.el.mode.disabled = tracing;
    this.el.save.disabled = !shape || this.busy || !this.selection.get().areaId;
    this.el.discard.hidden = !shape;
    if (tracing) {
      this.setStatus(
        this.el.mode.value === "vertices"
          ? "Click to add corners. Click the first corner or double-click to close the shape."
          : "Press on the map, drag around the shape, and release to close it.",
        "busy",
      );
    } else if (shape && !this.busy && this.el.status.dataset.state === "busy") {
      this.setStatus(this.selection.get().areaId ? "Shape ready. Name it and save." : "Shape ready. It is saved when you import.", "ok");
    }
  }

  private renderName(): void {
    this.el.name.value = `Boundary ${this.boundaries.features.length + 1}`;
  }

  private render(): void {
    const { scope, areaId } = this.selection.get();
    const selectedId = scope.type === "boundary" ? scope.boundaryId : null;
    this.saved.show(this.boundaries, selectedId);
    this.el.save.disabled = !this.tool.shape || this.busy || !areaId;

    const whole = Object.assign(document.createElement("option"), { value: WHOLE_AREA_VALUE, textContent: "Whole area" });
    this.el.scope.replaceChildren(
      whole,
      ...this.boundaries.features.map((boundary) =>
        Object.assign(document.createElement("option"), { value: boundary.id, textContent: boundary.properties.name }),
      ),
    );
    this.el.scope.value = selectedId ?? WHOLE_AREA_VALUE;
    this.el.scope.disabled = !areaId;

    this.el.list.replaceChildren(
      ...(this.boundaries.features.length
        ? this.boundaries.features.map((boundary) => this.entry(boundary, sameScope(scope, { type: "boundary", boundaryId: boundary.id })))
        : [Object.assign(document.createElement("li"), { textContent: "No saved boundaries", className: "hint" })]),
    );
  }

  private entry(boundary: Feature<BoundaryProperties>, selected: boolean): HTMLElement {
    const li = document.createElement("li");
    li.className = "boundary-entry";
    const select = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: boundary.properties.name });
    if (selected) select.setAttribute("aria-current", "true");
    select.addEventListener("click", () => this.selection.setScope({ type: "boundary", boundaryId: boundary.id }));
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "link danger", textContent: "Delete" });
    remove.setAttribute("aria-label", `Delete ${boundary.properties.name}`);
    remove.addEventListener("click", () => void this.remove(boundary));
    li.append(select, remove);
    return li;
  }

  private showError(error: unknown): void {
    renderReportedError(this.el.status, reportBoundaryError(error));
    this.el.status.dataset.state = "error";
  }

  private setStatus(text: string, state: "ok" | "busy" | "error"): void {
    this.el.status.textContent = text;
    this.el.status.dataset.state = state;
  }
}
