## Context

See `proposal.md` for motivation. The pieces being exposed already exist and are tested in
isolation:

- `OSMIngestionService.import_fixture(bbox, payload, provider)` commits the import area first (so
  a failure can be recorded), then parses, persists, and marks it `completed` in a second commit;
  any exception rolls back child writes, marks the area `failed`, and is re-raised as
  `OSMIngestionError` — including non-parse failures such as database errors, which are wrapped
  with the original as `__cause__`. The initial `get_or_create` + commit sits *outside* that
  `try`, so a failure there (connection loss, or a unique violation when two requests create the
  same area concurrently) escapes unwrapped.
- **Re-import only ever upserts.** No repository deletes anything. Re-importing a bounding box
  with a payload that drops a building and a road leaves both in the database (checked against
  live PostGIS: the import reported 0 buildings / 2 roads, the database still held 1 / 3, and the
  dropped road's segments stayed routable). `mark_completed` records `len(records.*)`, so the
  recorded counts and the stored rows disagree after such a re-import.
- Every foreign key is `NO ACTION` (no cascades), so any deletion must remove children first.
- Turn candidates are regenerated as allowed on every import and overwrite the persisted rows
  before restrictions are re-applied, so a restriction dropped from the payload already reverts to
  allowed. What is missing is removal of rows that reference segments which no longer exist.
- Nothing checks that a payload's features lie inside the declared bounding box. The 1 km² cap
  constrains the *declared* box, not the data.
- `SpatialQueryService` raises `UnknownImportArea` (unknown area, *or* a building not in that
  area) and `InvalidSpatialQuery` (non-positive radius); "no match" is a normal empty/None return.
  It checks only that the area exists, not its status. `nearest_node` has no distance limit.
- `RoutingEngine(session, strategy).plan_route(area_id, origin, destination)` raises
  `NoNavigableNodeError` / `NoRouteFoundError`. When origin and destination snap to the same node,
  `DistanceDijkstraStrategy` returns a route with empty geometry.
- `BlockDerivationService.derive_for_import_area` is **append-only**: every call inserts a fresh
  set of blocks. `BuildingRepository.link_to_containing_block` sets `block_id` where a block
  contains the building but never clears stale links. Neither is called outside tests.
- Segment ids are stable across re-imports of an unchanged way: segments upsert on
  `(road_id, from_node_id, to_node_id)`.
- `Coordinate`/`BoundingBox` raise `InvalidBoundingBox` on out-of-range or oversize input —
  including for a single point, which is why the API maps point errors separately (Decision 2).
- `server/app/main.py` has only `/health`, which builds a fresh engine per call and returns
  FastAPI's default `{"detail": ...}` errors. There is no session dependency and no `httpx`, so
  `TestClient` cannot run yet.
- Neither fixture has a building inside a road loop: `osm_neighborhood.json` is a star (no loop),
  and `osm_routing.json` has one loop (2-4-5-3) with no building in it.

## Goals / Non-Goals

**Goals:**
- A thin HTTP layer: routers translate request models → domain values → existing services →
  response models. No SQL in `app/api/`.
- One place that maps domain/service exceptions to the error contract.
- A re-import leaves the area's stored entities exactly equal to what the new payload produces
  (reconcile), with blocks derived from that reconciled network.
- API tests that share the existing per-test savepoint-isolated session, so they stay as fast and
  hermetic as the persistence tests.

**Non-Goals:**
- Async ingestion, background jobs, or pagination — the 1 km² cap on the declared box, plus the
  payload guards that tie every feature to that box and bound the body size (Decision 3), keep
  every area small enough to import and return in one synchronous request.
- Authentication, rate limiting, CORS configuration (Milestone 9 can add CORS when a client
  exists).
- Fetching live OSM data, and guarding against truncated live responses — the import body still
  carries the fixture payload (Milestone 9).
- Versioned import snapshots or history: an import area holds one current state.
- Street grouping, lanes, and street width (Milestone 7.1); buildable blocks, edge blocks, and
  stable block ids (Milestone 7.2).
- Fixing the adapter's lane-count split (`lanes=N` is applied to *each* direction of a two-way
  road): a separate `osm-fixture-ingestion` fix, recorded in `MILESTONES.md`.
