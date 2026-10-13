import * as maplibregl from "maplibre-gl";
import type { BoundaryProperties, FeatureCollection, Geometry, Position } from "../api/types";
import { MAP_COLORS } from "../views/mapColors";
import { closeRing } from "./boundaryGeometry";
import { BRUSH_DEFAULT_METERS, BrushPainting, circlePolygon, localProjection } from "./brush";

export type TraceMode = "vertices" | "brush";

const TRACE_SOURCE = "boundary-trace";
const SAVED_SOURCE = "boundary-saved";
/** How close (in screen pixels) a click must be to the first vertex to close the shape. */
const CLOSE_PIXELS = 10;
const CURSOR_SOURCE = "boundary-brush-cursor";
/** A brush point closer than this to the last one, in screen pixels, is skipped. */
const BRUSH_POINT_PIXELS = 3;
const CURSOR_SEGMENTS = 48;

interface Feature {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: Geometry;
}

const empty = ():{ type: "FeatureCollection"; features: [] } => ({ type: "FeatureCollection", features: [] });

/**
 * Trace a shape on the map, either by clicking vertices (click the first point or double-click to
 * close, Escape to cancel) or with a brush (press and drag to paint strokes of a width in meters,
 * which merge into one shape; erase subtracts; Done or Enter takes its outline). Drawn as a solid orange line over a
 * light fill, so it can't be mistaken for the dashed blue import rectangle. The finished ring stays
 * on the map until `clear()`, so it can be fixed and saved after a rejection.
 */
