import type { Feature } from "../api/types";

/** The engine's own representation of an imported area, drawn over the basemap: this is what was
 * served from the API, not the basemap's rendering of OSM. */
export const LAYERS = ["area_features", "generation_zones", "blocks", "road_segments", "buildings", "generated_buildings"] as const;
export type LayerName = (typeof LAYERS)[number];

/**
 * The properties each source keeps: only those its layer's `paint` and `filter` read (mapDataLayers.ts, and
 * `roadWidthExpression` for the road width). MapLibre copies every property into its worker and into each tile, so
 * the rest stay out; the popup and the block panel read the full set from a `PropertyLookup`.
 */
export const SOURCE_KEYS: Record<LayerName, readonly string[]> = {
  area_features: ["kind"],
  generation_zones: ["reason"],
  blocks: ["eligibility", "is_median"],
  road_segments: ["lane_type", "width_meters"],
  buildings: ["height_meters"],
  generated_buildings: [],
};

/** A source's features by their numeric id (MapLibre keeps a numeric feature id and drops a string one): the full properties. */
export type PropertyLookup = Map<number, Record<string, unknown>>;

export interface SlimCollection {
  data: { type: "FeatureCollection"; features: Feature<Record<string, unknown>>[] };
  /** The full properties of each feature, by the id it carries in `data`. */
  properties: PropertyLookup;
}

/**
 * A collection cut down to `keys` (only those a feature has, so `["has", key]` still tells) with each feature given its
 * index as a numeric id, and the lookup from that id to the feature's full properties.
 */
export function slimCollection(collection: { features: readonly Feature<object>[] } | null | undefined, keys: readonly string[]): SlimCollection {
  const features: SlimCollection["data"]["features"] = [];
  const properties: PropertyLookup = new Map();
  for (const [id, feature] of (collection?.features ?? []).entries()) {
    const full = feature.properties as Record<string, unknown>;
    const slim: Record<string, unknown> = {};
    for (const key of keys) if (key in full) slim[key] = full[key];
    properties.set(id, full);
    features.push({ ...feature, id: id as unknown as string, properties: slim });
  }
  return { data: { type: "FeatureCollection", features }, properties };
}
