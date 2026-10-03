import type * as maplibregl from "maplibre-gl";
import type { ApiClient } from "../api/client";
import type { BoundingBox, ImportArea, MapData } from "../api/types";
import { areaSquareMeters, bboxProblem, formatSquareKilometers, MAX_AREA_SQUARE_METERS, roundBbox } from "../geo/bbox";
import type { MapDataLayers } from "../views/mapDataLayers";
import { renderReportedError, useErrorReporter } from "../errors/errorReporter";
import { IMPORT_MESSAGES } from "./errorMessages";
import { RectangleTool } from "./rectangleTool";
import { ApiError } from "../api/client";
import { mapDataQuery, sameScope, type Scope, type SelectionStore } from "../state/selection";
import { describeArea, findByBbox } from "./recentImports";
import { flyToArea } from "../locations/flyTo";
import type { Camera } from "../routing/routes";
import { runStagedImport, type StagedTarget } from "./stagedImport";

/** How many completed areas the panel fetches, to tell a re-import of a rectangle from a new one. */
const LISTED_AREAS = 200;
const reportError = useErrorReporter(IMPORT_MESSAGES);

export const REIMPORT_WARNING =
  "This rectangle was imported before. Importing it again reconciles it with OpenStreetMap as it is " +
  "today: anything OpenStreetMap no longer has is deleted from this area, including its streets, " +
  "buildings, and blocks. Continue?";

