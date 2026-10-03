import type { ApiClient } from "../api/client";
import type { BoundingBox, Geometry, ImportStatus, MapData, Position } from "../api/types";
import { LruCache, previewKey, TaskQueue } from "./previewScheduler";
import { previewTransform, projectToPreview, type PreviewTransform } from "./previewTransform";

/** A preview is drawn at this size and scaled by CSS: sharp on a 2x screen at the gallery's card width. */
export const PREVIEW_WIDTH = 640;
export const PREVIEW_HEIGHT = 400;
const PADDING = 28;
/** How many previews are fetched and drawn at once: map-data for a full square kilometer is large. */
export const CONCURRENT_PREVIEWS = 3;
const CACHED_PREVIEWS = 48;
const METERS_PER_DEGREE_LATITUDE = (6_371_000 * Math.PI) / 180;

const COLORS = {
  background: ["#1b252d", "#26343f"],
  ground: "#2f414e",
  edge: "rgba(244, 241, 234, 0.35)",
  water: "rgba(79, 148, 207, 0.9)",
  green: "rgba(77, 125, 88, 0.85)",
  block: "rgba(201, 179, 122, 0.2)",
  roadWide: "#e0a33a",
  roadNormal: "#f4f1ea",
  roadNarrow: "#93a1ac",
  building: "#a08cc4",
  buildingEdge: "#2a1f3d",
} as const;

// --- drawing ---

