# Client feature map

The list of what the API can do, so the client (Milestone 9 onward) covers all of it and doesn't
ship a weaker version of the backend. The second half is an open brainstorm of UI ideas that go
beyond parity.

## How to maintain this file

- When a PR adds or changes an API capability, add or update its row here in the same PR.
- **API status**: `shipped` (on `main`), `planned` (has an issue or a milestone), or `idea`.
- **Client**: `—` means not built yet, `partial`, or `done`. Update it when client work lands.
- A capability the API has and the client doesn't surface is a gap. It is either built or
  written down here as intentionally out of scope. It never just disappears.

## 1. API capabilities

### Import areas

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Import a bounded area (≤ 1 km × 1 km) from an OSM payload. Re-import reconciles and deletes what the payload omits | `POST /import-areas` | shipped | — | Draw or enter the rectangle. Show the 1 km² limit while drawing. Warn that re-import is destructive |
| Import status and entity counts (roads, nodes, buildings, POIs, area features, blocks, linked buildings) | `GET /import-areas/{id}` | shipped | — | Handle `pending` / `importing` / `failed`. `map-data` returns 409 `import_area_not_ready` until the import completes |
| Created / updated / removed counts on import | `POST /import-areas` | planned (#6) | — | Show a diff summary after a re-import |
| Live Overpass import (no payload upload) | — | planned (M9, #14–#20) | — | The main entry point once it exists |

### Map data (`GET /import-areas/{id}/map-data`)

| Layer / property | API status | Client | Client notes |
|---|---|---|---|
| Road segments: geometry, `from_node_id` / `to_node_id`, `distance_meters`, `is_vehicle_accessible` | shipped | — | |
| Road cross-section: `lane_count`, `lane_count_provenance` (`tagged` / `defaulted`), `source_lane_count`, `lane_type` (`narrow` / `normal` / `wide`), `width_meters` | shipped | — | Draw roads at their real width. Show observed vs. defaulted values differently |
| Street: `name`, `classification` | shipped | — | Labels, and styling by classification |
| Logical street id on segments | planned (#35) | — | Needed to select or highlight a whole street |
| Navigable nodes | shipped | — | Usually hidden. Useful in a debug layer |
| Blocks: boundary polygon, `area_square_meters` | shipped | — | |
| Blocks: `buildable_area` (MultiPolygon or null), `buildable_area_square_meters`, `is_median`, `is_clipped` | shipped | — | Computed and persisted since M7.2, but `block_feature` exposes only `area_square_meters` |
| Buildings: footprint, `category`, `block_id` | shipped | — | Footprints only, with no height until M8.1 |
| POIs: point, `category`, `name` | shipped | — | |
| Area features: polygon, `kind` | shipped | — | |
| `attribution` ("© OpenStreetMap contributors") | shipped | — | **Required**: must always be visible |

### Spatial queries (whole import area)

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Within a radius: node / POI / building / area feature | `GET …/nearby` | shipped | — | Click and drag a circle |
| Inside a bbox, `intersects` or `contains`: node / building / area feature (no POIs) | `GET …/within-bbox` | shipped | — | Box select. The query box has the same 1 km² limit |
| Nearest node / segment to a coordinate | `GET …/nearest` | shipped | — | Snap to the network on hover |
| Nearest segment with its full cross-section | `GET …/nearest` | planned (#36) | — | Today `lane_count` can differ from what `map-data` returns for the same segment |
| Building footprint area (m²) | `GET …/buildings/{id}/footprint-area` | shipped | — | Building inspector |

### Routing

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Route A → B: nodes, segments, geometry, total distance | `POST …/routes` | shipped | — | |
| Named strategy (today only `distance`, the default). An unknown name returns the registered list | `POST …/routes` | shipped | — | Build the strategy picker from `details.registered_strategies` so it isn't hardcoded |
| Snap info: origin and destination node, and snap distance | `POST …/routes` | shipped | — | Show the snap offset. Warn when it's large |
| Turn restrictions honored | shipped (implicit) | — | Explain a detour ("no left turn here") |

### Traced boundaries and export (Milestone 8, #21, complete)

| Capability | API status | Client | Client notes |
|---|---|---|---|
| Create / list / fetch / delete named traced boundaries within the import rectangle: `POST`/`GET …/boundaries`, `GET`/`DELETE …/boundaries/{id}`. Returned as GeoJSON `Feature`s (list as a `FeatureCollection`) with `name`, `import_area_id`, `created_at` | shipped | — | Tracing tool (by vertices or freehand). On 422 `invalid_boundary`, show `details.rule` (`self_intersecting`, `outside_import_area`, `holes_not_supported`, `not_closed`, …). A single ring, no holes |
| Scope `nearby` / `within-bbox` / `nearest` to a boundary: optional `boundary_id` query parameter; entities that intersect the boundary. `footprint-area` stays unscoped | shipped | — | A global "scope" selector: import area or one boundary. 404 `boundary_not_found` if the boundary was deleted meanwhile |
| Export a scope in filter mode: `map-data?boundary_id=…` (whole entities intersecting it, plus every endpoint node of its segments, so still routable). The response states `scope` (`{type: import_area|boundary, id}`) and `mode` | shipped | — | |
| Export a scope in clip mode: `map-data?mode=clip` (with or without `boundary_id`). Geometry and blocks' `buildable_area` are cut at the scope; multi-part cuts are `Multi*` geometries; entities only touching the edge are omitted; no extra end nodes; distances and areas describe the whole entity | shipped | — | Label clip mode as "not routable". Handle `MultiLineString`/`MultiPolygon` |
| Local projection metadata on every `map-data` response: `projection.origin` (the scope's centroid) and `meters_per_degree_latitude` / `_longitude`, on the same sphere as `distance_meters` | shipped | — | For a Cartesian or 3D renderer (Three.js) |

### Later milestones (planned)

| Capability | Milestone | Client notes |
|---|---|---|
| Building height and levels from source (unknown stays null) | M8.1 | Extrude in 3D. Unknown heights look different from measured ones |
| Generated block content: seeded, reproducible, with provenance | M11 | Toggle between raw, generated, and both. Seed control. Marker for stale runs |
| Export layer selection: raw / generated / both | M11 | |
| Asset identifiers for POIs and generated buildings, with a fallback chain | M12 | The client maps identifiers to models and materials |

### Error contract (every endpoint)

Every non-2xx response is `{"error": {"code", "message", "details"}}`. The client should switch on
`code`, not on the HTTP status: `invalid_request`, `invalid_bounding_box`, `invalid_coordinate`,
`payload_outside_bounding_box`, `ingestion_failed`, `import_area_not_found`,
`import_area_not_ready`, `import_conflict`, `building_not_found`, `invalid_boundary` (with
`details.rule`), `boundary_name_conflict`, `boundary_not_found`, `invalid_spatial_query`,
`no_navigable_node`, `no_route_found`, `unknown_routing_strategy`, `not_found`,
`method_not_allowed`, `database_unavailable`, `configuration_error`, `internal_error`.

## 2. UI brainstorm

Ideas, not commitments. Once one is chosen, it becomes an issue in the milestone it belongs to.

### Exploring the reconstruction
- **Observed vs. generated lens**: one switch that colors every value by provenance (tagged,
  defaulted, inferred, generated). The project's core idea is "OSM is hints", and this makes it
  visible.
- **Road cross-section inspector**: click a segment to see a drawn cross-section (lanes, lane
  type, width) with the provenance of each value.
- **Block inspector**: boundary vs. buildable area, median and edge flags, the buildings it
  contains, and the streets that bound it.
- **Real-width roads**: draw road polygons from `width_meters` instead of 1 px lines, so the map
  reads like a floor plan.
- **Debug layers**: navigable nodes, turn movements at an intersection, and segment direction
  arrows.

### Scopes and boundaries
- **Side-by-side scopes**: split view comparing the full import area with a traced boundary, or
  two boundaries with each other.
- **Snap-to-street tracing**: vertices snap to road centerlines or block edges, so a neighborhood
  can be traced in a few clicks.
- **Boundary library**: named cuts per area, with thumbnails, per-scope counts, and rename or
  duplicate.

### Routing
- **Drag-to-reroute**: move the origin or destination and recalculate live.
- **Route explanation**: list the streets taken, and mark restrictions that forced a detour.
- **Strategy comparison**: overlay the routes from several strategies once more exist.

### Import and data lifecycle
- **Re-import diff**: created / updated / removed shown in color on the map (depends on #6).
- **Import history** per area, with when it happened, the counts, and what changed.
- **Data health panel**: roads dropped for unmapped classes, failed restrictions, and the
  share of defaulted values.

### 3D and export
- **3D mode**: extruded footprints (M8.1 heights, with a clear placeholder when height is
  unknown), roads at real width, and blocks as terrain.
- **Generation playground** (M11): change the seed or density and watch the block repopulate.
  Pin a seed you like.
- **Export panel**: pick the scope, mode (filter / clip), and layers, and download GeoJSON with
  the projection metadata.

### General polish
- Shareable URL state (area, scope, selection, camera).
- Keyboard shortcuts and a command palette.
- Offline cache of the last loaded area.
