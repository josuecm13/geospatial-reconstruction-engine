import type * as maplibregl from "maplibre-gl";
import type { ApiClient } from "../api/client";
import type { BoundingBox, ImportArea } from "../api/types";
import { areaSquareMeters, bboxProblem, formatSquareKilometers, MAX_AREA_SQUARE_METERS, roundBbox } from "../geo/bbox";
import type { MapDataLayers } from "../views/mapDataLayers";
import { importErrorMessage } from "./errorMessages";
import { RectangleTool } from "./rectangleTool";
import { RecentImports } from "./recentImports";

export const REIMPORT_WARNING =
  "This rectangle was imported before. Importing it again reconciles it with OpenStreetMap as it is " +
  "today: anything OpenStreetMap no longer has is deleted from this area, including its streets, " +
  "buildings, and blocks. Continue?";

/** The 2D picker: draw a rectangle up to 1 km², import it live, and see what the engine built. */
export class ImportPanel {
  private readonly tool: RectangleTool;
  private readonly recent = new RecentImports(localStorage);
  private readonly el: {
    draw: HTMLButtonElement;
    area: HTMLElement;
    importButton: HTMLButtonElement;
    status: HTMLElement;
    recent: HTMLElement;
  };
  private busy = false;

  constructor(
    container: HTMLElement,
    private readonly map: maplibregl.Map,
    private readonly api: ApiClient,
    private readonly layers: MapDataLayers,
  ) {
    container.innerHTML = `
      <h2>Import a place</h2>
      <p class="hint">Draw a rectangle of up to 1 km², then import it live from OpenStreetMap.</p>
      <button type="button" data-role="draw">Draw rectangle</button>
      <p class="area-readout" data-role="area">No rectangle yet</p>
      <button type="button" class="primary" data-role="import" disabled>Import from OpenStreetMap</button>
      <p class="status" data-role="status" role="status" aria-live="polite"></p>
      <h3>Recent imports</h3>
      <ul class="recent" data-role="recent"></ul>`;
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
    this.renderRecent();
    const current = this.recent.current;
    if (current) void this.open(current, { quiet: true });
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
    this.el.importButton.textContent = this.recent.findByBbox(roundBbox(bbox)) ? "Re-import from OpenStreetMap" : "Import from OpenStreetMap";
  }

  private async importSelection(): Promise<void> {
    const drawn = this.tool.bbox;
    if (!drawn || bboxProblem(drawn) !== null || this.busy) return;
    const bbox = roundBbox(drawn);
    if (this.recent.findByBbox(bbox) && !window.confirm(REIMPORT_WARNING)) return;

    this.busy = true;
    this.el.importButton.disabled = true;
    const started = performance.now();
    const tick = () => this.setStatus(`Importing from OpenStreetMap… ${Math.round((performance.now() - started) / 1000)} s`, "busy");
    tick();
    const timer = window.setInterval(tick, 1000);
    try {
      const area = await this.api.importArea(bbox);
      this.recent.record(area);
      this.renderRecent();
      await this.open(area.id, { area });
    } catch (error) {
      this.setStatus(importErrorMessage(error), "error");
    } finally {
      window.clearInterval(timer);
      this.busy = false;
      this.selectionChanged(this.tool.bbox);
    }
  }

  /** Loads an import area's map data and shows it: the engine's own representation. */
  async open(areaId: string, options: { area?: ImportArea; quiet?: boolean } = {}): Promise<void> {
    try {
      const area = options.area ?? (await this.api.getImportArea(areaId));
      const data = await this.api.mapData(areaId);
      this.layers.show(data);
      this.tool.show(area.bbox, true);
      this.map.fitBounds(
        [
          [area.bbox.min_longitude, area.bbox.min_latitude],
          [area.bbox.max_longitude, area.bbox.max_latitude],
        ],
        { padding: 60, duration: options.quiet ? 0 : 800 },
      );
      this.recent.current = areaId;
      this.setStatus(summary(area), "ok");
      this.selectionChanged(area.bbox);
    } catch (error) {
      if (!options.quiet) this.setStatus(importErrorMessage(error), "error");
    }
  }

  private renderRecent(): void {
    const items = this.recent.list();
    this.el.recent.replaceChildren(
      ...(items.length
        ? items.map((item) => {
            const li = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "link";
            const when = item.importedAt ? new Date(item.importedAt).toLocaleString() : "not completed";
            button.textContent = `${when}: ${item.buildingCount ?? 0} buildings, ${item.roadCount ?? 0} roads`;
            button.addEventListener("click", () => void this.open(item.id));
            li.appendChild(button);
            return li;
          })
        : [Object.assign(document.createElement("li"), { textContent: "None yet", className: "hint" })]),
    );
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
