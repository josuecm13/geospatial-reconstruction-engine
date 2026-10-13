import polygonClipping from "polygon-clipping";
import type { BoundingBox, Position } from "../api/types";
import { metersPerDegree } from "../geo/localMeters";
import { closeRing, douglasPeucker } from "./boundaryGeometry";

/** The shapes `polygon-clipping` takes and returns, in local meters. */
export type Pair = [number, number];
export type Ring = Pair[];
export type Poly = Ring[];
export type Multi = Poly[];

/** The brush width limits, in meters, and its default. */
export const BRUSH_MIN_METERS = 10;
export const BRUSH_MAX_METERS = 200;
export const BRUSH_DEFAULT_METERS = 40;
/** The saved outline is simplified to this tolerance, in meters on the ground. */
export const OUTLINE_TOLERANCE_METERS = 1.5;
const CIRCLE_SEGMENTS = 16;

/** A regular polygon around `center`, scaled so its area equals the true circle's rather than sitting inside it. */
export function circlePolygon(center: Pair, radius: number, segments = CIRCLE_SEGMENTS): Ring {
  const fit = Math.sqrt(Math.PI / ((segments / 2) * Math.sin((2 * Math.PI) / segments)));
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    ring.push([center[0] + radius * fit * Math.cos(angle), center[1] + radius * fit * Math.sin(angle)]);
  }
  return [...ring, ring[0]];
}

/** The rectangle of half-width `radius` along the segment a-b, or null for a zero-length segment. */
function segmentRectangle(a: Pair, b: Pair, radius: number): Ring | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const nx = (-dy / length) * radius;
  const ny = (dx / length) * radius;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]];
}

/** What a stroke covers, piece by piece: a circle at every point and a rectangle along every segment. */
function pieces(points: Pair[], radius: number): Poly[] {
  const out: Poly[] = [];
  points.forEach((point, i) => {
    out.push([circlePolygon(point, radius)]);
    if (i > 0) {
      const rectangle = segmentRectangle(points[i - 1], point, radius);
      if (rectangle) out.push([rectangle]);
    }
  });
  return out;
}

/** The ground a stroke of `width` meters along `points` covers: its polyline buffered by width / 2. */
export function strokeFootprint(points: Pair[], width: number): Multi {
  if (points.length === 0) return [];
  const [first, ...rest] = pieces(points, width / 2);
  return polygonClipping.union(first, ...rest);
}

/** Adds `footprint` to `shape`, or subtracts it when `erase`. */
export function paintFootprint(shape: Multi, footprint: Multi, erase: boolean): Multi {
  if (footprint.length === 0) return shape;
  if (erase) return shape.length === 0 ? shape : polygonClipping.difference(shape, footprint);
  return shape.length === 0 ? footprint : polygonClipping.union(shape, footprint);
}

/** The part of `shape` inside the axis-aligned box [minX, minY, maxX, maxY]. */
export function clipToBox(shape: Multi, [minX, minY, maxX, maxY]: [number, number, number, number]): Multi {
  if (shape.length === 0) return shape;
  const box: Poly = [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]];
  return polygonClipping.intersection(shape, box);
}

export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(sum) / 2;
}

/** Area of a shape: each part's outer ring minus its holes. */
export function shapeArea(shape: Multi): number {
  return shape.reduce((total, poly) => total + poly.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring), 0), 0);
}

export interface Outline {
  /** The closed outer ring of the largest part, in the shape's own coordinates, or null when the shape is empty. */
  ring: Ring | null;
  /** How many smaller, disconnected parts were left out (a boundary is a single ring). */
  droppedParts: number;
  /** Whether the kept part had holes, which were filled (a boundary has none). */
  filledHoles: boolean;
}

/** The single polygon a boundary can be: the largest part's outer ring, simplified to `tolerance`. */
export function outlineOf(shape: Multi, tolerance = OUTLINE_TOLERANCE_METERS): Outline {
  if (shape.length === 0) return { ring: null, droppedParts: 0, filledHoles: false };
  let best = shape[0];
  for (const poly of shape) if (ringArea(poly[0]) > ringArea(best[0])) best = poly;
  const ring = best[0];
  const open = ring.slice(0, -1);
  const keep = douglasPeucker(open, tolerance);
  const simplified = open.filter((_, i) => keep[i]);
  return {
    ring: simplified.length >= 3 ? [...simplified, simplified[0]] : ring,
    droppedParts: shape.length - 1,
    filledHoles: best.length > 1,
  };
}

