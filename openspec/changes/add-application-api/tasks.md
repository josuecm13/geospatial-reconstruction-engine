## 1. Setup

- [x] 1.1 Add pinned `httpx` and `pydantic` to `server/requirements.txt` and confirm `from fastapi.testclient import TestClient` imports in the venv
- [x] 1.2 Create `server/tests/api/` with a `client` fixture that overrides `get_session` with the existing `db_session` fixture

## 2. Reconciling import

- [x] 2.1 Collect the ids returned by every upsert in `OSMIngestionService._persist` into a per-table "touched" set
- [x] 2.2 Add the sweep, children first: turn movements referencing untouched segments, then untouched road segments → roads → streets → navigable nodes, and untouched buildings, POIs, area features (all scoped to the area)
- [x] 2.3 Reorder `_persist`: upserts → block reset (3.1) → sweep → turn generation and restrictions → block derivation → `mark_completed`
- [x] 2.4 Make `mark_completed` record `COUNT(*)` per table for the area instead of `len(records.*)`
- [x] 2.5 Tests: identical re-import keeps every entity id; a re-import that drops building 200 and way 101 removes both plus 101's segments and turn movements, lowers the recorded counts to match the stored rows, and makes a route over 101 fail; a re-import that drops a restriction relation leaves that movement allowed; a failed re-import leaves the previous rows intact and the area `failed`
- [x] 2.6 Mutation-check the sweep: skip it, confirm the dropped-entities test goes red, then restore it and confirm green

## 3. Block derivation inside import

