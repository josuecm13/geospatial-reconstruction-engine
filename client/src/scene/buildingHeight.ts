import type { BuildingProperties, Feature } from "../api/types";
import { TWO_STOREY_SHARE_DEFAULT, drawStoreys, storeyShares } from "./storeyMix";

/** One storey, in metres. The server uses the same figure (`LEVEL_HEIGHT_METERS` in `domain/generation.py`). */
export const METERS_PER_LEVEL = 3.0;

/** Types that mean a low-rise house whose storeys are unknown: 1 or 2 storeys, drawn per building (see `storeyMix.ts`). */
const LOW_RISE_TYPES = new Set(["yes", "house", "detached", "semidetached_house", "terrace", "bungalow", "hut", "cabin", "residential"]);

/** Fixed defaults for other buildings whose source stated neither a height nor levels, by the raw OSM `building=` value. */
const DEFAULT_BY_TYPE: Record<string, number> = {
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

/** Defaults by category, for a null or unlisted type that is not low-rise housing. */
const DEFAULT_BY_CATEGORY: Record<string, number> = {
  commercial: 12,
  industrial: 10,
  civic: 12,
};
export const FALLBACK_HEIGHT = 2 * METERS_PER_LEVEL;

/** The seed that decides one building's storey draw, and the share of two-storey buildings it is drawn against. */
export interface StoreyMix {
  seed: string;
  share: number;
}

/** `defaulted` is true only when the height comes from a default table or a storey draw, not from the source. */
export function buildingHeight(
  props: Pick<BuildingProperties, "height_meters" | "levels" | "category"> & { building_type?: string | null },
  mix: StoreyMix = { seed: "", share: TWO_STOREY_SHARE_DEFAULT },
): { height: number; defaulted: boolean } {
  if (props.height_meters != null) return { height: props.height_meters, defaulted: false };
  if (props.levels != null) return { height: props.levels * METERS_PER_LEVEL, defaulted: false };
  const type = props.building_type ?? null;
  const drawn = { height: drawStoreys(mix.seed, mix.share) * METERS_PER_LEVEL, defaulted: true };
  if (type != null && LOW_RISE_TYPES.has(type)) return drawn;
  const byType = type != null ? DEFAULT_BY_TYPE[type] : undefined;
  if (byType !== undefined) return { height: byType, defaulted: true };
  if (props.category === "residential" || props.category === "unspecified") return drawn;
  return { height: DEFAULT_BY_CATEGORY[props.category] ?? FALLBACK_HEIGHT, defaulted: true };
}

/** Heights for a set of buildings, in order; each one's storey share comes from its block, else the whole set. */
export function buildingHeights(features: Feature<BuildingProperties>[]): { height: number; defaulted: boolean }[] {
  const shares = storeyShares(features.map((f) => f.properties));
  return features.map((f) => buildingHeight(f.properties, { seed: String(f.id), share: shares.forBlock(f.properties.block_id) }));
}