/** The 2D picker: draw a rectangle up to 1 km², import it live, and see what the engine built. */
export class ImportPanel {
  private readonly tool: RectangleTool;
  /** Completed import areas from the API, most recent first. */
  private areas: ImportArea[] = [];
  /** The area on the map now, for the line under "Imported areas". */
  private openArea: ImportArea | null = null;
  private readonly el: {
    draw: HTMLButtonElement;
    area: HTMLElement;
    importButton: HTMLButtonElement;
    status: HTMLElement;
    recent: HTMLElement;
  };
  private busy = false;
  /** Aborted when the page is left, to close a running import's event stream. */
  private readonly leaving = new AbortController();
  /** The area and scope whose map data is on the map now. */
  private shown: { areaId: string; scope: Scope } | null = null;
  /** A camera move requested while the map was hidden (it has no size then); `shown()` plays it. */
  private pendingCamera: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly map: maplibregl.Map,
    private readonly api: ApiClient,
    private readonly layers: MapDataLayers,
    private readonly selection: SelectionStore,
    /** Runs after an import succeeds and its area is open, for example to save a traced boundary. */
    private readonly afterImport: (areaId: string) => Promise<void> = async () => {},
    /** Where an import is built in front of the user. Without it the import runs in one request, with no animation. */
    private readonly staging?: StagedTarget,
  ) {
    container.innerHTML = `
      <h2>Import a place</h2>
      <p class="hint">Draw a rectangle of up to 1 km², then import it live from OpenStreetMap.</p>
      <button type="button" data-role="draw">Draw rectangle</button>
      <p class="area-readout" data-role="area">No rectangle yet</p>
      <button type="button" class="primary" data-role="import" disabled>Import from OpenStreetMap</button>
      <p class="status" data-role="status" role="status" aria-live="polite"></p>
      <h3>Imported areas</h3>
      <p class="hint" data-role="recent">Loading…</p>
      <a class="browse-locations" data-link href="/locations">Browse locations</a>`;
    const pick = <T extends HTMLElement>(role: string) => container.querySelector<T>(`[data-role="${role}"]`)!;
    this.el = {
      draw: pick("draw"),
      area: pick("area"),
      importButton: pick("import"),
      status: pick("status"),
      recent: pick("recent"),
    };
    this.tool = new RectangleTool(map, (bbox) => this.selectionChanged(bbox));
    this.el.draw.addEventListener("click", () => {
      this.el.draw.textContent = "Drag on the map…";
      this.tool.startDrawing();
    });
    this.el.importButton.addEventListener("click", () => void this.importSelection());
    // Map layers follow the shared scope: choosing a boundary (or the whole area) reloads them.
    this.selection.subscribe((selection) => {
      const shown = this.shown;
      if (shown && selection.areaId === shown.areaId && !sameScope(selection.scope, shown.scope)) void this.reloadMapData(selection.scope);
    });
    void this.refreshAreas();
  }

  /** Call when the map's container becomes visible again: resizes the map and plays any camera move that waited for it. */
  mapShown(): void {
    this.map.resize();
    const move = this.pendingCamera;
    this.pendingCamera = null;
    move?.();
  }

  /** Closes a running import's event stream (the import itself carries on in the server) and releases the rectangle tool's listeners. */
  dispose(): void {
    this.leaving.abort();
    this.tool.dispose();
  }

  /** The rectangle on the map: the one being drawn, or the open area's. */
  get bbox(): BoundingBox | null {
    return this.tool.bbox;
  }

  private selectionChanged(bbox: BoundingBox | null): void {
    this.el.draw.textContent = "Redraw rectangle";
    if (!bbox) return;
    const problem = bboxProblem(bbox);
    const area = areaSquareMeters(bbox);
    this.el.area.textContent =
      problem === "too_large"
        ? `${formatSquareKilometers(area)}: too large, the limit is ${formatSquareKilometers(MAX_AREA_SQUARE_METERS)}`
        : `${formatSquareKilometers(area)} of ${formatSquareKilometers(MAX_AREA_SQUARE_METERS)}`;
    this.el.area.dataset.state = problem ? "invalid" : "ok";
    this.el.importButton.disabled = this.busy || problem !== null;
    this.el.importButton.textContent = findByBbox(this.areas, roundBbox(bbox)) ? "Re-import from OpenStreetMap" : "Import from OpenStreetMap";
  }

  private async importSelection(): Promise<void> {
    const drawn = this.tool.bbox;
    if (!drawn || bboxProblem(drawn) !== null || this.busy) return;
    const bbox = roundBbox(drawn);
    if (findByBbox(this.areas, bbox) && !window.confirm(REIMPORT_WARNING)) return;

    this.busy = true;
    this.el.importButton.disabled = true;
    const started = performance.now();
    const tick = () => this.setStatus(`Importing from OpenStreetMap… ${Math.round((performance.now() - started) / 1000)} s`, "busy");
    tick();
    const timer = window.setInterval(tick, 1000);
    try {
      const area = this.staging ? await runStagedImport(this.api, this.staging, bbox, this.leaving.signal) : await this.api.importArea(bbox);
      await this.open(area.id, { area });
      void this.refreshAreas();
      await this.afterImport(area.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return; // the page was left
      this.showError(error);
    } finally {
      window.clearInterval(timer);
      this.busy = false;
      this.selectionChanged(this.tool.bbox);
    }
  }

  /**
   * Loads an import area's map data and shows it: the engine's own representation. `camera` puts the
   * map there instead of flying to the area, and `instant` fits the area without any animation. Otherwise
   * the map flies to the area (or jumps, for a user who prefers reduced motion).
   */
  async open(areaId: string, options: { area?: ImportArea; quiet?: boolean; instant?: boolean; camera?: Camera | null } = {}): Promise<void> {
    try {
      const area = options.area ?? (await this.api.getImportArea(areaId));
      // Another area starts at its whole extent; only reopening the current area keeps its scope.
      const current = this.selection.get();
      let scope: Scope = areaId === current.areaId ? current.scope : { type: "import_area" };
      let data: MapData;
      try {
        data = await this.api.mapData(areaId, mapDataQuery(scope));
      } catch (error) {
        // A remembered boundary that was deleted since: fall back to the whole area.
        if (!(error instanceof ApiError && error.code === "boundary_not_found" && scope.type === "boundary")) throw error;
        scope = { type: "import_area" };
        data = await this.api.mapData(areaId);
      }
      this.layers.show(data);
      this.shown = { areaId, scope };
      this.tool.show(area.bbox, true);
      const { camera } = options;
      const moveCamera = () => {
        if (camera) this.map.jumpTo({ center: [camera.lon, camera.lat], zoom: camera.zoom });
        else if (options.quiet || options.instant) {
          this.map.fitBounds(
            [
              [area.bbox.min_longitude, area.bbox.min_latitude],
              [area.bbox.max_longitude, area.bbox.max_latitude],
            ],
            { padding: 60, duration: 0 },
          );
        } else flyToArea(this.map, area.bbox);
      };
      // A hidden map has no size to fit into (the page opened on the Scene view): wait until it shows.
      if (this.map.getContainer().clientWidth === 0) this.pendingCamera = moveCamera;
      else {
        this.pendingCamera = null;
        moveCamera();
      }
      this.openArea = area;
      this.selection.setArea(areaId);
      this.selection.setScope(scope);
      this.setStatus(summary(area), "ok");
      this.selectionChanged(area.bbox);
      this.renderAreas();
    } catch (error) {
      if (!options.quiet) this.showError(error);
    }
  }

  /** Redraws the open area's map data for another scope. */
  private async reloadMapData(scope: Scope): Promise<void> {
    const shown = this.shown;
    if (!shown) return;
    try {
      const data = await this.api.mapData(shown.areaId, mapDataQuery(scope));
      // Ignore the answer if the user moved on while it was loading.
      const now = this.selection.get();
      if (now.areaId !== shown.areaId || !sameScope(now.scope, scope)) return;
      this.layers.show(data);
      this.shown = { areaId: shown.areaId, scope };
    } catch (error) {
      if (error instanceof ApiError && error.code === "boundary_not_found") this.selection.setScope({ type: "import_area" });
      else this.showError(error);
    }
  }

  /** Reloads the list of completed areas from the API, so any earlier import can be reopened. */
  private async refreshAreas(): Promise<void> {
    try {
      this.areas = await this.api.listImportAreas({ status: "completed", limit: LISTED_AREAS });
      this.renderAreas();
    } catch (error) {
      renderReportedError(this.el.recent, reportError(error));
    }
  }

  /** The line under "Imported areas": the open area (the gallery lists the rest). */
  private renderAreas(): void {
    this.el.recent.textContent = this.openArea ? describeArea(this.openArea) : "None open";
  }

  private showError(error: unknown): void {
    renderReportedError(this.el.status, reportError(error));
    this.el.status.dataset.state = "error";
  }

  private setStatus(text: string, state: "ok" | "busy" | "error"): void {
    this.el.status.textContent = text;
    this.el.status.dataset.state = state;
  }
}

export function summary(area: ImportArea): string {
  return (
    `Imported ${area.road_count ?? 0} roads, ${area.building_count ?? 0} buildings, ` +
    `${area.block_count} blocks, ${area.poi_count ?? 0} points of interest, and ${area.area_feature_count ?? 0} area features.`
  );
}