- GeoJSON export with scope/clip modes (Milestone 8), new routing strategies or cost models.

## Decisions

### 1. Import is reconcile-then-derive, in one transaction

`OSMIngestionService._persist` becomes a fixed sequence inside the transaction the service
already commits or rolls back:

```
1. upsert nodes, streets, roads, segments, buildings, POIs, area features   (mark)
     every upsert already returns the row id → collect a "touched" id set per table
2. reset derived block data: clear buildings.block_id, delete the area's
     block_boundary_segments, then its blocks
3. delete turn_movements whose incoming or outgoing segment is untouched
4. sweep untouched rows, children first:
     road_segments → roads → streets → navigable_nodes; buildings, POIs, area features
5. generate turn candidates and apply restrictions   (existing step, moved after the sweep)
6. derive blocks and link buildings                  (BlockDerivationService)
7. mark_completed with counts read from the database
```

Mark-and-sweep on returned ids works for every table regardless of its key — segments have no
`source_id`, only `(road_id, from_node_id, to_node_id)` — and reuses ids the upserts already
return. Unchanged entities keep their ids; entities the payload no longer produces are deleted.

The ordering is forced: block rows reference segments, so step 2 precedes step 4; turn
generation and derivation run after the sweep so no turn or block is ever built from a segment
that is about to disappear. Steps 2 and 6 together are `BlockDerivationService.rederive_for_import_area`,
so the planned "replace, not append" behaviour falls out of the same step rather than being a
second mechanism.

`mark_completed` records `COUNT(*)` per table for the area instead of `len(records.*)`, so the
recorded counts always equal what map data returns. `ImportResult` gains `block_count` and
`linked_building_count`.

*Why reconcile:* the project's goal is its own current representation of an area; OSM data
changes, and Milestone 11 already assumes a re-import that changes the road graph is a
first-class event. Merge-only silently drifts (stale roads stay routable, stale segments feed
block derivation). Versioned snapshots would give history nobody has asked for at the cost of
scoping every query by run.

*Why derivation runs inside the import:* an import that leaves blocks absent until someone
remembers a second call makes `completed` misleading. Inside the transaction, `completed` implies
"blocks are current", and a derivation failure takes the existing failure path (rollback, mark
`failed`, raise) for free. Alternatives rejected: a separate `POST /import-areas/{id}/blocks`
step (two-step consistency the client must remember); deriving in a separate transaction (a
derivation failure would leave a `completed` area with no blocks).

*Consequence — a failed re-import:* rollback restores the previous data, but the area is marked
`failed`, so its data answers `import_area_not_ready` until a later import succeeds. This is
intended: `status` describes the last import attempt, and serving data the client just failed to
replace would hide that failure.

*Consequence — tests:* existing `derive_for_import_area` tests keep calling it directly. The
ingestion tests gain a changed-payload re-import (drop a building and a road: both disappear, a
route over the dropped road fails, the remaining restriction still holds) and a closed-loop
fixture with a building inside it.

### 2. Error handling: exception handlers, not per-route try/except

`app/api/errors.py` defines an `ApiError(status, code, message, details=None)` exception and
registers handlers on the app:

| Source | Status | Code |
|---|---|---|
| `RequestValidationError` (FastAPI) | 422 | `invalid_request` (`details.fields` from pydantic errors) |
| Starlette 404/405 | 404/405 | `not_found` / `method_not_allowed` |
| Request body over the size limit (Decision 3) | 413 | `payload_too_large` |
| `InvalidBoundingBox` from a bounding-box parameter | 422 | `invalid_bounding_box` |
| `InvalidBoundingBox` from a single-point parameter (router re-raises) | 422 | `invalid_coordinate` |
| `InvalidSpatialQuery` | 422 | `invalid_spatial_query` |
| `PayloadOutsideBoundingBox` (Decision 3) | 422 | `payload_outside_bounding_box` |
| `OSMIngestionError` whose cause chain contains `sqlalchemy.exc.OperationalError`/`InterfaceError` | 503 | `database_unavailable` |
| other `OSMIngestionError` | 422 | `ingestion_failed` |
| `IntegrityError` while creating the import area (router catches) | 409 | `import_conflict` |
| `NoNavigableNodeError` / `NoRouteFoundError` | 422 | `no_navigable_node` / `no_route_found` |
| `sqlalchemy.exc.OperationalError` / `InterfaceError` | 503 | `database_unavailable` |
| `MissingEnvironmentVariable` | 500 | `configuration_error` |
| anything else | 500 | `internal_error` (generic message, exception logged server-side) |

