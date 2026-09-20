# Implementation Milestones

This project is built progressively. Each milestone should leave the repository in a runnable, reviewable state before the next one begins. A milestone is complete only when its acceptance checks pass and the implementation is documented.

## Working rules

- Keep each milestone focused on one architectural capability.
- Prefer domain contracts and tests before integrations.
- Use fixtures and deterministic local data before relying on live external services.
- Run the relevant automated tests after every change.
- Do not add future-scope features to an earlier milestone merely because the infrastructure is available.
- Record important decisions and any deferred work in `docs/`.

## Milestone 0 — Repository and architecture baseline

Status: **complete**

Deliverables:

- Git repository with project documentation.
- Architecture boundaries and initial domain model.
- Environment configuration conventions.

Acceptance checks:

- A new developer can understand the scope and intended architecture from the README and architecture document.
- The working tree is clean after the baseline commit.

## Milestone 1 — Runtime, database, and geographic validation

Status: **complete**

Deliverables:

- Select and document the application runtime.
- Docker Compose PostgreSQL/PostGIS service.
- Environment-based database configuration.
- Initial migration system and extensions.
- Bounding-box value object and validation for coordinates and the 1 km × 1 km limit.
- Automated unit tests for valid, invalid, and oversized bounds.

Acceptance checks:

- A clean checkout can start PostgreSQL/PostGIS with one documented command.
- Migrations create the database from an empty volume.
- Invalid and oversized bounds return useful application errors.

Notes:

1. Change: `openspec/changes/bootstrap-python-runtime-and-db/`.
2. Verification: `docker compose up -d`, `alembic upgrade head` against a fresh volume, `pytest -q`
   (7 passed), `curl localhost:8000/health` against the running app.
3. Decisions: Python 3.12 with plain `venv`/`requirements.txt` (no Poetry/pyenv); FastAPI +
   SQLAlchemy 2.0 + GeoAlchemy2 + Alembic; local Postgres/PostGIS mapped to host port 5433 (not
   5432, which was already in use locally); bounding-box area computed via haversine-based edge
   lengths rather than a flat-earth approximation.
4. Deferred: domain persistence models/repositories, OSM ingestion, graph, routing, and real API
   endpoints — Milestones 2–7.

## Milestone 2 — Domain model and persistence schema

Status: **complete**

Deliverables:

- Domain entities for import areas, streets, roads, navigable nodes, road segments, buildings, POIs, and area features.
- A single per-segment `lane_count` on `RoadSegment` (not a `Street`-level forward/backward pair — a segment's own `from_node -> to_node` already is its direction; see `docs/schema.md`).
- Derived `Block` polygons (`ST_Polygonize` over the road graph) with an ordered `block_boundary_segments` join table, and buildings linked to their containing block by spatial containment — blocks and buildings are this project's primary focus, not the road graph itself.
- Explicit intersection turn movements linking an incoming segment to an outgoing segment, classified as left/right/straight/U-turn and carrying allowed/prohibited state and restriction kind, generated densely (one row per geometrically plausible pair at a node).
- Database tables, constraints, spatial indexes, and source identity keys.
- Repository interfaces that do not expose OSM-specific types.
- Tests for persistence, geometry validity, building area, and idempotent upserts.

Acceptance checks:

- The schema can be recreated entirely through migrations.
- A fixture dataset can be written and read through domain repositories.
- Lane counts remain unknown when absent, and turn movements enforce valid segment-to-intersection relationships (via a database trigger).
- Repeating the same write does not create duplicate source entities.
- A closed loop of road segments derives exactly one block, and a building inside it is linked to it.

Notes:

1. Change: `openspec/changes/domain-model-and-persistence-schema/`.
2. Verification: `docker compose up -d`, `alembic upgrade head` against a fresh volume, `alembic
   downgrade base` then `alembic upgrade head` again (clean round trip), `pytest -q` from `server/`
   (31 passed).
3. Decisions: recorded in `docs/schema.md` (schema) and the change's `design.md` (repository
   pattern, DB trigger for turn-movement integrity, `ST_Polygonize`-based block derivation, native
   Postgres enums). One correction made during implementation: `import_areas` identity is
   `UNIQUE (provider, min_longitude, min_latitude, max_longitude, max_latitude)`, not a `UNIQUE` on
   the `bbox` geometry column itself — PostGIS `geometry` has no btree equality operator class.