/** Longitude/latitude <-> meters east/north of `origin`, on the same sphere the server uses. */
export function localProjection(origin: Position) {
  const per = metersPerDegree(origin[1]);
  return {
    toLocal: ([lon, lat]: Position): Pair => [(lon - origin[0]) * per.lon, (lat - origin[1]) * per.lat],
    toLonLat: ([x, y]: Pair): Position => [origin[0] + x / per.lon, origin[1] + y / per.lat],
  };
}

export interface FinalShape {
  ring: Position[] | null;
  droppedParts: number;
  filledHoles: boolean;
}

/**
 * A traced or painted ring, cut to `bbox` (the open area) and reduced to one simple ring. Longitude and
 * latitude in, longitude and latitude out; the result is clamped into the box so rounding cannot push a
 * corner a hair outside it, which the server would reject.
 */
export function clipRingToBbox(ring: Position[], bbox: BoundingBox): FinalShape {
  const origin: Position = [(bbox.min_longitude + bbox.max_longitude) / 2, (bbox.min_latitude + bbox.max_latitude) / 2];
  const { toLocal, toLonLat } = localProjection(origin);
  const [minX, minY] = toLocal([bbox.min_longitude, bbox.min_latitude]);
  const [maxX, maxY] = toLocal([bbox.max_longitude, bbox.max_latitude]);
  const local = closeRing(ring).map(toLocal) as Ring;
  const clipped = clipToBox([[local]], [minX, minY, maxX, maxY]);
  const { ring: outer, droppedParts, filledHoles } = outlineOf(clipped, 0);
  if (!outer) return { ring: null, droppedParts: 0, filledHoles: false };
  const clamped = outer.map((point) => {
    const [lon, lat] = toLonLat(point);
    return [Math.min(Math.max(lon, bbox.min_longitude), bbox.max_longitude), Math.min(Math.max(lat, bbox.min_latitude), bbox.max_latitude)] as Position;
  });
  return { ring: clamped, droppedParts, filledHoles };
}

/**
 * The shape a user paints with the brush: strokes of a width in meters, each added to (or, erasing,
 * subtracted from) one shape. Kept in meters around the first point, so widths are the same at any latitude.
 * Pointer events call `begin`, `extend` per thinned point and `end`; `shape` is live throughout.
 */
export class BrushPainting {
  private projection: ReturnType<typeof localProjection> | null = null;
  private current: Multi = [];
  private history: Multi[] = [];
  private stroke: { before: Multi; points: Pair[]; width: number; erase: boolean } | null = null;

  /** The painted shape in meters (empty when nothing is painted). */
  get shape(): Multi {
    return this.current;
  }

  get isEmpty(): boolean {
    return this.current.length === 0;
  }

  get canUndo(): boolean {
    return this.stroke !== null || this.history.length > 0;
  }

  /** The shape as polygons in longitude and latitude, for the map. */
  lonLatShape(): Position[][][] {
    const projection = this.projection;
    if (!projection) return [];
    return this.current.map((poly) => poly.map((ring) => ring.map(projection.toLonLat)));
  }

  /** The outline to save: the largest part's outer ring, in longitude and latitude. */
  outline(): FinalShape {
    const projection = this.projection;
    const { ring, droppedParts, filledHoles } = outlineOf(this.current);
    if (!ring || !projection) return { ring: null, droppedParts: 0, filledHoles: false };
    return { ring: ring.map(projection.toLonLat), droppedParts, filledHoles };
  }

  begin(point: Position, width: number, erase: boolean): void {
    if (!this.projection) this.projection = localProjection(point);
    const local = this.projection.toLocal(point);
    this.stroke = { before: this.current, points: [local], width, erase };
    this.current = paintFootprint(this.current, strokeFootprint([local], width), erase);
  }

  /** Adds a point to the stroke in progress, applying only the new piece, so dragging stays fast. */
  extend(point: Position): void {
    const stroke = this.stroke;
    if (!stroke || !this.projection) return;
    const local = this.projection.toLocal(point);
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(local);
    this.current = paintFootprint(this.current, strokeFootprint([previous, local], stroke.width), stroke.erase);
  }

  /** Finishes the stroke: redoes it from its simplified points, and remembers the shape before it for undo. */
  end(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    const keep = douglasPeucker(stroke.points, Math.min(stroke.width / 10, 2));
    const simplified = stroke.points.filter((_, i) => keep[i]);
    this.current = paintFootprint(stroke.before, strokeFootprint(simplified, stroke.width), stroke.erase);
    this.history.push(stroke.before);
  }

  /** Takes back the stroke in progress, or else the last finished one. */
  undo(): void {
    const stroke = this.stroke;
    if (stroke) {
      this.stroke = null;
      this.current = stroke.before;
      return;
    }
    const before = this.history.pop();
    if (before) this.current = before;
  }

  clear(): void {
    this.stroke = null;
    this.current = [];
    this.history = [];
    this.projection = null;
  }
}