function polygonsOf(geometry: Geometry): Position[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function linesOf(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function tracePolygon(ctx: CanvasRenderingContext2D, t: PreviewTransform, polygon: Position[][]): void {
  for (const ring of polygon) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = projectToPreview(t, lon, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function fillPolygons(ctx: CanvasRenderingContext2D, t: PreviewTransform, geometries: Geometry[], fill: string, stroke?: string): void {
  ctx.fillStyle = fill;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.6;
    ctx.lineJoin = "round";
  }
  for (const geometry of geometries) {
    for (const polygon of polygonsOf(geometry)) {
      ctx.beginPath();
      tracePolygon(ctx, t, polygon);
      ctx.fill("evenodd");
      if (stroke) ctx.stroke();
    }
  }
}

function strokeRoads(ctx: CanvasRenderingContext2D, t: PreviewTransform, data: MapData): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Narrow roads first, so the wide ones draw over them at crossings.
  const order = { narrow: 0, normal: 1, wide: 2 } as const;
  const roads = [...data.road_segments.features].sort((a, b) => order[a.properties.lane_type] - order[b.properties.lane_type]);
  for (const road of roads) {
    const { lane_type: laneType, width_meters: widthMeters } = road.properties;
    ctx.strokeStyle = laneType === "wide" ? COLORS.roadWide : laneType === "narrow" ? COLORS.roadNarrow : COLORS.roadNormal;
    ctx.lineWidth = Math.max(1.3, (widthMeters / METERS_PER_DEGREE_LATITUDE) * t.scale);
    for (const line of linesOf(road.geometry)) {
      ctx.beginPath();
      line.forEach(([lon, lat], i) => {
        const [x, y] = projectToPreview(t, lon, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
}

/**
 * Draws an area's footprint on a canvas: the rectangle as ground, area features tinted, blocks faint, roads stroked at their
 * generated width, buildings filled. With no map-data (the import has not completed) it is the bare, hatched rectangle.
 */
export function renderPreview(bbox: BoundingBox, data: MapData | null): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement("canvas"), { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const ctx = canvas.getContext("2d")!;
  const backdrop = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  backdrop.addColorStop(0, COLORS.background[0]);
  backdrop.addColorStop(1, COLORS.background[1]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  const t = previewTransform(bbox, PREVIEW_WIDTH, PREVIEW_HEIGHT, PADDING);
  const [west, north] = projectToPreview(t, bbox.min_longitude, bbox.max_latitude);
  const [east, south] = projectToPreview(t, bbox.max_longitude, bbox.min_latitude);
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(west, north, east - west, south - north);

  ctx.save();
  ctx.beginPath();
  ctx.rect(west, north, east - west, south - north);
  ctx.clip();
  if (data) {
    for (const [kind, fill] of [["water", COLORS.water], [null, COLORS.green]] as const) {
      const shapes = data.area_features.features.filter((f) => (kind === "water") === (f.properties.kind === "water")).map((f) => f.geometry);
      fillPolygons(ctx, t, shapes, fill);
    }
    fillPolygons(ctx, t, data.blocks.features.map((f) => f.geometry), COLORS.block);
    strokeRoads(ctx, t, data);
    fillPolygons(ctx, t, data.buildings.features.map((f) => f.geometry), COLORS.building, COLORS.buildingEdge);
  } else {
    ctx.strokeStyle = "rgba(244, 241, 234, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let offset = -(south - north); offset < east - west; offset += 18) {
      ctx.moveTo(west + offset, south);
      ctx.lineTo(west + offset + (south - north), north);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(west, north, east - west, south - north);
  return canvas;
}

// --- loading ---

export interface PreviewTarget {
  id: string;
  importedAt: string | null;
  bbox: BoundingBox;
  status: ImportStatus;
}

const queue = new TaskQueue(CONCURRENT_PREVIEWS);
/** Rendered previews, shared by every gallery visit, so coming Back from explore shows them at once. */
const cache = new LruCache<HTMLCanvasElement>(CACHED_PREVIEWS);

/**
 * Fills each card's preview canvas when the card scrolls near the viewport: map-data is fetched and drawn
 * (three at a time), and the picture is cached by area id and `imported_at`. A card still queued when it scrolls
 * away is dropped from the queue. The host element carries `data-state`: `idle`, `loading`, `ready` or `error`.
 */
export class PreviewLoader {
  private readonly observer: IntersectionObserver | null;
  private readonly pending = new Map<Element, { start(): void; stop(): void }>();
  private disposed = false;

  constructor(private readonly api: ApiClient) {
    this.observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                const job = this.pending.get(entry.target);
                if (entry.isIntersecting) job?.start();
                else job?.stop();
              }
            },
            { rootMargin: "240px 0px" },
          );
  }

  /** Shows the preview of `target` in `host` (which holds a `<canvas>`), loading it when `host` nears the viewport. */
  attach(host: HTMLElement, target: PreviewTarget): void {
    const canvas = host.querySelector("canvas")!;
    const paint = (source: HTMLCanvasElement) => {
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d")!.drawImage(source, 0, 0);
      host.dataset.state = "ready";
    };
    host.dataset.state = "idle";

    if (target.status !== "completed") {
      paint(renderPreview(target.bbox, null)); // nothing to fetch: map-data answers 409 until the import completes
      return;
    }
    const key = previewKey(target.id, target.importedAt);
    const cached = cache.get(key);
    if (cached) {
      paint(cached);
      return;
    }

    let state: "idle" | "queued" | "loading" | "done" = "idle";
    let queued: { cancel(): void } | null = null;
    const job = {
      start: () => {
        if (state !== "idle" || this.disposed) return;
        state = "queued";
        const task = queue.add(async () => {
          state = "loading";
          host.dataset.state = "loading";
          const data = await this.api.mapData(target.id);
          const picture = renderPreview(target.bbox, data);
          cache.set(key, picture);
          return picture;
        });
        queued = task;
        task.result.then(
          (picture) => {
            if (!picture) return; // cancelled while queued
            state = "done";
            this.finish(host);
            if (!this.disposed) paint(picture);
          },
          () => {
            state = "done";
            this.finish(host);
            host.dataset.state = "error";
          },
        );
      },
      stop: () => {
        if (state !== "queued") return;
        queued?.cancel();
        state = "idle";
      },
    };
    this.pending.set(host, job);
    if (this.observer) this.observer.observe(host);
    else job.start();
  }

  private finish(host: Element): void {
    this.pending.delete(host);
    this.observer?.unobserve(host);
  }

  /** Stops observing and drops every preview still waiting in the queue. */
  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    for (const job of this.pending.values()) job.stop();
    this.pending.clear();
  }
}
