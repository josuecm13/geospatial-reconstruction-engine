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
}

export interface BuildingProperties {
  category: string;
  block_id: string | null;
  height_meters: number | null;
  levels: number | null;
  /** The area that stores it: the requested one, or an inner area it composes. */
  import_area_id: string;
}

export interface BlockProperties {
  area_square_meters: number;
  buildable_area: Geometry | null;
  buildable_area_square_meters: number;
  is_median: boolean;
  is_clipped: boolean;
  import_area_id: string;
}

export interface PoiProperties {
  category: string;
  name: string | null;
  import_area_id: string;
}

export interface AreaFeatureProperties {
  kind: string;
  import_area_id: string;
}

export interface Projection {
  origin: Coordinate;
  meters_per_degree_latitude: number;
  meters_per_degree_longitude: number;
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
