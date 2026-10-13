import type { BuildingProperties } from "../api/types";

/** One storey, in metres. The server uses the same figure (`LEVEL_HEIGHT_METERS` in `domain/generation.py`). */
export const METERS_PER_LEVEL = 3.0;

/** Defaults for buildings whose source stated neither a height nor levels, by the raw OSM `building=` value. */
const DEFAULT_BY_TYPE: Record<string, number> = {
  house: 2 * METERS_PER_LEVEL,
  detached: 2 * METERS_PER_LEVEL,
  semidetached_house: 2 * METERS_PER_LEVEL,
  terrace: 2 * METERS_PER_LEVEL,
  bungalow: 2 * METERS_PER_LEVEL,
  hut: 2 * METERS_PER_LEVEL,
  cabin: 2 * METERS_PER_LEVEL,
  residential: 2 * METERS_PER_LEVEL,
  yes: 2 * METERS_PER_LEVEL,
  apartments: 5 * METERS_PER_LEVEL,
  garage: 3,
  garages: 3,
  shed: 3,
  carport: 3,
  church: 20,
  cathedral: 20,
  commercial: 12,
  retail: 12,
  industrial: 10,
  warehouse: 10,
};

/** Defaults by category, for a null or unlisted type. */
const DEFAULT_BY_CATEGORY: Record<string, number> = {
  residential: 2 * METERS_PER_LEVEL,
  commercial: 12,
  industrial: 10,
  civic: 12,
};
export const FALLBACK_HEIGHT = 2 * METERS_PER_LEVEL;

/** `defaulted` is true only when the height comes from a default table, not from the source. */
export function buildingHeight(
  props: Pick<BuildingProperties, "height_meters" | "levels" | "category"> & { building_type?: string | null },
): { height: number; defaulted: boolean } {
  if (props.height_meters != null) return { height: props.height_meters, defaulted: false };
  if (props.levels != null) return { height: props.levels * METERS_PER_LEVEL, defaulted: false };
  const byType = props.building_type != null ? DEFAULT_BY_TYPE[props.building_type] : undefined;
  return { height: byType ?? DEFAULT_BY_CATEGORY[props.category] ?? FALLBACK_HEIGHT, defaulted: true };
}
