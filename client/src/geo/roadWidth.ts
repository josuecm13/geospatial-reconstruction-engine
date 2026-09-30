/** Web Mercator meters per pixel at zoom 0 for MapLibre's 512 px tiles, at the equator. */
const EQUATOR_METERS_PER_PIXEL_Z0 = 40_075_016.686 / 512;

export function metersPerPixel(zoom: number, latitude: number): number {
  return (EQUATOR_METERS_PER_PIXEL_Z0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * A MapLibre `line-width` expression that draws each road at its generated `width_meters` on the
 * ground, at every zoom, for an area around `latitude` (1 km boxes make one latitude exact enough).
 * Pixel width doubles per zoom level, so an exponential base-2 interpolation between two stops is exact.
 */
export function roadWidthExpression(latitude: number, minPixels = 1): unknown[] {
  const at = (zoom: number) => ["max", minPixels, ["/", ["get", "width_meters"], metersPerPixel(zoom, latitude)]];
  return ["interpolate", ["exponential", 2], ["zoom"], 10, at(10), 24, at(24)];
}
