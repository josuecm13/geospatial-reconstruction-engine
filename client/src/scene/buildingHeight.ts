import type { BuildingProperties } from "../api/types";

export const METERS_PER_LEVEL = 3.2;

/** Heights for buildings whose source stated neither a height nor levels, by category. */
const DEFAULT_BY_CATEGORY: Record<string, number> = {
  house: 7,
  residential: 15,
  apartments: 15,
  commercial: 12,
  retail: 12,
  industrial: 10,
  church: 20,
  garage: 3,
  shed: 3,
};
export const FALLBACK_HEIGHT = 9;

/** `defaulted` is true only when the height comes from the category table, not from the source. */
export function buildingHeight(props: Pick<BuildingProperties, "height_meters" | "levels" | "category">): { height: number; defaulted: boolean } {
  if (props.height_meters != null) return { height: props.height_meters, defaulted: false };
  if (props.levels != null) return { height: props.levels * METERS_PER_LEVEL, defaulted: false };
  return { height: DEFAULT_BY_CATEGORY[props.category] ?? FALLBACK_HEIGHT, defaulted: true };
}
