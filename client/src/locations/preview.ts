import type { ApiClient } from "../api/client";
import type { BoundingBox, Geometry, ImportStatus, MapData, Position } from "../api/types";
import { LruCache, previewKey, TaskQueue } from "./previewScheduler";
import { previewTransform, projectToPreview, type PreviewTransform } from "./previewTransform";
import { prefersReducedMotion } from "./flyTo";
import { buildingHeight } from "../scene/buildingHeight";
import { easeOut, groundScale, raiseBuilding, sortFarToNear, type FlatBuilding, type Point, type RaiseView } from "./raisedPreview";

/** A preview is drawn at this size and scaled by CSS: sharp on a 2x screen at the gallery's card width. */
export const PREVIEW_WIDTH = 640;
export const PREVIEW_HEIGHT = 400;
const PADDING = 28;
/** How many previews are fetched and drawn at once: map-data for a full square kilometer is large. */
export const CONCURRENT_PREVIEWS = 3;
const CACHED_PREVIEWS = 48;
/** Map-data kept for the raised view: much larger than a picture, so only the few most recent previews keep theirs. */
const CACHED_MAP_DATA = 6;
const RAISE_MS = 450;
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
  buildingWall: "#7d6aa3",
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

/** Everything the raised view needs, projected to flat canvas pixels once so a frame only applies the tilt. */
export interface RaisePrep {
  bbox: BoundingBox;
  data: MapData;
  buildings: FlatBuilding[];
  pxPerMetre: number;
}

/** Pre-projects the buildings' footprints (outer rings) to canvas space, with their heights, sorted far to near. */
export function prepareRaise(bbox: BoundingBox, data: MapData): RaisePrep {
  const t = previewTransform(bbox, PREVIEW_WIDTH, PREVIEW_HEIGHT, PADDING);
  const buildings: FlatBuilding[] = [];
  for (const feature of data.buildings.features) {
    const { height } = buildingHeight(feature.properties);
    for (const polygon of polygonsOf(feature.geometry)) {
      if (!polygon[0]?.length) continue;
      buildings.push({ ring: polygon[0].map(([lon, lat]) => projectToPreview(t, lon, lat) as Point), height });
    }
  }
  return { bbox, data, buildings: sortFarToNear(buildings), pxPerMetre: t.scale / METERS_PER_DEGREE_LATITUDE };
}