- [x] 3.1 Add `BlockDerivationService.rederive_for_import_area(id)`: clear the area's `buildings.block_id`, delete its `block_boundary_segments` and `blocks` (the reset step, run before the sweep), then after the sweep and turns derive and link; return blocks and linked-building count
- [x] 3.2 Add `block_count` and `linked_building_count` to `ImportResult`
- [x] 3.3 Add a small closed-loop fixture with a building inside the loop (neither existing fixture has one: `osm_neighborhood.json` has no loop, `osm_routing.json`'s loop 2-4-5-3 contains no building)
- [x] 3.4 Tests: import derives blocks and links buildings with no separate call; a no-loop import yields zero blocks and unset links; importing twice leaves the block count unchanged and no stale links; a re-import missing one loop road removes that block and unsets the building's link; re-deriving one area leaves another area's blocks and links untouched
- [x] 3.5 Tests: a derivation failure during import marks the area `failed` and leaves no partial blocks
- [x] 3.6 Mutation-check the duplicate guard: skip the block delete, confirm the re-import test goes red, then restore it and confirm green

## 4. Payload guard

- [x] 4.1 Add `PayloadOutsideBoundingBox(IngestionError)` and an envelope check in the ingestion service after parsing: roads, buildings, and area features must intersect the import bbox, POIs must lie inside it; the error lists up to ten offending source ids
- [x] 4.2 Tests: a road crossing the bbox edge is accepted; a building entirely outside fails the import, names its source id, and marks the area `failed`
- [x] 4.3 Mutation-check the guard: disable the check, confirm the outside-building test goes red, then restore it and confirm green

## 5. Read paths for map data

- [x] 5.1 Add `ImportAreaRepository.get(id)` and a block-count query for an area
- [x] 5.2 Add `list_for_import_area` to the building, POI, area-feature, navigable-node, and block repositories (blocks load boundary-segment ids in one extra query, not one per block), and a segment read that joins `roads` and `streets` for each segment's street name and classification
- [x] 5.3 Repository tests for each list method, including area scoping (another area's rows are excluded)

## 6. API foundation

- [x] 6.1 `app/api/dependencies.py`: lazily-built engine and `sessionmaker`, `get_session`, plus `import_area` (exists) and `completed_import_area` (exists and `completed`) dependencies
- [x] 6.2 `app/api/errors.py`: `ApiError` and the exception handlers from design Decision 2, including validation errors, 404/405, `payload_outside_bounding_box`, database unavailability (and unwrapping it from `OSMIngestionError`), and the generic `internal_error`
- [x] 6.3 Body-size middleware rejecting a `Content-Length` over 16 MiB with `payload_too_large` before parsing
- [x] 6.4 `app/api/schemas.py` (pydantic request/response models, GeoJSON features and per-layer FeatureCollections) and `app/api/mappers.py` (domain → response, including null route geometry for a single-node route and snap distances)
- [x] 6.5 Rework `/health` to depend on `get_session` and the error contract; wire routers, handlers, and the middleware in `create_app()`

## 7. Endpoints

- [x] 7.1 `POST /import-areas` (body `{bbox, payload}`, provider fixed to `osm`, `IntegrityError` from area creation → `import_conflict`) and `GET /import-areas/{id}`
- [x] 7.2 `GET /import-areas/{id}/map-data` with one FeatureCollection per layer and the OSM attribution string
- [x] 7.3 `GET /import-areas/{id}/nearby`, `/within-bbox`, `/nearest`, and `/buildings/{building_id}/footprint-area`, re-raising a point's `InvalidBoundingBox` as `invalid_coordinate`
- [x] 7.4 Strategy registry (`distance` → `DistanceDijkstraStrategy`) and `POST /import-areas/{id}/routes`, reporting snapped node ids and snap distances

## 8. API integration tests

- [x] 8.1 Import: success counts including blocks, idempotent re-import, changed-payload re-import lowering counts, `invalid_bounding_box` (with no area created), `ingestion_failed` with the area marked `failed`, `payload_outside_bounding_box`, `payload_too_large` (no area created), `import_conflict` (area creation forced to raise `IntegrityError`)
- [x] 8.2 Import-area read and map data: status and counts, `import_area_not_found`, `import_area_not_ready` for a failed area, layer counts equal recorded counts, buildings referencing their block id, segments carrying street name and classification with no street id, GeoJSON `[lon, lat]` ordering, attribution present, no raw OSM tags in the response
- [x] 8.3 Spatial queries: radius hit and empty result, non-positive radius, `invalid_coordinate`, `contains` vs `intersects`, oversized query bbox, nearest node, null nearest in an area with no road data, footprint area, `building_not_found`
- [x] 8.4 Routes: end-to-end import → route over HTTP, deterministic repeat, prohibited turn avoided, default strategy reported, snap distances, same-node route with null geometry and zero distance, `invalid_coordinate`, `unknown_routing_strategy` with registered names, `no_route_found`, `no_navigable_node`
- [x] 8.5 Error contract: `invalid_request` with field details, unknown path → `not_found`, `database_unavailable` for a query and for `/health` (session dependency overridden to a failing engine), `internal_error` without exception text, an `IntegrityError` outside area creation → `internal_error`
- [x] 8.6 Mutation-check the error contract: map one handled exception to the default handler, confirm its test goes red, then restore and confirm green; do the same for the readiness check (let a `failed` area through)

## 9. Verification and docs

- [ ] 9.1 `pytest -q` from `server/` against live PostGIS, all green
- [ ] 9.2 `openspec validate add-application-api --strict`
- [ ] 9.3 Manual smoke test: `uvicorn` on `APP_PORT`, import `osm_routing.json` with curl, request a route
- [ ] 9.4 `HOW_TO_RUN.md`: short "calling the API" section with the curl import and route examples
- [ ] 9.5 `docs/architecture.md`: replace the initial endpoint list with the implemented surface; `docs/schema.md`: resolve the derivation-timing open question (automatic, inside the import, after reconciliation)
- [ ] 9.6 `MILESTONES.md`: mark Milestone 7 complete with the completion-record note (change, verification, decisions — reconcile on re-import, automatic derivation, replace-on-rederive, payload guards — and deferred work)
