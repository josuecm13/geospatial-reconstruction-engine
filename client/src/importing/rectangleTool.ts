import * as maplibregl from "maplibre-gl";
import type { BoundingBox } from "../api/types";
import { bboxFromCorners, bboxProblem, bboxRing } from "../geo/bbox";

const SOURCE = "selection";

/**
 * Draw a rectangle by dragging on the map, then adjust it by dragging any corner handle (the
 * opposite corner stays put). Reports every change, including while dragging, so the area
 * readout is live.
 */
export class RectangleTool {
  private corners: [[number, number], [number, number]] | null = null;
  private handles: maplibregl.Marker[] = [];
  private drawing = false;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly onChange: (bbox: BoundingBox | null) => void,
  ) {
    map.addSource(SOURCE, { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "selection-fill",
      type: "fill",
      source: SOURCE,
      paint: { "fill-color": ["case", ["get", "tooLarge"], "#d9534f", "#2f7dd1"], "fill-opacity": 0.12 },
    });
    map.addLayer({
      id: "selection-line",
      type: "line",
      source: SOURCE,
      paint: { "line-color": ["case", ["get", "tooLarge"], "#d9534f", "#2f7dd1"], "line-width": 2, "line-dasharray": [3, 2] },
    });
  }

  get bbox(): BoundingBox | null {
    return this.corners ? bboxFromCorners(...this.corners) : null;
  }

  /** Arms drawing: the next drag on the map draws a new rectangle. */
  startDrawing(): void {
    if (this.drawing) return;
    this.drawing = true;
    const canvas = this.map.getCanvasContainer();
    canvas.style.cursor = "crosshair";
    this.map.dragPan.disable();
    this.map.boxZoom.disable();

    const down = (event: maplibregl.MapMouseEvent) => {
      const start: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      this.set([start, start]);
      const move = (e: maplibregl.MapMouseEvent) => this.set([start, [e.lngLat.lng, e.lngLat.lat]]);
      const up = (e: maplibregl.MapMouseEvent) => {
        this.map.off("mousemove", move);
        this.drawing = false;
        canvas.style.cursor = "";
        this.map.dragPan.enable();
        this.map.boxZoom.enable();
        this.set([start, [e.lngLat.lng, e.lngLat.lat]]);
        this.placeHandles();
      };
      this.map.on("mousemove", move);
      this.map.once("mouseup", up);
    };
    this.map.once("mousedown", down);
  }

  /** Shows an existing rectangle (for example a reopened import) without handles. */
  show(bbox: BoundingBox | null, editable = false): void {
    this.corners = bbox ? [[bbox.min_longitude, bbox.min_latitude], [bbox.max_longitude, bbox.max_latitude]] : null;
    this.render();
    this.removeHandles();
    if (editable && bbox) this.placeHandles();
  }

  private set(corners: [[number, number], [number, number]]): void {
    this.corners = corners;
    this.render();
    this.onChange(this.bbox);
  }

  private render(): void {
    const bbox = this.bbox;
    const source = this.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!bbox) {
      source.setData(emptyCollection());
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { tooLarge: bboxProblem(bbox) === "too_large" },
          geometry: { type: "Polygon", coordinates: [bboxRing(bbox)] },
        },
      ],
    });
  }

  private placeHandles(): void {
    this.removeHandles();
    const bbox = this.bbox;
    if (!bbox) return;
    const { min_longitude: w, min_latitude: s, max_longitude: e, max_latitude: n } = bbox;
    const corners: [number, number][] = [[w, s], [e, s], [e, n], [w, n]];
    corners.forEach((corner, index) => {
      const opposite = corners[(index + 2) % 4];
      const element = document.createElement("div");
      element.className = "corner-handle";
      const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat(corner).addTo(this.map);
      marker.on("drag", () => {
        const { lng, lat } = marker.getLngLat();
        this.set([opposite, [lng, lat]]);
      });
      // Re-place all four so the other handles follow the new rectangle's corners.
      marker.on("dragend", () => this.placeHandles());
      this.handles.push(marker);
    });
  }

  private removeHandles(): void {
    this.handles.forEach((handle) => handle.remove());
    this.handles = [];
  }
}

function emptyCollection(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}
