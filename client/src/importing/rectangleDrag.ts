import type { BoundingBox } from "../api/types";
import { areaSquareMeters, bboxSizeMeters, formatSquareKilometers, MAX_AREA_SQUARE_METERS } from "../geo/bbox";
import { metersPerDegree } from "../geo/localMeters";

/** The part of the rectangle under the pointer: the whole body, one side, or one corner. */
export type DragPart = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The smallest a resize can make either side of the rectangle. */
export const MIN_SIZE_METERS = 10;

/** Web Mercator ground size of one pixel at zoom 0 on the equator, for 512 px tiles (MapLibre's). */
const EQUATOR_METERS = 40_075_016.686;
const TILE_PIXELS = 512;

/** Meters on the ground per screen pixel at `latitude` and `zoom`, to turn a pixel handle radius into meters. */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (EQUATOR_METERS * Math.cos((latitude * Math.PI) / 180)) / (TILE_PIXELS * 2 ** zoom);
}

interface Local {
  centerLon: number;
  centerLat: number;
  perLon: number;
  perLat: number;
  halfW: number;
  halfH: number;
}

/** The rectangle in meters around its centre, so drags behave the same at any latitude. */
function local(rect: BoundingBox): Local {
  const centerLat = (rect.min_latitude + rect.max_latitude) / 2;
  const centerLon = (rect.min_longitude + rect.max_longitude) / 2;
  const per = metersPerDegree(centerLat);
  return {
    centerLon,
    centerLat,
    perLon: per.lon,
    perLat: per.lat,
    halfW: ((rect.max_longitude - rect.min_longitude) * per.lon) / 2,
    halfH: ((rect.max_latitude - rect.min_latitude) * per.lat) / 2,
  };
}

/**
 * What a pointer at `point` ([longitude, latitude]) would grab. A corner beats an edge, an edge
 * beats the inside, and the nearest candidate wins when handles overlap on a small rectangle.
 */
export function hitTest(rect: BoundingBox, point: [number, number], handleRadiusMeters: number): DragPart | null {
  const l = local(rect);
  const x = (point[0] - l.centerLon) * l.perLon;
  const y = (point[1] - l.centerLat) * l.perLat;
  const r = handleRadiusMeters;

  let best: { part: DragPart; distance: number } | null = null;
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const distance = Math.hypot(x - sx * l.halfW, y - sy * l.halfH);
      if (distance <= r && (!best || distance < best.distance)) {
        best = { part: `${sy > 0 ? "n" : "s"}${sx > 0 ? "e" : "w"}` as DragPart, distance };
      }
    }
  }
  if (best) return best.part;

  const edges: [DragPart, number, boolean][] = [
    ["n", Math.abs(y - l.halfH), Math.abs(x) <= l.halfW],
    ["s", Math.abs(y + l.halfH), Math.abs(x) <= l.halfW],
    ["e", Math.abs(x - l.halfW), Math.abs(y) <= l.halfH],
    ["w", Math.abs(x + l.halfW), Math.abs(y) <= l.halfH],
  ];
  for (const [part, distance, along] of edges) {
    if (along && distance <= r && (!best || distance < best.distance)) best = { part, distance };
  }
  if (best) return best.part;

  return Math.abs(x) <= l.halfW && Math.abs(y) <= l.halfH ? "move" : null;
}

/** Moves the dragged side to `moved` against the fixed one, flipping past it and keeping the minimum size. */
function resolveAxis(fixed: number, moved: number, originalSign: number): [number, number] {
  let value = moved;
  if (Math.abs(value - fixed) < MIN_SIZE_METERS) {
    const sign = value === fixed ? originalSign : Math.sign(value - fixed);
    value = fixed + sign * MIN_SIZE_METERS;
  }
  return value < fixed ? [value, fixed] : [fixed, value];
}

/**
 * The rectangle after dragging `part` by `delta` meters (east, north) from `start`. Move keeps the
 * size, an edge moves one side, a corner moves two. A side dragged past its opposite flips, and
 * neither side shrinks below MIN_SIZE_METERS.
 */
export function applyDrag(start: BoundingBox, part: DragPart, delta: { dx: number; dy: number }): BoundingBox {
  const l = local(start);
  let x0 = -l.halfW;
  let x1 = l.halfW;
  let y0 = -l.halfH;
  let y1 = l.halfH;

  if (part === "move") {
    x0 += delta.dx;
    x1 += delta.dx;
    y0 += delta.dy;
    y1 += delta.dy;
  } else {
    if (part.includes("w")) [x0, x1] = resolveAxis(x1, x0 + delta.dx, -1);
    if (part.includes("e")) [x0, x1] = resolveAxis(x0, x1 + delta.dx, 1);
    if (part.includes("s")) [y0, y1] = resolveAxis(y1, y0 + delta.dy, -1);
    if (part.includes("n")) [y0, y1] = resolveAxis(y0, y1 + delta.dy, 1);
  }

  return {
    min_longitude: l.centerLon + x0 / l.perLon,
    max_longitude: l.centerLon + x1 / l.perLon,
    min_latitude: l.centerLat + y0 / l.perLat,
    max_latitude: l.centerLat + y1 / l.perLat,
  };
}

export interface SizeDescription {
  widthMeters: number;
  heightMeters: number;
  areaKm2: number;
  overLimit: boolean;
}

/** Size and area as the server measures them, and whether the area is over the 1 km² limit. */
export function describeSize(bbox: BoundingBox): SizeDescription {
  const { width, height } = bboxSizeMeters(bbox);
  const area = areaSquareMeters(bbox);
  return { widthMeters: width, heightMeters: height, areaKm2: area / 1_000_000, overLimit: area > MAX_AREA_SQUARE_METERS };
}

/** The live readout shown beside the rectangle while it is dragged. */
export function sizeLabel(bbox: BoundingBox): string {
  const size = describeSize(bbox);
  const base = `${Math.round(size.widthMeters)} × ${Math.round(size.heightMeters)} m · ${formatSquareKilometers(size.areaKm2 * 1_000_000)}`;
  return size.overLimit ? `${base} · over the 1 km² limit` : base;
}

/** The CSS cursor that tells the user what dragging `part` does. */
export function cursorFor(part: DragPart | null): string {
  switch (part) {
    case "move": return "move";
    case "n":
    case "s": return "ns-resize";
    case "e":
    case "w": return "ew-resize";
    case "ne":
    case "sw": return "nesw-resize";
    case "nw":
    case "se": return "nwse-resize";
    default: return "";
  }
}
