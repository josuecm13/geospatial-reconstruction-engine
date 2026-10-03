import type { BoundingBox } from "../api/types";
import { EARTH_RADIUS_METERS } from "../geo/bbox";
import type { Camera } from "../routing/routes";

export interface Viewport {
  width: number;
  height: number;
}

/** What MapLibre's `flyTo` takes: where, how far in, how bowed the zoom-out arc is, and for how long (ms). */
export interface FlyParams {
  center: [number, number];
  zoom: number;
  curve: number;
  duration: number;
}

/** MapLibre's default `curve`: the arc zooms out about as far as the trip is long, then back in. */
export const FLY_CURVE = 1.42;
export const MIN_FLY_MS = 1200;
export const MAX_FLY_MS = 3500;
/** Space kept around the rectangle, in pixels, the same as the map's own fit. */
export const FLY_PADDING = 60;
/** A rectangle fitted to the map never zooms in past here, so a sliver does not end up at street-number scale. */
export const MAX_FIT_ZOOM = 19;
const TILE_SIZE = 512;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Where a latitude falls down the Web Mercator world, 0 at the top and 1 at the bottom. */
function mercatorY(latitude: number): number {
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians(latitude) / 2)) / Math.PI) / 2;
}

function latitudeOfMercatorY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How long a fly of `meters` takes: 1.2 s for a hop, growing by 0.6 s for every tenfold increase
 * in kilometers (9 km is 1.8 s, 99 km 2.4 s), and never more than 3.5 s.
 */
export function flyDurationMs(meters: number): number {
  const ms = MIN_FLY_MS + 600 * Math.log10(1 + Math.max(0, meters) / 1000);
  return Math.min(MAX_FLY_MS, Math.max(MIN_FLY_MS, ms));
}

/** The zoom at which `bbox` fits in `viewport` with `padding` pixels around it, between 0 and `MAX_FIT_ZOOM`. */
export function fitZoom(bbox: BoundingBox, viewport: Viewport, padding = FLY_PADDING): number {
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const lonFraction = (bbox.max_longitude - bbox.min_longitude) / 360;
  const latFraction = Math.abs(mercatorY(bbox.min_latitude) - mercatorY(bbox.max_latitude));
  const zoomX = Math.log2(availableWidth / (TILE_SIZE * lonFraction));
  const zoomY = Math.log2(availableHeight / (TILE_SIZE * latFraction));
  const zoom = Math.min(zoomX, zoomY);
  return Math.min(MAX_FIT_ZOOM, Math.max(0, Number.isNaN(zoom) ? 0 : zoom));
}

/**
 * The `flyTo` options that take the map from `from` to a view framing `toBbox`. The centre is the
 * rectangle's own (in Mercator, as the map fits), the zoom fits it with padding, and the duration
 * grows with the distance. Rectangles are at most 1 km², so none crosses the antimeridian.
 */
export function flyParams(from: Camera, toBbox: BoundingBox, viewport: Viewport, padding = FLY_PADDING): FlyParams {
  const lon = (toBbox.min_longitude + toBbox.max_longitude) / 2;
  const lat = latitudeOfMercatorY((mercatorY(toBbox.min_latitude) + mercatorY(toBbox.max_latitude)) / 2);
  return {
    center: [lon, lat],
    zoom: fitZoom(toBbox, viewport, padding),
    curve: FLY_CURVE,
    duration: flyDurationMs(distanceMeters(from, { lat, lon })),
  };
}

/** The part of a MapLibre map the fly needs, so this module never loads MapLibre. */
export interface FlyableMap {
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  getContainer(): HTMLElement;
  flyTo(options: FlyParams & { essential: boolean }): unknown;
  jumpTo(options: { center: [number, number]; zoom: number }): unknown;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Animates the map to frame `bbox` (a zoom-out, pan, zoom-in arc), or jumps there for a user who asked for less motion. */
export function flyToArea(map: FlyableMap, bbox: BoundingBox, reducedMotion: boolean = prefersReducedMotion()): void {
  const center = map.getCenter();
  const container = map.getContainer();
  const params = flyParams({ lat: center.lat, lon: center.lng, zoom: map.getZoom() }, bbox, {
    width: container.clientWidth,
    height: container.clientHeight,
  });
  if (reducedMotion) map.jumpTo({ center: params.center, zoom: params.zoom });
  else map.flyTo({ ...params, essential: true });
}

// --- who asked for the fly ---
// A page that opens on an explore URL jumps there (a pasted link, a reload). Only a click on a gallery
// card asks for the fly, by marking the area just before it navigates.

/** How long a mark lasts: long enough to cover the page change, short enough not to leak into a later visit. */
export const FLY_MARK_MS = 5000;
let marked: { areaId: string; at: number } | null = null;

export function markFlyTo(areaId: string, now: number = Date.now()): void {
  marked = { areaId, at: now };
}

/** True once, if `areaId` was marked within `FLY_MARK_MS`; a mark is used up whether or not it matched in time. */
export function consumeFlyTo(areaId: string, now: number = Date.now()): boolean {
  const mark = marked;
  marked = null;
  return mark !== null && mark.areaId === areaId && now - mark.at <= FLY_MARK_MS;
}