`import_area_not_found` (404), `import_area_not_ready` (409), `building_not_found` (404),
`unknown_routing_strategy` (422), `invalid_coordinate`, and `import_conflict` are raised as
`ApiError` by routers or dependencies, because the router knows what it asked about:
`UnknownImportArea` covers both "area" and "building" misses, `InvalidBoundingBox` covers both a
box and a point, and an `IntegrityError` is only a conflict when it comes from the area-creation
step (anywhere else it is a bug and stays `internal_error`).

*Why 422 for no-route:* the area and endpoints exist; the request is well-formed but
unsatisfiable. 404 would suggest a missing resource.

*Why unwrap the ingestion cause:* the service wraps database failures in `OSMIngestionError`,
which would otherwise surface a connection outage as a client-side `ingestion_failed`. Inspecting
`__cause__` at the API boundary fixes the reporting without changing the service's contract.

### 3. Payload guards at the trust boundary

`POST /import-areas` is the first place untrusted data enters, so two guards bound it:

- **Body size.** A small middleware rejects a request whose `Content-Length` exceeds a limit
  (16 MiB, a module constant) with `payload_too_large` before the body is parsed.
- **Features must belong to the declared box.** After parsing, the ingestion service checks each
  record against the import bounding box: a road, building, or area feature whose coordinate
  envelope does not intersect the box, or a POI outside it, raises `PayloadOutsideBoundingBox`
  (a subclass of `IngestionError`, listing up to ten offending source ids). Intersection, not
  containment, because real ways legitimately cross the box edge.

The check is an envelope test in plain Python over coordinates the adapter already produced — no
database round trip. Because it runs inside the import's `try`, a rejected payload takes the
normal failure path and marks the area `failed`.

The request body has no `provider` field: only the OSM adapter exists, and a free-form provider
string would silently fork import-area identity. The router always passes `osm`.

### 4. Area readiness is checked once, in a shared dependency

A `completed_import_area(id, session)` dependency loads the area through a new
`ImportAreaRepository.get(id)` and raises `import_area_not_found` / `import_area_not_ready`.
Every spatial, map-data, and route endpoint depends on it. `GET /import-areas/{id}` uses the
non-strict variant (exists only), since reading a failed area's status is legitimate.

### 5. Session lifecycle: a dependency over a lazily-built engine

`app/api/dependencies.py` exposes `get_session()`, which yields a `Session` from a module-level
`sessionmaker` bound to an engine created on first use from `load_settings()`. `/health` depends
on `get_session` and runs `SELECT 1` through it, instead of building an engine per request — so
overriding `get_session` in a test fails `/health` the same way it fails every data endpoint.
Tests override `get_session` with the existing `db_session` fixture via
`app.dependency_overrides`, so API tests get the same savepoint isolation — the ingestion
service's own commit/rollback calls still behave as they do in production.

*Alternative:* FastAPI lifespan-created engine on `app.state` (rejected for now: it forces
`DATABASE_URL` at app construction, which breaks importing `app.main` without a database, and
buys nothing at this size).

### 6. Wire models: pydantic models, GeoJSON FeatureCollections

`app/api/schemas.py` holds pydantic models only; converters in `app/api/mappers.py` turn domain
dataclasses into them. Domain objects are never returned directly, which keeps `app/domain/`
free of pydantic.

- **Input** coordinates are `{latitude, longitude}` objects (matching the domain's `Coordinate`
  and avoiding axis-order ambiguity).
- **Map data** returns one GeoJSON `FeatureCollection` per layer (`road_segments`,
  `navigable_nodes`, `blocks`, `buildings`, `pois`, `area_features`), each feature carrying
  `id` and its attributes in `properties`, with `[lon, lat]` positions. A map library can load
  each layer directly, and Milestone 8's export adds scope and clip modes to the same shape
  rather than introducing a second one.
