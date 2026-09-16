# Architecture: first milestone

## Scope and assumptions

The service is limited to urban/suburban bounding boxes of up to 1 km by 1 km. It is vehicle-road routing initially; pedestrian and turn restrictions are extension work unless their OSM representation can be handled without compromising the small first release. Coordinates arrive in WGS 84 (EPSG:4326). PostGIS `geography` operations supply meter-based distance and area calculations, while `geometry` values in EPSG:4326 retain interoperable map shapes.

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
| `Road` | Named/classified source road and its source geometry. |
| `NavigableNode` | A routable coordinate; intersections are represented explicitly. |
| `RoadSegment` | Directed traversable connection, length, direction, and route metadata. |
| `Building` | Classified polygon footprint and source identity. |
| `PointOfInterest` | Categorized named/unnamed point or representative location. |
| `AreaFeature` | A small extension point for parks now and natural features later. |
| `Route` | Origin/destination, ordered nodes and segments, total distance, and cost. |

## Database model

PostgreSQL with PostGIS is the only persistence requirement. A future runtime should use migrations to create these tables:

| Table | Key fields |
| --- | --- |
| `import_areas` | UUID, provider, bbox polygon, status, imported_at |
| `roads` | UUID, import ID, provider/source ID, name, classification, line geometry, metadata |
| `navigable_nodes` | UUID, import ID, provider/source ID, point geometry |
| `road_segments` | UUID, road ID, from-node ID, to-node ID, line geometry, distance meters, allowed direction, metadata |
| `buildings` | UUID, import ID, provider/source ID, category, polygon geometry, metadata |
| `points_of_interest` | UUID, import ID, provider/source ID, category, name, point geometry, metadata |
| `area_features` | UUID, import ID, provider/source ID, kind, polygon geometry, metadata |

Use GiST indexes on spatial columns, foreign keys for graph relationships, and unique constraints on `(provider, source_id, import_area_id)` where a source ID is only unique within an import. `road_segments` are the canonical graph edges, so their explicit direction prevents routing from inferring semantics from a raw line.

## OSM translation

The adapter fetches only roads, building footprints, POIs, and relevant areas. It maps OSM values into constrained application categories: e.g. `highway=*` becomes a `RoadClassification`, building tags become a `BuildingCategory`, and amenity/shop/leisure tags become `PoiCategory` or `AreaFeatureKind`. Unknown tags are either omitted or captured as narrowly scoped source metadata, rather than leaked as application behavior.

Road ways are split at navigable endpoints and intersections. Each resulting piece becomes one or two `RoadSegment` records according to directionality. This guarantees a graph based on domain IDs, not a transient provider representation.

## Routing

`RoutingEngine` resolves each requested coordinate to the nearest valid graph node, then delegates to a `RoutingStrategy` interface:

```
findRoute(graph, originNodeId, destinationNodeId) -> RoutePath | Unreachable
```

The first implementation should be Dijkstra, using distance meters as its cost. A strategy registry can later add BFS, A*, or bidirectional search without changing the API, graph, or ingestion pipeline. The API accepts a strategy name and returns an application `Route`, including geometry reconstructed from the selected segments.

## API and visualization

Initial HTTP endpoints:

- `POST /imports` — validate a bounding box and begin/import OSM data.
- `GET /map` — normalized roads, buildings, POIs, and areas for a bounding box/import.
- `GET /nearby` — spatially query supported object types by coordinate and radius.
- `POST /routes` — origin, destination, strategy; return a `Route` or a meaningful no-route response.

A thin Leaflet/OpenLayers client can render GeoJSON emitted by the API. It remains a verification surface, not a second map-domain implementation.

## Incremental delivery

1. Establish the chosen runtime, Docker Compose PostGIS service, environment sample, migrations, and bounding-box validation tests.
2. Implement domain contracts and PostGIS repositories, including spatial query tests against a disposable database.
3. Build a fixture-driven OSM adapter and idempotent ingestion service; then enable a live provider behind the adapter.
4. Construct directed segment graphs and implement/test Dijkstra plus unreachable cases.
5. Add the small API and map viewer; exercise one real imported area end to end.

Each stage remains runnable, covered by focused automated tests, and verified against an empty database before moving forward.

## Tradeoffs

The initial model favors a clear, controllable domain over OSM completeness. Storing both `geometry` (display/intersection operations) and calculating through `geography` (meter-accurate measurements) avoids a premature local projection while satisfying this small geographic scope. Routing explicitly ignores advanced turn restrictions and mode-specific access until represented reliably; this keeps the first graph demonstrable and strategy-oriented rather than overfit to source data.