export class BoundaryTool {
  private ring: Position[] | null = null;
  private tracing = false;
  private painting: BrushPainting | null = null;
  /** What the brush's outline left out (set when a painted shape finishes), for the panel to tell the user. */
  notice: string | null = null;
  /** The brush's width in meters, and whether its strokes subtract; the panel sets both. */
  brushWidth = BRUSH_DEFAULT_METERS;
  erase = false;
  private cancelTrace: (() => void) | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    /** Called when a shape is finished (a closed ring) or cleared (null), and when tracing starts or stops. */
    private readonly onChange: (ring: Position[] | null, tracing: boolean) => void,
  ) {
    map.addSource(TRACE_SOURCE, { type: "geojson", data: empty() });
    map.addSource(CURSOR_SOURCE, { type: "geojson", data: empty() });
    map.addLayer({
      id: "boundary-trace-fill",
      type: "fill",
      source: TRACE_SOURCE,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
      paint: { "fill-color": MAP_COLORS.boundaryDraft, "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: "boundary-trace-line",
      type: "line",
      source: TRACE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": MAP_COLORS.boundaryDraft, "line-width": 3 },
    });
    map.addLayer({
      id: "boundary-trace-points",
      type: "circle",
      source: TRACE_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": MAP_COLORS.handleFill, "circle-stroke-color": MAP_COLORS.boundaryDraft, "circle-stroke-width": 2 },
    });
    map.addLayer({
      id: "boundary-brush-cursor",
      type: "line",
      source: CURSOR_SOURCE,
      paint: { "line-color": MAP_COLORS.boundaryDraft, "line-width": 1.5, "line-dasharray": [2, 2] },
    });
  }

  /** The finished, closed ring, or null. */
  get shape(): Position[] | null {
    return this.ring;
  }

  get isTracing(): boolean {
    return this.tracing;
  }

  /** Arms tracing in the given mode. Any shape already drawn is replaced. */
  start(mode: TraceMode): void {
    this.stop();
    this.clear();
    this.notice = null;
    this.tracing = true;
    this.onChange(null, true);
    const canvas = this.map.getCanvasContainer();
    canvas.style.cursor = "crosshair";
    this.map.dragPan.disable();
    this.map.doubleClickZoom.disable();
    this.map.boxZoom.disable();
    this.cancelTrace = mode === "vertices" ? this.traceVertices() : this.traceBrush();
  }

  /** Ends a trace in progress and removes its listeners, for when the page is left. */
  dispose(): void {
    this.stop();
  }

  /** Abandons an unfinished trace, leaving any finished shape alone. */
  cancel(): void {
    if (!this.tracing) return;
    this.stop();
    this.render([], null);
    this.onChange(this.ring, false);
  }

  /** Removes the shape and any unfinished trace. */
  clear(): void {
    this.stop();
    this.ring = null;
    this.render([], null);
    this.onChange(null, false);
  }

  /** Puts a shape back on the map (for example after a failed save). */
  show(ring: Position[] | null): void {
    this.ring = ring;
    this.render([], ring);
  }

  private traceVertices(): () => void {
    const points: Position[] = [];
    let pointer: Position | null = null;
    const redraw = () => this.render(pointer ? [...points, pointer] : points, null, points);
    const finish = () => {
      if (points.length < 3) return;
      this.finish(closeRing(points));
    };
    const click = (event: maplibregl.MapMouseEvent) => {
      const at: Position = [event.lngLat.lng, event.lngLat.lat];
      if (points.length >= 3) {
        const first = this.map.project(points[0] as [number, number]);
        if (Math.hypot(first.x - event.point.x, first.y - event.point.y) <= CLOSE_PIXELS) return finish();
      }
      // A double-click arrives as two clicks on the same spot: keep one.
      const last = points[points.length - 1];
      if (last && last[0] === at[0] && last[1] === at[1]) return;
      points.push(at);
      redraw();
    };
    const move = (event: maplibregl.MapMouseEvent) => {
      pointer = [event.lngLat.lng, event.lngLat.lat];
      redraw();
    };
    const doubleClick = (event: maplibregl.MapMouseEvent) => {
      event.preventDefault();
      finish();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.cancel();
    };
    this.map.on("click", click);
    this.map.on("mousemove", move);
    this.map.on("dblclick", doubleClick);
    document.addEventListener("keydown", key);
    return () => {
      this.map.off("click", click);
      this.map.off("mousemove", move);
      this.map.off("dblclick", doubleClick);
      document.removeEventListener("keydown", key);
    };
  }

  /**
   * Brush mode: press and drag to paint a stroke `brushWidth` meters wide (Alt, or the erase toggle,
   * makes it subtract). The painted shape shows live; "Done" (or Enter) turns its outline into the shape.
   */
  private traceBrush(): () => void {
    const canvas = this.map.getCanvas();
    const painting = (this.painting = new BrushPainting());
    let pointerId: number | null = null;
    let lastScreen: [number, number] | null = null;
    const lngLatOf = (event: PointerEvent): Position => {
      const rect = canvas.getBoundingClientRect();
      const { lng, lat } = this.map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      return [lng, lat];
    };
    const down = (event: PointerEvent) => {
      if (pointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      lastScreen = [event.clientX, event.clientY];
      painting.begin(lngLatOf(event), this.brushWidth, this.erase !== event.altKey);
      this.renderBrush(painting);
      this.showCursor(lngLatOf(event));
    };
    const move = (event: PointerEvent) => {
      const at = lngLatOf(event);
      this.showCursor(at);
      if (event.pointerId !== pointerId || !lastScreen) return;
      // Thinned by screen distance: a fast drag would otherwise add a point per pixel.
      if (Math.hypot(event.clientX - lastScreen[0], event.clientY - lastScreen[1]) < BRUSH_POINT_PIXELS) return;
      lastScreen = [event.clientX, event.clientY];
      painting.extend(at);
      this.renderBrush(painting);
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      lastScreen = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      painting.end();
      this.renderBrush(painting);
      this.onChange(this.ring, true);
    };
    const leave = () => this.showCursor(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.cancel();
      else if (event.key === "Enter") this.finishBrush();
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undoStroke();
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", leave);
    document.addEventListener("keydown", key);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", release);
      canvas.removeEventListener("pointerleave", leave);
      document.removeEventListener("keydown", key);
      this.showCursor(null);
    };
  }

  /** Whether a brush is being painted with, and has something painted or can take a stroke back. */
  get brushState(): { painting: boolean; hasPaint: boolean; canUndo: boolean } {
    const painting = this.painting;
    return { painting: this.tracing && painting !== null, hasPaint: !!painting && !painting.isEmpty, canUndo: !!painting && painting.canUndo };
  }

  /** Takes back the last stroke. */
  undoStroke(): void {
    if (!this.painting) return;
    this.painting.undo();
    this.renderBrush(this.painting);
    this.onChange(this.ring, true);
  }

  /** Wipes the painted shape but stays in brush mode. */
  clearPaint(): void {
    if (!this.painting) return;
    this.painting.clear();
    this.renderBrush(this.painting);
    this.onChange(this.ring, true);
  }

  /** Turns the painted shape into the finished shape (its outline), noting anything left out. */
  finishBrush(): void {
    const painting = this.painting;
    if (!painting || !this.tracing) return;
    const { ring, droppedParts, filledHoles } = painting.outline();
    if (!ring) return;
    const notes: string[] = [];
    if (droppedParts > 0) notes.push("Disconnected pieces were dropped: a boundary is a single shape, so only the largest was kept.");
    if (filledHoles) notes.push("Holes were filled: a boundary can't have holes.");
    this.notice = notes.join(" ") || null;
    this.finish(closeRing(ring));
  }

  private renderBrush(painting: BrushPainting): void {
    const source = this.map.getSource(TRACE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const polygons = painting.lonLatShape();
    source?.setData({
      type: "FeatureCollection",
      features: polygons.length ? [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polygons } }] : [],
    });
  }

  /** The brush's footprint under the pointer, as a ground circle: it grows and shrinks with the zoom. */
  private showCursor(at: Position | null): void {
    const source = this.map.getSource(CURSOR_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!at) {
      source.setData(empty());
      return;
    }
    const { toLonLat } = localProjection(at);
    const ring = circlePolygon([0, 0], this.brushWidth / 2, CURSOR_SEGMENTS).map(toLonLat);
    source.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { erase: this.erase }, geometry: { type: "LineString", coordinates: ring } }] });
  }

  private finish(ring: Position[]): void {
    this.stop();
    this.ring = ring;
    this.render([], ring);
    this.onChange(ring, false);
  }

  private stop(): void {
    this.cancelTrace?.();
    this.cancelTrace = null;
    this.painting = null;
    if (!this.tracing) return;
    this.tracing = false;
    this.map.getCanvasContainer().style.cursor = "";
    this.map.dragPan.enable();
    this.map.doubleClickZoom.enable();
    this.map.boxZoom.enable();
  }

  /** `path` is drawn as an open line (with `dots` as vertex markers), `ring` as a closed polygon. */
  private render(path: Position[], ring: Position[] | null, dots: Position[] = []): void {
    const source = this.map.getSource(TRACE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features: Feature[] = [];
    if (ring) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
    if (path.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } });
    for (const dot of dots) features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: dot } });
    source.setData({ type: "FeatureCollection", features });
  }
}

/** Saved boundaries of the open area: a thin purple outline, thicker and filled for the selected one. */
export class SavedBoundaryLayers {
  constructor(private readonly map: maplibregl.Map) {
    map.addSource(SAVED_SOURCE, { type: "geojson", data: empty() });
    map.addLayer({
      id: "boundary-saved-fill",
      type: "fill",
      source: SAVED_SOURCE,
      paint: { "fill-color": MAP_COLORS.boundarySaved, "fill-opacity": ["case", ["get", "selected"], 0.18, 0] },
    });
    map.addLayer({
      id: "boundary-saved-line",
      type: "line",
      source: SAVED_SOURCE,
      paint: { "line-color": MAP_COLORS.boundarySaved, "line-width": ["case", ["get", "selected"], 3, 1] },
    });
  }

  show(boundaries: FeatureCollection<BoundaryProperties>, selectedId: string | null): void {
    const source = this.map.getSource(SAVED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: boundaries.features.map((feature) => ({
        type: "Feature",
        id: feature.id,
        properties: { name: feature.properties.name, selected: feature.id === selectedId },
        geometry: feature.geometry,
      })),
    });
  }
}