function drawScene(ctx: CanvasRenderingContext2D, bbox: BoundingBox, data: MapData | null, raise: { prep: RaisePrep; t: number } | null): void {
  const backdrop = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  backdrop.addColorStop(0, COLORS.background[0]);
  backdrop.addColorStop(1, COLORS.background[1]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  const pivotY = PREVIEW_HEIGHT / 2;
  const view: RaiseView | null = raise && { t: raise.t, pivotY, pxPerMetre: raise.prep.pxPerMetre };
  ctx.save();
  if (view) {
    // The ground is the flat picture foreshortened around the canvas centre (the same map `raisePoint` applies to a point).
    const squash = groundScale(view.t);
    ctx.translate(0, pivotY);
    ctx.scale(1, squash);
    ctx.translate(0, -pivotY);
  }

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
    if (!view) fillPolygons(ctx, t, data.buildings.features.map((f) => f.geometry), COLORS.building, COLORS.buildingEdge);
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
  ctx.restore();

  if (view && raise) {
    ctx.setLineDash([]);
    ctx.lineWidth = 0.6;
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.buildingEdge;
    const trace = (points: Point[]) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    };
    for (const building of raise.prep.buildings) {
      const { walls, roof } = raiseBuilding(view, building);
      ctx.fillStyle = COLORS.buildingWall;
      for (const wall of walls) {
        trace(wall);
        ctx.fill();
        ctx.stroke();
      }
      if (roof.length) {
        ctx.fillStyle = COLORS.building;
        trace(roof);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

/**
 * Draws an area's footprint on a canvas: the rectangle as ground, area features tinted, blocks faint, roads stroked at their
 * generated width, buildings filled. With no map-data (the import has not completed) it is the bare, hatched rectangle.
 */
export function renderPreview(bbox: BoundingBox, data: MapData | null): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement("canvas"), { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  drawScene(canvas.getContext("2d")!, bbox, data, null);
  return canvas;
}

/** Draws one frame of the raised view onto `ctx` (a PREVIEW_WIDTH x PREVIEW_HEIGHT canvas) at tilt amount `t`. */
export function drawRaisedFrame(ctx: CanvasRenderingContext2D, prep: RaisePrep, t: number): void {
  drawScene(ctx, prep.bbox, prep.data, { prep, t });
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
/** Map-data of the last few previews, for the raised view: a card whose data has been evicted does not animate. */
const dataCache = new LruCache<MapData>(CACHED_MAP_DATA);

/**
 * Animates one card's preview between flat and raised. `goal` is 1 while the card is hovered by a mouse or its link has
 * focus, else 0. Frames are drawn straight onto the card's canvas; at rest and flat the cached flat picture is repainted.
 */
class RaiseAnimation {
  private t = 0;
  private goal = 0;
  private frame = 0;
  private prep: RaisePrep | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly mapData: () => MapData | undefined,
    private readonly flat: () => HTMLCanvasElement | null,
    private readonly bbox: BoundingBox,
    private readonly claim: (self: RaiseAnimation) => void,
  ) {}

  setGoal(goal: 0 | 1): void {
    if (goal === this.goal) return;
    if (goal === 1) {
      if (this.host.dataset.state !== "ready") return;
      this.claim(this);
      if (this.t === 0) {
        const data = this.mapData();
        if (!data) return; // evicted: no new request, no animation
        this.prep = prepareRaise(this.bbox, data);
      }
      if (!this.prep) return;
    }
    this.goal = goal;
    this.run();
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    if (prefersReducedMotion()) {
      this.t = this.goal;
      this.draw();
      return;
    }
    const from = this.t;
    const to = this.goal;
    const duration = RAISE_MS * Math.abs(to - from);
    if (duration === 0) return;
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      const progress = (now - started) / duration;
      this.t = progress >= 1 ? to : from + (to - from) * easeOut(progress);
      this.draw();
      if (progress < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private draw(): void {
    const ctx = this.canvas.getContext("2d")!;
    if (this.t === 0 || !this.prep) {
      const flat = this.flat();
      if (flat) ctx.drawImage(flat, 0, 0);
      if (this.t === 0) this.prep = null;
      return;
    }
    drawRaisedFrame(ctx, this.prep, this.t);
  }

  /** Stops and repaints the flat picture, as when another card takes over. */
  snapFlat(): void {
    cancelAnimationFrame(this.frame);
    this.goal = 0;
    this.t = 0;
    this.draw();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }
}

/**
 * Fills each card's preview canvas when the card scrolls near the viewport: map-data is fetched and drawn
 * (three at a time), and the picture is cached by area id and `imported_at`. A card still queued when it scrolls
 * away is dropped from the queue. The host element carries `data-state`: `idle`, `loading`, `ready` or `error`.
 */
export class PreviewLoader {
  private readonly observer: IntersectionObserver | null;
  private readonly pending = new Map<Element, { start(): void; stop(): void }>();
  private disposed = false;
  private active: RaiseAnimation | null = null;
  private readonly raises = new Set<RaiseAnimation>();

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
    let flat: HTMLCanvasElement | null = null;
    const paint = (source: HTMLCanvasElement) => {
      flat = source;
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
    this.listenForRaise(host, canvas, target, key, () => flat);
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
          dataCache.set(key, data);
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

  /** Raises the preview while a mouse hovers the card or its link has focus; touch and pen do nothing. */
  private listenForRaise(host: HTMLElement, canvas: HTMLCanvasElement, target: PreviewTarget, key: string, flat: () => HTMLCanvasElement | null): void {
    const card = host.closest<HTMLElement>(".location-card");
    if (!card) return;
    const animation = new RaiseAnimation(
      host,
      canvas,
      () => dataCache.get(key),
      flat,
      target.bbox,
      (self) => {
        if (this.active && this.active !== self) this.active.snapFlat();
        this.active = self;
      },
    );
    this.raises.add(animation);
    let hovered = false;
    let focused = false;
    const update = () => {
      if (!this.disposed) animation.setGoal(hovered || focused ? 1 : 0);
    };
    card.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      hovered = true;
      update();
    });
    card.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse") return;
      hovered = false;
      update();
    });
    const link = card.querySelector<HTMLElement>("a.location-open");
    link?.addEventListener("focus", () => {
      focused = true;
      update();
    });
    link?.addEventListener("blur", () => {
      focused = false;
      update();
    });
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
    for (const raise of this.raises) raise.stop();
    this.raises.clear();
  }
}
