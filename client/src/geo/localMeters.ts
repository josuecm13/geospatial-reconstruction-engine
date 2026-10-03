import { EARTH_RADIUS_METERS } from "./bbox";

/** Meters per degree of latitude and of longitude at `latitude`, on the same sphere the server uses. */
export function metersPerDegree(latitude: number): { lat: number; lon: number } {
  const lat = (EARTH_RADIUS_METERS * Math.PI) / 180;
  return { lat, lon: lat * Math.cos((latitude * Math.PI) / 180) };
}
