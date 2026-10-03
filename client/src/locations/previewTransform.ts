import type { BoundingBox } from "../api/types";

/** Where a longitude/latitude lands in a preview canvas. */
export interface PreviewTransform {
  /** Pixels per degree of latitude (a degree of longitude is `cosLat` times that, so shapes keep their proportions). */
  scale: number;
  /** Pixels from the canvas's left and top edge to the rectangle's west and north edge. */
  offsetX: number;
  offsetY: number;
  cosLat: number;
  west: number;
  north: number;
}

/**
 * Fits `bbox` in a `width` x `height` canvas, centred, with `padding` pixels all round, scaling longitude by
 * the cosine of the centre latitude so the rectangle keeps the shape it has on the ground. A rectangle
 * with no extent gets scale 0 (everything lands in the middle).
 */
export function previewTransform(bbox: BoundingBox, width: number, height: number, padding = 0): PreviewTransform {
  const cosLat = Math.cos((((bbox.min_latitude + bbox.max_latitude) / 2) * Math.PI) / 180);
  const spanX = (bbox.max_longitude - bbox.min_longitude) * cosLat;
  const spanY = bbox.max_latitude - bbox.min_latitude;
  const room = { x: Math.max(0, width - 2 * padding), y: Math.max(0, height - 2 * padding) };
  const scale = spanX > 0 && spanY > 0 ? Math.min(room.x / spanX, room.y / spanY) : 0;
  return {
    scale,
    offsetX: (width - spanX * scale) / 2,
    offsetY: (height - spanY * scale) / 2,
    cosLat,
    west: bbox.min_longitude,
    north: bbox.max_latitude,
  };
}

/** The canvas position of a point. */
export function projectToPreview(transform: PreviewTransform, longitude: number, latitude: number): [number, number] {
  return [
    transform.offsetX + (longitude - transform.west) * transform.cosLat * transform.scale,
    transform.offsetY + (transform.north - latitude) * transform.scale,
  ];
}