4. Deferred: OSM ingestion, graph traversal/routing, and API endpoints — Milestones 3, 5–7. When
   and how block derivation gets invoked in production (explicit step vs. automatic post-import)
   is also deferred, since neither an ingestion pipeline nor an API exists yet to wire it into.

## Milestone 3 — OSM adapter and fixture-driven ingestion

Status: **complete**

Deliverables:

- Isolated OSM response adapter/parser.
- Translation from OSM features into domain import records.
- Translation of lane tags and turn-restriction relations into lane profiles and turn movements.
- Fixture-based ingestion service for roads, buildings, POIs, and parks.
- Import reporting and meaningful malformed-data errors.

Acceptance checks:

- OSM-specific tags stop at the adapter boundary.
- A representative fixture imports into the custom schema.
- A fixture with a one-way street, lane counts, and a prohibited turn preserves those semantics after import.
- Repeating an import is safe and reports created/updated/skipped counts.

Notes:

1. Change: `openspec/changes/add-fixture-driven-osm-ingestion/`.
2. Verification: `docker compose up -d`, `alembic upgrade head` against the existing volume,
   `pytest -q` from `server/` against live PostGIS (40 passed), `openspec validate
   add-fixture-driven-osm-ingestion --strict` (valid).
3. Decisions: recorded in the change's `design.md` (provider-neutral import records, topology-then-lanes
   segment derivation, dense turn candidates with restriction resolution, transactional import with a
   separate short transaction to record a failed area). One correction made during implementation: the
   `server/tests/conftest.py` `db_session` fixture wrapped each test in a single outer transaction
   without SAVEPOINT isolation, so `OSMIngestionService`'s internal `commit()` (to make the import area
   survive a later rollback of failed child writes) and subsequent `rollback()` unintentionally undid the
   whole test transaction instead of just the failed writes, only surfacing under a live-PostGIS run.
   Fixed by binding the fixture's session with `join_transaction_mode="create_savepoint"` so nested
   application-level commits/rollbacks act on a SAVEPOINT.
4. Deferred: graph traversal/routing (Milestones 4-6), block derivation trigger timing and API
   endpoints (Milestone 7), and live Overpass/OSM network access (Milestone 9).

## Milestone 4 — Spatial query capabilities

Status: **planned**

Deliverables:

- Nearby-object queries by coordinate and radius, across the entities Milestone 2 already
  persists with point/polygon geometry: `NavigableNode`, `PointOfInterest`, `Building`,
  `AreaFeature`.
- Bounding-box intersection/containment queries against those same geometry columns plus
  `ImportArea.bbox`.
- Building footprint area calculation via PostGIS `ST_Area` — `Building.boundary` already stores
  the polygon; only the query is new.
- Nearest navigable road and node lookup, built on the `NavigableNode`/`RoadSegment` persistence
  from Milestone 2.

Acceptance checks:

- Integration tests prove meter-based distance and area behavior.
- Queries return normalized domain models (not SQLAlchemy models or raw rows).
- Empty areas and invalid query parameters produce useful errors.

## Milestone 5 — Road graph construction

Status: **planned**

Note: directed edges, per-edge traversal distance, and the legal-transition index — the things this
milestone was originally scoped to build — already exist. `RoadSegment` (Milestone 2) is a directed
edge with `from_node_id`/`to_node_id`, a `lane_count`, and a geodesic `distance_meters` computed on
every upsert; `TurnMovement` (Milestone 2) plus
`TurnMovementRepository.generate_candidates`/`legal_outgoing_segments` (Milestone 3) already form a
dense, persisted legal-transition index per intersection, populated by every import. This
milestone is now only about wrapping that already-persisted data in a traversal-ready,
provider-neutral interface for a routing engine — not re-deriving edges, distances, or transitions.

Deliverables:

