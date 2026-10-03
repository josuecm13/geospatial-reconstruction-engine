import * as maplibregl from "maplibre-gl";
import type { BoundaryProperties, FeatureCollection, Geometry, Position } from "../api/types";
import { closeRing, simplifyFreehand } from "./boundaryGeometry";

export type TraceMode = "vertices" | "freehand";

const TRACE_SOURCE = "boundary-trace";
const SAVED_SOURCE = "boundary-saved";
/** How close (in screen pixels) a click must be to the first vertex to close the shape. */
const CLOSE_PIXELS = 10;
/** Freehand input is thinned to this tolerance, in meters on the ground. */
const FREEHAND_TOLERANCE_METERS = 2;

interface Feature {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: Geometry;
}

const empty = ():{ type: "FeatureCollection"; features: [] } => ({ type: "FeatureCollection", features: [] });

/**
 * Trace a shape on the map, either by clicking vertices (click the first point or double-click to
 * close, Escape to cancel) or freehand (press, drag, release). Drawn as a solid orange line over a
 * light fill, so it can't be mistaken for the dashed blue import rectangle. The finished ring stays
 * on the map until `clear()`, so it can be fixed and saved after a rejection.
 */
export class BoundaryTool {
  private ring: Position[] | null = null;
  private tracing = false;
  private cancelTrace: (() => void) | null = null;

  constructor(
    private readonly map: maplibregl.Map,
    /** Called when a shape is finished (a closed ring) or cleared (null), and when tracing starts or stops. */
    private readonly onChange: (ring: Position[] | null, tracing: boolean) => void,
  ) {
    map.addSource(TRACE_SOURCE, { type: "geojson", data: empty() });
    map.addLayer({
      id: "boundary-trace-fill",
      type: "fill",
      source: TRACE_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#f28c28", "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: "boundary-trace-line",
      type: "line",
      source: TRACE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f28c28", "line-width": 3 },
    });
    map.addLayer({
      id: "boundary-trace-points",
      type: "circle",
      source: TRACE_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#f28c28", "circle-stroke-width": 2 },
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
    this.tracing = true;
    this.onChange(null, true);
    const canvas = this.map.getCanvasContainer();
    canvas.style.cursor = "crosshair";
    this.map.dragPan.disable();
    this.map.doubleClickZoom.disable();
    this.map.boxZoom.disable();
    this.cancelTrace = mode === "vertices" ? this.traceVertices() : this.traceFreehand();
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

  private traceFreehand(): () => void {
    let path: Position[] = [];
    let dragging = false;
    const down = (event: maplibregl.MapMouseEvent) => {
      dragging = true;
      path = [[event.lngLat.lng, event.lngLat.lat]];
    };
    const move = (event: maplibregl.MapMouseEvent) => {
      if (!dragging) return;
      path.push([event.lngLat.lng, event.lngLat.lat]);
      this.render(path, null);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (path.length < 3) {
        path = [];
        this.render([], null);
        return;
      }
      this.finish(closeRing(simplifyFreehand(path, FREEHAND_TOLERANCE_METERS, path[0][1])));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.cancel();
    };
    this.map.on("mousedown", down);
    this.map.on("mousemove", move);
    this.map.on("mouseup", up);
    document.addEventListener("keydown", key);
    return () => {
      this.map.off("mousedown", down);
      this.map.off("mousemove", move);
      this.map.off("mouseup", up);
      document.removeEventListener("keydown", key);
    };
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
      paint: { "fill-color": "#7b3fb3", "fill-opacity": ["case", ["get", "selected"], 0.18, 0] },
    });
    map.addLayer({
      id: "boundary-saved-line",
      type: "line",
      source: SAVED_SOURCE,
      paint: { "line-color": "#7b3fb3", "line-width": ["case", ["get", "selected"], 3, 1] },
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
