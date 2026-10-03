import * as maplibregl from "maplibre-gl";
import type { BoundingBox } from "../api/types";
import { bboxFromCorners, bboxProblem, bboxRing } from "../geo/bbox";
import { metersPerDegree } from "../geo/localMeters";
import { applyDrag, cursorFor, hitTest, metersPerPixel, sizeLabel, type DragPart } from "./rectangleDrag";

const SOURCE = "selection";
const HANDLES_SOURCE = "selection-handles";
/** How far from a corner or edge, in screen pixels, a pointer still grabs it. Large enough for a finger. */
const HANDLE_RADIUS_PIXELS = 12;

interface ActiveDrag {
  pointerId: number;
  part: DragPart | "draw";
  /** The rectangle when the drag began (null while drawing a first one). */
  start: BoundingBox | null;
  /** Where the pointer went down, [longitude, latitude]. */
  origin: [number, number];
}

/**
 * Draw a rectangle by dragging on the map, then adjust it with pointer events (so touch works):
 * drag inside to move it, an edge to resize along that axis, a corner to resize both. The cursor
 * says what each part does, a label shows the live size and area while dragging, and the
 * rectangle turns to the over-limit style past 1 km². Escape during a drag restores the rectangle
 * as it was. Reports every change, including while dragging, so the area readout is live.
 */
export class RectangleTool {
  private box: BoundingBox | null = null;
  private drawing = false;
  private editable = false;
  private active: ActiveDrag | null = null;
  private label: maplibregl.Marker | null = null;
  private readonly labelElement = document.createElement("div");

  constructor(
    private readonly map: maplibregl.Map,
    private readonly onChange: (bbox: BoundingBox | null) => void,
  ) {
    const color = ["case", ["get", "tooLarge"], "#d9534f", "#2f7dd1"] as maplibregl.ExpressionSpecification;
    map.addSource(SOURCE, { type: "geojson", data: emptyCollection() });
    map.addSource(HANDLES_SOURCE, { type: "geojson", data: emptyCollection() });
    map.addLayer({ id: "selection-fill", type: "fill", source: SOURCE, paint: { "fill-color": color, "fill-opacity": 0.12 } });
    map.addLayer({
      id: "selection-line",
      type: "line",
      source: SOURCE,
      paint: { "line-color": color, "line-width": 2, "line-dasharray": [3, 2] },
    });
    // Corners are larger circles than edge midpoints: they show what can be grabbed.
    map.addLayer({
      id: "selection-handles",
      type: "circle",
      source: HANDLES_SOURCE,
      paint: {
        "circle-radius": ["case", ["get", "corner"], 7, 5],
        "circle-color": "#fff",
        "circle-stroke-color": color,
        "circle-stroke-width": 3,
      },
    });
    this.labelElement.className = "selection-label";

    const canvas = map.getCanvas();
    // Without this a touch drag is taken for a browser pan and cancelled before it can move a handle.
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown",this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    document.addEventListener("keydown", this.onKeyDown);
  }

  get bbox(): BoundingBox | null {
    return this.box;
  }

  /** Arms drawing: the next drag on the map draws a new rectangle. */
  startDrawing(): void {
    if (this.drawing) return;
    this.drawing = true;
    this.map.getCanvasContainer().style.cursor = "crosshair";
  }

  /** Shows an existing rectangle (for example a reopened import), editable or not. */
  show(bbox: BoundingBox | null, editable = false): void {
    this.box = bbox;
    this.editable = editable && bbox !== null;
    this.render();
  }

  private lngLatOf(event: PointerEvent): [number, number] {
    const rect = this.map.getCanvas().getBoundingClientRect();
    const { lng, lat } = this.map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    return [lng, lat];
  }