- **Road segments** carry `from_node_id`, `to_node_id`, `distance_meters`, `lane_count`,
  `is_vehicle_accessible`, and `street: {name, classification}` as *values*. No `street_id` is
  exposed: a street is one OSM way today, and Milestone 7.1 will group ways into logical
  streets, so a street id published now would be a contract that breaks.
- **Attribution**: the map-data response carries `attribution: "© OpenStreetMap contributors"`
  (ODbL requires it for data derived from OSM).
- **Spatial-query results** use the same feature shape as the matching map-data layer.
- **Routes** return `geometry` as a GeoJSON `LineString`, or `null` when origin and destination
  snap to the same node (a zero-position `LineString` is not valid GeoJSON; distance is then 0).
  They also return the snapped node ids and `origin_snap_distance_meters` /
  `destination_snap_distance_meters`, so a client can see when a coordinate was far from the
  network. There is no snap-distance limit.

Pydantic validates shape and types only; range/area rules stay in the domain `BoundingBox`, so the
1 km² rule has exactly one implementation. That rule also applies to the `within-bbox` query box —
intended: a query never needs to be larger than the area it queries.

### 7. Strategy registry

`app/routing/strategies.py` (or a dict in the router module) maps names to factories:
`{"distance": DistanceDijkstraStrategy}`. The route endpoint looks the name up and passes the
instance to `RoutingEngine(session, strategy)`. Adding a strategy is a one-line registration.

### 8. Map data read paths

New `list_for_import_area` methods on the building, POI, area-feature, block, and navigable-node
repositories, each one bulk query returning domain objects. Road segments already have one; the
map-data read joins `roads` and `streets` in the same query to fetch each segment's street name and
classification. `BlockRepository.list_for_import_area` loads boundary-segment ids in a single extra
query rather than one per block. Block count for `GET /import-areas/{id}` is a `COUNT` — no new
column, no migration.

### 9. Endpoint surface

```
GET  /health
POST /import-areas                                   body: {bbox, payload}
GET  /import-areas/{id}
GET  /import-areas/{id}/map-data
GET  /import-areas/{id}/nearby?latitude&longitude&radius_meters&kind
GET  /import-areas/{id}/within-bbox?min_latitude&min_longitude&max_latitude&max_longitude&kind&mode
GET  /import-areas/{id}/nearest?latitude&longitude&kind
GET  /import-areas/{id}/buildings/{building_id}/footprint-area
POST /import-areas/{id}/routes                       body: {origin, destination, strategy?}
```

`kind`/`mode` are string enums validated by pydantic (`invalid_request` on a bad value).
`POST /import-areas` always returns 200 — the ingestion service does not report whether the area
was new, and re-import is an expected use.

## Risks / Trade-offs

- [Reconcile makes a truncated payload destructive: data the payload omits is deleted] → Harmless
  with fixtures. Milestone 9's live adapter must reject incomplete responses before they reach
  ingestion; recorded there.
- [Re-import deletes and recreates blocks, so block ids change on every import] → Nothing
  references a block id except buildings, which are relinked in the same transaction. Milestone 7.2
  derives block ids from their bounding segments so unchanged blocks keep their ids before
  Milestone 11 attaches generated content to them.
- [A failed re-import hides intact previous data behind `import_area_not_ready`] → Intended
  (Decision 1); documented in the API spec.
- [The payload guard uses coordinate envelopes, so a diagonal way whose envelope touches the box
  corner passes] → Acceptable: the guard exists to reject unrelated data, not to clip it.
- [Derivation adds time to every import] → Bounded by the 1 km² cap; `ST_Polygonize` over a
  neighborhood's segments is milliseconds.
- [A fixture's road loops may not be what a reader expects] → Tests assert the derived result for
  each fixture explicitly rather than assuming.
- [Unwrapping `__cause__` for database errors relies on the service keeping `raise ... from
  error`] → Covered by an API test that forces a connection failure during import.
- [Synchronous import holds a request open for the whole ingestion] → Acceptable at fixture scale;
  async ingestion is out of scope.

## Migration Plan

No schema migration. Deploy is the code change plus `pip install -r requirements.txt` for `httpx`.
Import areas created before this change have no blocks, and may hold stale rows from earlier
merge-only re-imports, until they are re-imported — which now reconciles and derives them.
