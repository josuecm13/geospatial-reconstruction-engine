## Why

Milestones 1–6 built ingestion, spatial queries, block derivation, and routing, but the only way to
reach any of them is from Python: the HTTP layer is a single `/health` route. Milestone 9's viewer
(and anyone exercising the engine end to end) needs a stable HTTP contract, and Milestones 2–3
left an open question this is the natural place to close: nothing runs block derivation or
building-to-block linking after an import, so an imported area never has blocks unless a test
calls those services by hand.

Exposing import over HTTP also exposes two gaps in ingestion that no caller has hit yet. Re-import
only ever upserts, so a payload that drops a road or building leaves the old row in place —
still routable and still feeding block derivation. And nothing ties a payload to the bounding box
it is imported under. An HTTP endpoint that accepts arbitrary payloads makes both reachable.

## What Changes

- **Import-area endpoints**: import a fixture payload for a bounding box, read an import area's
  status and counts, and read its full map data (road segments with their street name and
  classification, navigable nodes, blocks, buildings with their block link, POIs, area features)
  as one GeoJSON `FeatureCollection` per layer, with OSM attribution.
- **Re-import reconciles.** An import leaves the area's stored entities exactly equal to what the
  payload produces: entities the payload no longer contains are deleted, unchanged ones keep their
  ids, and recorded counts are read from the database.
- **Blocks are derived as part of every import.** After reconciliation, the area's blocks are
  derived and its buildings linked to their containing block in the same unit of work;
  re-importing replaces blocks rather than appending duplicates. An import area is only reported
  `completed` once its blocks exist.
- **Payload guards**: a request body size limit, and a rule that every imported feature must
  intersect the declared bounding box.
- **Spatial-query endpoints** wrapping Milestone 4: nearby entities by coordinate and radius,
  bounding-box intersection/containment, nearest node/segment, and building footprint area.
- **Route endpoint** wrapping Milestone 6's routing engine, with a named, selectable strategy
  (`distance` is the only one today), a clear rejection of unknown strategy names, snap distances
  for origin and destination, and a defined response when both snap to the same node.
- **Stable error contract**: every error response, including request-validation failures, uses one
  JSON shape with a machine-readable code; bad input, oversized or out-of-area payloads, unknown
  resources, areas that are not ready, concurrent import conflicts, unroutable requests, and
  database unavailability are distinguished by status and code.
- API integration tests driving the whole flow (import → query → route) over HTTP against PostGIS.

## Capabilities

### New Capabilities
- `import-area-api`: HTTP import of fixture data for a bounding box, import-area status/count
  lookup, and whole-area map-data retrieval.
- `spatial-query-api`: HTTP exposure of radius, bounding-box, nearest, and footprint-area queries
  scoped to one import area.
- `route-api`: HTTP route planning between two coordinates in an import area with a selectable,
  named routing strategy.
- `api-error-contract`: the single error response shape and the status/code mapping for every
  failure class the API reports.

### Modified Capabilities
- `osm-fixture-ingestion`: re-import changes from upsert-only to reconcile (entities the payload
  no longer produces are removed; counts come from stored rows), and imported features must
  intersect the import area's bounding box.
- `block-derivation`: adds the requirement that derivation and building linking run as part of
  every successful import, after reconciliation, and that re-deriving an area replaces its blocks
  instead of duplicating them (today derivation is append-only and never invoked outside tests).

## Impact

- **Code**: new `server/app/api/` routers, request/response models, error handlers, a body-size
  middleware, and a session dependency; `server/app/main.py` wires them in.
  `OSMIngestionService._persist` becomes mark → reset blocks → sweep → turns → derive → complete,
  plus the bounding-box guard. New read-only list methods on the building, POI, area-feature,
  block, and navigable-node repositories for map data. `BlockDerivationService` clears an area's
  existing blocks before deriving.
- **Dependencies**: `httpx` added to `server/requirements.txt` (required by FastAPI's
  `TestClient`), and `pydantic` pinned alongside it.
- **Schema**: no migration — block and building-link tables already exist, and reconciliation only
  deletes rows.
- **Docs**: `MILESTONES.md` Milestone 7 status and completion note; `HOW_TO_RUN.md` gains a short
  "calling the API" section; `docs/architecture.md`'s endpoint list and `docs/schema.md`'s open
  question on derivation timing are updated to match.
- **Out of scope, recorded in `MILESTONES.md`**: street grouping and generated lane
  cross-sections (7.1); buildable blocks, edge blocks, stable block ids (7.2); live Overpass
  retrieval and truncated-response guarding (9); the adapter's lane-count split and a
  missing-node error path (separate `osm-fixture-ingestion` fixes).
