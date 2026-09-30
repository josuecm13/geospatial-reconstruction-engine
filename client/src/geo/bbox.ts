import type { BoundingBox } from "../api/types";

/** Mirrors server/app/domain/bounding_box.py, so the client disables Import exactly when the server would refuse. */
export const EARTH_RADIUS_METERS = 6_371_000;
export const MAX_AREA_SQUARE_METERS = 1_000_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const [p1, l1, p2, l2] = [lat1, lon1, lat2, lon2].map(radians);
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Width along the south edge times height along the west edge, as the server measures it. */
export function areaSquareMeters(bbox: BoundingBox): number {
  const width = haversineMeters(bbox.min_latitude, bbox.min_longitude, bbox.min_latitude, bbox.max_longitude);
  const height = haversineMeters(bbox.min_latitude, bbox.min_longitude, bbox.max_latitude, bbox.min_longitude);
  return width * height;
}

export type BboxProblem = "empty" | "too_large" | "out_of_range";

/** Why the server would reject this box, or null when it would accept it. */
export function bboxProblem(bbox: BoundingBox): BboxProblem | null {
  const { min_latitude: s, min_longitude: w, max_latitude: n, max_longitude: e } = bbox;
  if ([s, n].some((lat) => lat < -90 || lat > 90) || [w, e].some((lon) => lon < -180 || lon > 180)) return "out_of_range";
  if (!(s < n && w < e)) return "empty";
  return areaSquareMeters(bbox) > MAX_AREA_SQUARE_METERS ? "too_large" : null;
}

/** The box two opposite corners span, whichever way they were dragged. */
export function bboxFromCorners(a: [number, number], b: [number, number]): BoundingBox {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  return {
    min_latitude: Math.min(latA, latB),
    min_longitude: Math.min(lonA, lonB),
    max_latitude: Math.max(latA, latB),
    max_longitude: Math.max(lonA, lonB),
  };
}

/** Rounded to 7 decimals (~1 cm), so a re-import of the same drawn box names the same area on the server. */
export function roundBbox(bbox: BoundingBox): BoundingBox {
  const r = (value: number) => Math.round(value * 1e7) / 1e7;
  return {
    min_latitude: r(bbox.min_latitude),
    min_longitude: r(bbox.min_longitude),
    max_latitude: r(bbox.max_latitude),
    max_longitude: r(bbox.max_longitude),
  };
}

export function sameBbox(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.min_latitude === b.min_latitude &&
    a.min_longitude === b.min_longitude &&
    a.max_latitude === b.max_latitude &&
    a.max_longitude === b.max_longitude
  );
}

/** A closed GeoJSON ring, counter-clockwise from the south-west corner. */
export function bboxRing(bbox: BoundingBox): [number, number][] {
  const { min_latitude: s, min_longitude: w, max_latitude: n, max_longitude: e } = bbox;
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

export function formatSquareKilometers(squareMeters: number): string {
  return `${(squareMeters / 1_000_000).toFixed(squareMeters < 100_000 ? 3 : 2)} km²`;
}