- A provider-neutral `RoadGraph` interface and a graph repository that loads it from the persisted
  `road_segments` and `turn_movements` tables (via the existing repositories).
- Neighbor/edge queries usable by a routing engine without importing SQLAlchemy or OSM types,
  restricted to movements `TurnMovementRepository` marks `allowed`, and exposing the existing
  `RoadSegment.distance_meters` as edge cost.
- Tests for connectivity, one-way roads, and disconnected components, exercised through the graph
  abstraction rather than direct repository calls.

Acceptance checks:

- The graph can be built from the persisted domain model without OSM dependencies.
- Every edge has valid endpoints and exposes its persisted non-negative traversal distance.
- Connectivity tests demonstrate preserved intersections and directionality.
- Transition tests demonstrate that segments with `TurnMovement.allowed = False` are not exposed as
  legal graph moves through the abstraction.

## Milestone 6 — Routing strategy and route preparation

Status: **planned**

Deliverables:

- `RoutingStrategy` contract and `RoutingEngine` orchestration, consuming Milestone 5's `RoadGraph`
  interface only — never SQLAlchemy models or OSM types directly.
- Nearest-node preparation for origin and destination coordinates (Milestone 4's nearest-node
  lookup).
- First strategy: distance-based Dijkstra, using the existing `RoadSegment.distance_meters` as edge
  cost via Milestone 5's graph interface.
- Turn-aware search state based on the incoming segment at each intersection — the legality data
  itself (`TurnMovement.allowed`) already exists from Milestones 2–3; this milestone is the search
  algorithm that respects it during traversal, not the data.
- Route result model with ordered nodes/segments, geometry, and total distance.
- Tests for successful routes, unreachable destinations, and strategy substitution.

Acceptance checks:

- Routing code depends on the abstract graph, not on SQL or OSM.
- A known fixture produces a deterministic route.
- A route avoids a prohibited turn while retaining an allowed alternative.
- An alternate test strategy can be injected without changing `RoutingEngine`.

## Milestone 7 — Application API

Status: **planned**

Deliverables:

- Import-area endpoint, wrapping the existing `OSMIngestionService`. This is also where the open
  question from Milestones 2–3 finally gets decided: nothing currently invokes
  `BlockDerivationService` or `BuildingRepository.link_to_containing_block` after an import
  completes (both exist and are tested but unwired) — decide here whether the import endpoint
  triggers them automatically or a separate explicit step does.
- Map-data and spatial-query endpoints, wrapping Milestone 4's queries.
- Route endpoint with selectable strategy, wrapping Milestone 6's `RoutingEngine`.
- Application-level request/response models and error handling.
- API integration tests.

Acceptance checks:

- The API can import fixture data, query it, and return a route end to end.
- Responses contain normalized application models and stable error shapes.
- Database failures and disconnected routes are reported clearly.

## Milestone 8 — Custom traced import-area boundaries

Status: **planned**

An import area is a rectangle today: `import_areas` stores min/max longitude/latitude and a `bbox`
polygon, and everything imported is bounded by it. This milestone adds user-traced, arbitrarily
shaped boundaries that *narrow* an import area without replacing it, so both references stay
available and queryable side by side — the original rectangle that was imported, and the traced
shape drawn over it.

The defining constraint is that trimming is a **view, not a deletion**. A traced boundary never
removes imported entities, so the original import stays intact and any number of different cuts can
coexist over it. This also keeps derived data safe: blocks (Milestone 2) are polygonized from the
whole import area's road graph, so a boundary filters them at read time rather than forcing a
re-derivation that a later edit would invalidate.

Deliverables:

- A persisted traced-boundary entity belonging to an import area: an arbitrary (non-rectangular)
  polygon in SRID 4326, GiST-indexed like every other geometry column, with a name so several cuts
  can coexist over one import area.
- Write-time validation: the polygon must be valid and simple (closed, non-self-intersecting) and
  contained by its import area's original `bbox` — a trim narrows, never extends beyond what was
  actually imported. Decide there whether this is enforced in the application or by a database
  constraint/trigger, following the `turn_movements` integrity-trigger precedent from Milestone 2.
