import type { Position, Projection } from "../api/types";

/** A point on the ground in meters from the projection origin: `x` east, `z` south (north is -z), `y` is up. */
export interface Local {
  x: number;
  z: number;
}

/** [longitude, latitude] to local meters, using the scope's own projection metadata. */
export function toLocal(projection: Projection, [lon, lat]: Position): Local {
  return {
    x: (lon - projection.origin.longitude) * projection.meters_per_degree_longitude,
    z: -(lat - projection.origin.latitude) * projection.meters_per_degree_latitude,
  };
}

/** The inverse of `toLocal`. */
export function toLonLat(projection: Projection, x: number, z: number): Position {
  return [
    projection.origin.longitude + x / projection.meters_per_degree_longitude,
    projection.origin.latitude - z / projection.meters_per_degree_latitude,
  ];
}