  private partAt(point: [number, number]): DragPart | null {
    if (!this.box || !this.editable) return null;
    const centerLat = (this.box.min_latitude + this.box.max_latitude) / 2;
    return hitTest(this.box, point, HANDLE_RADIUS_PIXELS * metersPerPixel(centerLat, this.map.getZoom()));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.active || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = this.lngLatOf(event);
    const part: DragPart | "draw" | null = this.drawing ? "draw" : this.partAt(point);
    if (!part) return;

    this.active = { pointerId: event.pointerId, part, start: this.box, origin: point };
    this.map.getCanvas().setPointerCapture(event.pointerId);
    this.map.dragPan.disable();
    this.map.boxZoom.disable();
    if (part === "draw") this.set(bboxFromCorners(point, point));
    this.showLabel();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const active = this.active;
    const point = this.lngLatOf(event);
    if (!active) {
      if (!this.drawing) this.map.getCanvasContainer().style.cursor = cursorFor(this.partAt(point));
      return;
    }
    if (event.pointerId !== active.pointerId) return;
    if (active.part === "draw") {
      this.set(bboxFromCorners(active.origin, point));
    } else if (active.start) {
      const per = metersPerDegree((active.start.min_latitude + active.start.max_latitude) / 2);
      const delta = { dx: (point[0] - active.origin[0]) * per.lon, dy: (point[1] - active.origin[1]) * per.lat };
      this.set(applyDrag(active.start, active.part, delta));
    }
    this.showLabel();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    const wasDrawing = this.active.part === "draw";
    this.endDrag();
    if (wasDrawing) {
      this.drawing = false;
      this.map.getCanvasContainer().style.cursor = "";
      this.editable = this.box !== null;
      this.render();
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.active && event.pointerId === this.active.pointerId) this.cancelDrag();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.active) this.cancelDrag();
  };

  /** Restores the rectangle as it was when the drag began (a cancelled draw leaves none, and stays armed). */
  private cancelDrag(): void {
    const active = this.active;
    if (!active) return;
    this.endDrag();
    this.box = active.start;
    this.render();
    this.onChange(this.box);
  }

  private endDrag(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    const canvas = this.map.getCanvas();
    if (canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
    this.map.dragPan.enable();
    this.map.boxZoom.enable();
    this.label?.remove();
    this.label = null;
  }

  private showLabel(): void {
    const bbox = this.box;
    if (!bbox) return;
    this.labelElement.textContent = sizeLabel(bbox);
    const lngLat: [number, number] = [(bbox.min_longitude + bbox.max_longitude) / 2, bbox.max_latitude];
    if (this.label) this.label.setLngLat(lngLat);
    else this.label = new maplibregl.Marker({ element: this.labelElement, anchor: "bottom" }).setLngLat(lngLat).addTo(this.map);
  }

  private set(bbox: BoundingBox): void {
    this.box = bbox;
    this.render();
    this.onChange(bbox);
  }

  private render(): void {
    const bbox = this.box;
    const source = this.map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    const handles = this.map.getSource(HANDLES_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source || !handles) return;
    if (!bbox) {
      source.setData(emptyCollection());
      handles.setData(emptyCollection());
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
    handles.setData({ type: "FeatureCollection", features: this.editable ? handlePoints(bbox) : [] });
  }
}

/** The corners and edge midpoints, flagged over-limit so they match the rectangle's colour. */
function handlePoints(bbox: BoundingBox) {
  const { min_longitude: w, min_latitude: s, max_longitude: e, max_latitude: n } = bbox;
  const tooLarge = bboxProblem(bbox) === "too_large";
  const midLon = (w + e) / 2;
  const midLat = (s + n) / 2;
  const points: [number, number, boolean][] = [
    [w, s, true], [e, s, true], [e, n, true], [w, n, true],
    [midLon, s, false], [midLon, n, false], [w, midLat, false], [e, midLat, false],
  ];
  return points.map(([lon, lat, corner]) => ({
    type: "Feature" as const,
    properties: { corner, tooLarge },
    geometry: { type: "Point" as const, coordinates: [lon, lat] },
  }));
}

function emptyCollection(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}