- Non-destructive semantics: creating, editing, or deleting a traced boundary leaves imported
  entities, their counts, and derived blocks untouched.
- A scoping dimension on the existing spatial queries, so any query can run against a traced
  boundary instead of the whole import area — this extends the `spatial-queries` capability rather
  than adding a parallel set of queries beside it.
- Endpoints (on top of Milestone 7) to create, list, fetch, and delete traced boundaries for an
  import area, and to pass one as a query scope.

Acceptance checks:

- The original rectangular `bbox` and a traced boundary for the same import area can both be read
  back, and imported entity counts are identical before and after a boundary is created or deleted.
- A spatial query scoped to a traced boundary returns only entities inside that shape, while the
  same query scoped to the import area still returns everything.
- A self-intersecting polygon, or one extending outside its import area's rectangle, is rejected
  with an actionable error.
- Several distinct traced boundaries can exist for one import area and be selected independently.

Note: the ≤ 1 km × 1 km cap applies to the imported rectangle; a traced boundary inherits it by
containment, so it needs no separate size rule.

## Milestone 9 — Minimal visualization and end-to-end demonstration

Status: **planned**

"A bounded real-world import" requires the live Overpass retrieval that Milestone 3 explicitly
deferred — fixtures alone can't demonstrate it. Confirmed against the Overpass API docs:

- Public endpoint `https://overpass-api.de/api/interpreter`; query as
  `[out:json][timeout:N]; nwr(south,west,north,east); out geom;`. The bbox order (south, west,
  north, east) already matches this project's `BoundingBox.min_corner`/`max_corner` lat/lon fields
  directly — no reordering needed to build the query.
- `out:json`'s element shape (`{"type","id","lat","lon"}` for nodes, `{"type","id","nodes","tags"}`
  for ways, `{"type","id","members","tags"}` for relations) is exactly what
  `tests/fixtures/osm_neighborhood.json` was already modeled on — a live adapter should reuse
  `OSMFixtureAdapter`'s parsing rather than duplicate it, fetching real JSON instead of reading a
  file.
- Fair-use limits apply: the public instance expects sequential (not parallel) queries per IP and
  returns HTTP 429 if a query waits >15s in its execution queue — a live fetch needs a timeout and
  backoff, unlike the fixture path.
- Real data will include turn restrictions where `via` is a way, not a node (multi-segment
  intersections) — `OSMIngestionService` only resolves a single via-*node* today, so a real import
  is more likely than the fixture to hit the "restriction cannot resolve" error path. That's
  correct, existing behavior (Milestone 3's spec requires failing unresolvable restrictions), not a
  bug to fix reactively — just don't be surprised by it when picking a real bounding box to demo.

Deliverables:

- A live Overpass adapter for a bounded (≤ 1 km × 1 km) area, reusing the existing OSM parsing
  above the fetch boundary.
- Lightweight web map client.
- Rendering of roads, buildings, POIs, and route geometry.
- A boundary tracing tool: draw an arbitrary, non-rectangular shape over the loaded import area by
  placing vertices (and/or freehand tracing), close it, and save it through Milestone 8's
  endpoints.
- Simultaneous, visually distinct rendering of both references — the original rectangular import
  area and any saved traced boundaries — with a control to switch what is queried and displayed
  between the whole import area and a selected traced boundary.
- Reloading, re-selecting, and deleting previously saved traced boundaries across sessions.
- Documented walkthrough using a bounded real-world import.
- Operational runbook for starting services, migrating, importing, querying, and routing.

Acceptance checks:

- A developer can follow the runbook from a clean checkout.
- The map visibly demonstrates that imported data is served from the custom representation.
- A route from Point A to Point B can be selected and displayed.
- A non-rectangular shape can be traced over an imported rectangle, saved, and still be present
  with the original rectangle after a page reload.
- Switching the view to a traced boundary visibly narrows the rendered data, while switching back
  to the import area restores the full set — demonstrating the trim is a view, not a deletion.

## Milestone completion record

When completing a milestone, update its status and add a short note containing:

1. Commit or pull request reference.
2. Tests and verification commands run.
3. Important decisions or limitations.
4. Deferred work for a later milestone.
