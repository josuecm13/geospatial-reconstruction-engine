/** Shapes of the API's responses (server/app/api/schemas.py). Positions are [longitude, latitude]. */

export type Position = [number, number];

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export interface Feature<P = Record<string, unknown>> {
  type: "Feature";
  id: string;
  geometry: Geometry;
  properties: P;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: Feature<P>[];
}

export interface BoundingBox {
  min_latitude: number;
  min_longitude: number;
  max_latitude: number;
  max_longitude: number;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export type ImportStatus = "pending" | "importing" | "completed" | "failed";

export interface ImportArea {
  id: string;
  provider: string;
  bbox: BoundingBox;
  status: ImportStatus;
  road_count: number | null;
  node_count: number | null;
  building_count: number | null;
  poi_count: number | null;
  area_feature_count: number | null;
  block_count: number;
  linked_building_count: number | null;
  imported_at: string | null;
  /** A real-world place name for the area ("Prenzlauer Berg"), when the API could resolve one. */
  place_name?: string | null;
  /** Where that place is ("Berlin, Germany"). */
  place_context?: string | null;
}

export interface RoadSegmentProperties {
  from_node_id: string;
  to_node_id: string;
  distance_meters: number;
  lane_count: number;
  lane_count_provenance: "tagged" | "defaulted";
  source_lane_count: number | null;
  lane_type: "narrow" | "normal" | "wide";
  width_meters: number;
  is_vehicle_accessible: boolean;
  street: { id: string; name: string | null; classification: string };
  /** Ground height at each vertex of the geometry, in order; null when the area has no terrain. */
  elevation_exact: number[] | null;
  elevation_smoothed: number[] | null;
}

export interface BuildingProperties {
  category: string;
  block_id: string | null;
  height_meters: number | null;
  levels: number | null;
  /** The area that stores it: the requested one, or an inner area it composes. */
  import_area_id: string;
  /** The lowest ground under the footprint, metres above sea level; null when the area has no terrain. */
  base_elevation_meters: number | null;
}

/** Why a block can or can't be generated on (contract section 1); the first matching reason wins. */
export type Eligibility = "eligible" | "clipped" | "median" | "no_buildable_area";

/** The settlement style of a block's generated buildings. */
export type BlockStyle = "regular" | "informal" | "sparse";

/** A block's feedback: a count of buildings the owner says belong there, or "none". */
export interface BlockFeedback {
  building_count: number | null;
  no_buildings: boolean;
  updated_at: string;
}

export interface BlockProperties {
  area_square_meters: number;
  buildable_area: Geometry | null;
  buildable_area_square_meters: number;
  is_median: boolean;
  is_clipped: boolean;
  import_area_id: string;
  eligibility: Eligibility;
  real_building_count: number;
  /** 0 without a run. */
  generated_building_count: number;
  /** True when the block was an exemplar in the current run. */
  is_reference: boolean;
  /** The block it learned from; null for defaults (and without a run). */
  reference_block_id: string | null;
  /** Null without a run. */
  style: BlockStyle | null;
  feedback: BlockFeedback | null;
}

export type CountSource = "reference" | "default" | "feedback";

export interface GeneratedBuildingProperties {
  block_id: string;
  style: BlockStyle;
  levels: number | null;
  height_meters: number;
  base_elevation_meters: number | null;
  reference_block_id: string | null;
  count_source: CountSource;
  generated: true;
}

export type ZoneReason = "water" | "steep" | "landuse" | "setback";

export interface GenerationZoneProperties {
  block_id: string;
  reason: ZoneReason;
}

export type StaleReason = "roads_changed" | "terrain_changed";

/** The area's current generation run (`GET /import-areas/{id}/generation`). */
export interface GenerationRun {
  run_id: string;
  seed: number;
  algorithm_version: string;
  created_at: string;
  building_count: number;
  /** Blocks that got at least one building: can be lower than `eligible_block_count`. */
  block_count: number;
  eligible_block_count: number;
  stale: boolean;
  stale_reasons: StaleReason[];
  feedback_shortfall_block_ids: string[];
  calibration_ratio: number | null;
}

/** The body of `PUT /blocks/{id}/feedback`: exactly one of the two. */
export type BlockFeedbackBody = { building_count: number } | { no_buildings: true };

/** What `PUT /blocks/{id}/feedback` returns: the stored feedback and whose it is. */
export interface StoredFeedback extends BlockFeedback {
  block_id: string;
  import_area_id: string;
}

/** An entry of `GET /import-areas/{id}/feedback`. */
export interface AreaFeedbackEntry extends StoredFeedback {
  /** True when its block no longer exists. */
  orphaned: boolean;
}

export interface PoiProperties {
  category: string;
  name: string | null;
  import_area_id: string;
}

/** The kinds the engine draws; the API may add more, which draw as green. */
export type AreaFeatureKind = "water" | "park" | "forest" | "farmland" | "cemetery" | "railway" | "industrial";

export interface AreaFeatureProperties {
  kind: AreaFeatureKind | string;
  import_area_id: string;
}

export interface Projection {
  origin: Coordinate;
  meters_per_degree_latitude: number;
  meters_per_degree_longitude: number;
}

/** The area's ground: a regular lat/lon grid, row-major from the SW corner (south to north, west to east). */
export interface ElevationGrid {
  origin: Coordinate;
  lat_step: number;
  lon_step: number;
  rows: number;
  cols: number;
  /** `rows * cols` heights in metres above sea level. */
  heights: number[];
}

export interface Elevation {
  source: string;
  attribution: string;
  version: number;
  smoothing_meters: number;
  grid: ElevationGrid;
}

export type ExportMode = "filter" | "clip";

export interface MapData {
  attribution: string;
  /** `composed_area_ids`: the completed areas inside the rectangle whose features are composed in. */
  scope: { type: "import_area" | "boundary"; id: string; composed_area_ids: string[] };
  mode: ExportMode;
  projection: Projection;
  road_segments: FeatureCollection<RoadSegmentProperties>;
  navigable_nodes: FeatureCollection;
  blocks: FeatureCollection<BlockProperties>;
  buildings: FeatureCollection<BuildingProperties>;
  pois: FeatureCollection<PoiProperties>;
  area_features: FeatureCollection<AreaFeatureProperties>;
  /** The area's current generation run; null when it has none. */
  generation: GenerationRun | null;
  /** Composed from the owner areas, like `buildings`. */
  generated_buildings: FeatureCollection<GeneratedBuildingProperties>;
  /** From the area's own run, shaded by reason. */
  generation_zones: FeatureCollection<GenerationZoneProperties>;
  /** Null when the area has no terrain yet (not analysed, or the source was unavailable). */
  elevation: Elevation | null;
}

export interface BoundaryProperties {
  name: string;
  import_area_id: string;
  created_at: string;
}

export interface Route {
  node_ids: string[];
  segment_ids: string[];
  geometry: Geometry | null;
  total_distance_meters: number;
  strategy: string;
  origin_node_id: string;
  destination_node_id: string;
  origin_snap_distance_meters: number;
  destination_snap_distance_meters: number;
}

/** `GET /routing-strategies`: the registered names (sorted) and the one used when a route names none. */
export interface RoutingStrategies {
  strategies: string[];
  default: string;
}

/** Every error code the API can return (docs/client-features.md → Errors). */
export type ErrorCode =
  | "invalid_request"
  | "invalid_bounding_box"
  | "invalid_coordinate"
  | "payload_outside_bounding_box"
  | "ingestion_failed"
  | "source_incomplete"
  | "upstream_unavailable"
  | "import_area_not_found"
  | "import_area_not_ready"
  | "import_conflict"
  | "import_in_progress"
  | "elevation_unavailable"
  | "generation_not_found"
  | "block_not_found"
  | "feedback_not_found"
  | "import_job_not_found"
  | "building_not_found"
  | "invalid_boundary"
  | "boundary_name_conflict"
  | "boundary_not_found"
  | "invalid_spatial_query"
  | "no_navigable_node"
  | "no_route_found"
  | "unknown_routing_strategy"
  | "payload_too_large"
  | "not_found"
  | "method_not_allowed"
  | "http_error"
  | "database_unavailable"
  | "configuration_error"
  | "internal_error";

/** The 202 answer to `POST /import-areas` with `background: true`, and to `POST /import-areas/{id}/elevation` and `/generation`. */
export interface ImportStarted {
  import_area_id: string;
  events_url: string;
}

/**
 * One batch of a generation job's `generated` events: the buildings of one ring of blocks (nearest the area's
 * centre first; a ring can come as several events with the same `ring`, at most 500 buildings each), with the
 * ids the run will store. Provisional until `completed`.
 */
export interface GeneratedEvent {
  projection: Projection;
  ring: number;
  blocks_done: number;
  block_count: number;
  buildings: FeatureCollection<GeneratedBuildingProperties>;
}

/** The stages of a background import's event stream, in the order the server sends them. */
export const IMPORT_STAGES = ["fetched", "ground", "roads", "blocks", "buildings", "elevation", "generated", "completed", "failed"] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

/** The `data` of each stage's event (server/app/api/background_import.py). */
export interface StageData {
  fetched: { projection: Projection; element_count: number; inner_area_ids?: string[] };
  ground: { projection: Projection; area_features: FeatureCollection<AreaFeatureProperties>; pois: FeatureCollection<PoiProperties> };
  roads: { projection: Projection; road_segments: FeatureCollection<RoadSegmentProperties> };
  blocks: { projection: Projection; blocks: FeatureCollection<BlockProperties> };
  /** `ring` counts the non-empty rings from the centre out: 0, 1, 2, ... */
  buildings: { projection: Projection; ring: number; buildings: FeatureCollection<BuildingProperties> };
  /** `error` is "elevation_unavailable" when the source failed; the import still completes, flat. */
  elevation: { projection: Projection; elevation: Elevation | null; error: string | null };
  generated: GeneratedEvent;
  completed: ImportArea;
  failed: { code: string; message: string; details: Record<string, unknown> | null };
}

export type StageEvent = { [S in ImportStage]: { stage: S; data: StageData[S] } }[ImportStage];

export type SceneThemeId = "night-clay" | "light-clay" | "blueprint" | "realistic";
export type TimeOfDayPreset = "dawn" | "midday" | "golden-hour" | "night";

/** The landing stage's look: `/settings/landing-theme` holds one, or null for the default. */
export interface LandingTheme {
  theme: SceneThemeId;
  time_of_day: TimeOfDayPreset;
}
