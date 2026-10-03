# Architecture: first milestone

## Scope and assumptions

The service is limited to urban/suburban bounding boxes of up to 1 km by 1 km. It is vehicle-road routing initially, with lane counts and intersection turn permissions represented in the first routing model. Coordinates arrive in WGS 84 (EPSG:4326). PostGIS `geography` operations supply meter-based distance and area calculations, while `geometry` values in EPSG:4326 retain interoperable map shapes.

An import is identified by its provider and normalized bounding box. Source IDs are retained on imported entities and made unique per provider, so rerunning an import upserts rather than duplicates data.

## Boundaries

```
OSM provider -> OSM adapter -> ingestion service -> GeoDB / domain model
                                                  -> graph repository -> routing engine
API ---------------------------------------------------------------> map client
```

The OSM adapter owns Overpass/API requests and tag interpretation. It produces application-level import records; OSM tags must not cross into the domain, graph, routing, or API contracts. The graph repository exposes a provider-neutral `RoadGraph` abstraction. Routing strategies consume that abstraction, never OSM or SQL rows.

## Core domain entities

| Entity | Responsibility |
| --- | --- |
| `ImportArea` | Source, bounding box, status, counts, and import timestamp. |
| `Street` | Named/classified logical street, source identity, and shared street metadata. |
| `Road` | A mapped street way or carriageway with source geometry and lane profile. |
| `NavigableNode` | A routable coordinate; intersections are represented explicitly. |
| `RoadSegment` | Directed traversable connection, length, direction, lane profile, and access metadata. |
| `TurnMovement` | An allowed or prohibited transition from an incoming segment to an outgoing segment at a node, classified as left, right, straight, or U-turn. |
| `Block` | Derived, not sourced: a face enclosed by road segments, or closed against the import bounding box where roads leave it (`is_clipped`). It carries its ordered bounding segments, a buildable area (the block minus each bounding road's half-width), and an `is_median` flag when that area is too narrow to build on. Its id derives from its bounding-segment set, so it survives an unchanged re-import. |
| `Building` | Classified polygon footprint, source identity, and the block that contains it, if any. |
| `PointOfInterest` | Categorized named/unnamed point or representative location. |
| `AreaFeature` | An extension point for parks now and natural features later. |
| `TracedBoundary` | A named, non-rectangular polygon over an import area that narrows it for queries and exports without changing anything imported. Several can coexist over one area. |
| `Route` | Origin/destination, ordered nodes and segments, total distance, and cost. |

## Database model

PostgreSQL with PostGIS is the only persistence requirement. A future runtime should use migrations to create these tables:

| Table | Key fields |
| --- | --- |
| `import_areas` | UUID, provider, bbox polygon, status, imported_at |
| `streets` | UUID, import ID, provider/source ID, name, classification, metadata |
| `roads` | UUID, street ID, import ID, provider/source ID, line geometry, lane profile, metadata |
| `navigable_nodes` | UUID, import ID, provider/source ID, point geometry |
| `road_segments` | UUID, road ID, from-node ID, to-node ID, line geometry, distance meters, allowed direction, lane profile, access metadata |
| `turn_movements` | UUID, intersection node ID, incoming segment ID, outgoing segment ID, movement kind, allowed flag, restriction kind, source metadata |
| `blocks` | UUID (uuid5 of import ID + bounding-segment set), import ID, boundary polygon, area square meters, buildable area multipolygon (nullable), buildable area square meters, is_median, is_clipped |
| `block_boundary_segments` | block ID, road segment ID, sequence order |
| `buildings` | UUID, import ID, block ID (nullable), provider/source ID, category, polygon geometry, metadata |
| `points_of_interest` | UUID, import ID, provider/source ID, category, name, point geometry, metadata |
| `area_features` | UUID, import ID, provider/source ID, kind, polygon geometry, metadata |
| `traced_boundaries` | UUID, import ID, name (unique per import), polygon geometry (valid, simple, covered by the import's bbox) |

Use GiST indexes on spatial columns, foreign keys for graph relationships, and unique constraints on `(provider, source_id, import_area_id)` where a source ID is only unique within an import. Lane counts are stored as structured values on each directed segment: total lanes where known, plus forward and backward counts when available. A missing lane value is defaulted, visibly: the stored value records only what the source stated (null when it is silent), and the cross-section read from it is generated — tagged lanes win, otherwise two lanes per street (1 + 1 two-way, both forward one-way), a lane type (`narrow`/`normal`/`wide`) by road classification, and a carriageway width of lane count × lane-type width — with each lane count marked `tagged` or `defaulted`. The cross-section is computed on read (`app/domain/cross_section.py`), never stored. `road_segments` are the canonical graph edges, so their explicit direction prevents routing from inferring semantics from a raw line. `turn_movements` are constrained so their incoming segment ends at the intersection node and their outgoing segment starts there.

## OSM translation

The adapter fetches only streets/roads, building footprints, POIs, relevant areas, and the OSM tags needed for lane and turn semantics. It maps OSM values into constrained application categories: e.g. `highway=*` becomes a `RoadClassification`, `lanes`/`lanes:forward`/`lanes:backward` become a lane profile, and turn-restriction relations become `TurnMovement` records. Building tags become a `BuildingCategory`, while amenity/shop/leisure tags become `PoiCategory` or `AreaFeatureKind`. Unknown tags are either omitted or captured as narrowly scoped source metadata, rather than leaked as application behavior.

Road ways are grouped into logical `Street`s — by normalized name plus connectivity, with the two one-way carriageways of a divided road paired, and unnamed ways left as single-way streets — each with an id derived from its grouped ways; roads are then split at navigable endpoints and intersections. Each resulting piece becomes one or two `RoadSegment` records according to directionality and receives the best-known lane profile. At each intersection, the ingestion layer derives legal candidate movements and applies explicit source restrictions; absent restriction data is represented as unknown/default policy rather than as a fabricated prohibition. This guarantees a graph based on domain IDs, not a transient provider representation.

## Routing

`RoutingEngine` resolves each requested coordinate to the nearest valid graph node, then delegates to a `RoutingStrategy` interface:

```
findRoute(graph, originNodeId, destinationNodeId) -> RoutePath | Unreachable
```

The graph exposes both directed segments and legal transitions between an incoming and outgoing segment. Each transition is classified as left, right, straight, or U-turn and can be allowed or prohibited. Because turn legality depends on the segment a vehicle arrived on, a strategy tracks `(current node, incoming segment)` as its search state; the initial origin state has no incoming segment. The first implementation should be Dijkstra, using distance meters as its cost and rejecting prohibited transitions. A strategy registry can later add BFS, A*, or bidirectional search without changing the API, graph, or ingestion pipeline. The API accepts a strategy name and returns an application `Route`, including geometry reconstructed from the selected segments.

## API and visualization

Implemented HTTP endpoints (Milestone 7):

- `POST /import-areas` — validate a bounding box and import an OSM payload, or, with no payload,
  fetch the box live from Overpass (Milestone 9, `app/ingestion/overpass.py`); re-importing
  the same bounding box reconciles the area with the new payload rather than only upserting.
- `GET /import-areas` — every import area, most recently imported first (optional `status`, `limit`).
- `GET /import-areas/{id}` — status and entity counts, including the derived block count.
- `GET /import-areas/{id}/map-data` — every persisted entity for a completed area, as one GeoJSON
  `FeatureCollection` per layer (road segments, navigable nodes, blocks, buildings, POIs, area
  features). An optional `boundary_id` exports one traced boundary instead (Milestone 8); every
  response states its scope and mode and carries a local projection (origin plus meters per
  degree) for Cartesian renderers. `mode=filter` (default) returns whole, routable entities;
  `mode=clip` cuts geometry at the scope for rendering. It composes the completed import areas
  inside the area's rectangle (see "Nested import areas" below).
- `GET /import-areas/{id}/nearby`, `/within-bbox`, `/nearest` — spatially query supported object
  types by coordinate/radius, bounding-box intersection/containment, or nearest node/segment;
  an optional `boundary_id` narrows any of them to one traced boundary (Milestone 8).
- `GET /import-areas/{id}/buildings/{building_id}/footprint-area` — a building's footprint area in
  square meters.
- `POST /import-areas/{id}/routes` — origin, destination, an optional named strategy; returns a
  `Route` or a meaningful no-route/no-navigable-node response.
- `POST`/`GET /import-areas/{id}/boundaries`, `GET`/`DELETE /import-areas/{id}/boundaries/{boundary_id}`
  (Milestone 8) — create, list, fetch, and delete named traced boundaries, as GeoJSON features.

Every error response uses one JSON shape with a machine-readable `code` (`app/api/errors.py`).
`../HOW_TO_RUN.md` has worked curl examples.

The client (`client/`, Milestone 9) is the engine's showcase: MapLibre GL is the 2D surface for choosing a place, tracing a boundary, and importing it; Three.js renders the built world as a stylized low-poly scene from `map-data` and its local projection, and exports it as glTF. It consumes the API's representation and never re-derives the domain; scene and mesh geometry are built client-side only.

### Background imports

`POST /import-areas` with `background: true` hands the import to an in-process job registry
(`server/app/ingestion/jobs.py`): a small thread pool, one job per import area, no broker. A job
keeps an append-only list of stage events that subscribers replay and follow over server-sent events
(`GET /import-areas/{id}/events`); finished jobs stay for ten minutes. The registry holds nothing
durable, which is safe because of one rule: **a job is one transaction**. `OSMIngestionService.import_staged`
runs the same steps as the synchronous import and flushes after each stage, announcing it as it goes,
but commits only at the very end. Until then every other reader (`map-data`, the area's status) sees
the previous committed state, and a failure or a restart simply rolls everything back: the area is not
marked failed, and its data and counts stay as they were. The stages are read back through the job's own
session and mapped with the same mappers as `map-data`.

### Nested import areas

Import areas can nest. When a new import's rectangle fully covers a completed import area (an
*inner* area; one that only partly overlaps doesn't count and is imported in full), the inner area
keeps owning what it holds. The fetch is still one Overpass query for the whole rectangle, and
skipping happens at persist time (`app/domain/covered_areas.py`, used by `OSMIngestionService`):

- Buildings, POIs, and area features covered by an inner area's bounding box are not stored in the
  new area. A feature that crosses an inner edge is stored by both, and the outer copy wins on read.
- The road network is stored whole, so routing and block derivation see a connected graph and a
  route can cross an inner area.
- A block face covered by an inner area's box is not stored (the inner area holds it as a whole
  block). A face straddling an inner edge is stored, because the inner area only has it clipped.
  Block ids are assigned before those faces are dropped, so no surviving block's id changes.
- Re-importing an outer area that already holds copies of an inner area's features sweeps them,
  like any other feature the payload no longer produces.

The outer area composes its inner areas on read: `map-data` appends their buildings, POIs, area
features, and whole (unclipped) blocks that it doesn't hold itself, each feature naming its owner in
`properties.import_area_id`, and lists them in `scope.composed_area_ids`. The background import's
`fetched` event carries `inner_area_ids`, so a client can show those areas at once. An area's counts
describe only the rows it stores. No table changes: nesting is derived from the stored `bbox`es.

## Incremental delivery

1. Establish the chosen runtime, Docker Compose PostGIS service, environment sample, migrations, and bounding-box validation tests.
2. Implement domain contracts and PostGIS repositories, including streets, lane profiles, turn movements, and spatial query tests against a disposable database.
3. Build a fixture-driven OSM adapter and idempotent ingestion service; translate lane tags and turn-restriction relations into domain records.
4. Construct directed segment graphs and legal intersection transitions; implement/test Dijkstra with lane-aware and turn-aware traversal.
5. Add the API and map viewer; exercise one real imported area end to end, including a route that must respect a turn restriction.

Each stage remains runnable, covered by focused automated tests, and verified against an empty database before moving forward.

## Tradeoffs

The initial model favors a clear, controllable domain over OSM completeness. Storing both `geometry` (display/intersection operations) and calculating through `geography` (meter-accurate measurements) avoids a premature local projection while satisfying this bounded geographic scope. Lane data is advisory when the source does not specify lane-level connectivity; it must not imply turn permissions by itself. Turn restrictions are modeled as segment-to-segment transitions so they can be enforced without coupling routing to OSM relations. Detailed lane-level weaving, turn bays, traffic signals, and mode-specific access remain future extensions.
