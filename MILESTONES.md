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

Status: **complete**

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

Notes:

1. Change: `openspec/changes/add-spatial-queries-road-graph-and-routing/` (covers Milestones 4-6).
2. Verification: `pytest -q` from `server/` against live PostGIS (79 passed), `openspec validate
   add-spatial-queries-road-graph-and-routing --strict` (valid).
3. Decisions: recorded in the change's `design.md` — meter-based predicates via `::geography` casts
   (SRID 4326 measures in degrees otherwise), accepting sequential scans under the 1 km² cap rather
   than adding indexes; "no match" (empty radius result, absent nearest candidate) is a normal
   return value, while "bad request" (unknown import area, non-positive radius) raises.
4. Deferred: HTTP exposure (Milestone 7).

## Milestone 5 — Road graph construction

Status: **complete**

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

Notes:

1. Change: `openspec/changes/add-spatial-queries-road-graph-and-routing/`.
2. Verification: `pytest -q` from `server/` against live PostGIS (79 passed), including
   `tests/domain/test_purity.py` asserting the graph and routing domain modules import neither
   SQLAlchemy nor `app.persistence`.
3. Decisions: `RoadGraph`/`GraphEdge` live in `app/domain/graph.py` (pure); the loader lives in
   `app/persistence/graph_loader.py` and does exactly two bulk queries — one for segments, one for
   turn movements — never a lookup per node or edge.
4. Deferred: HTTP exposure (Milestone 7).

## Milestone 6 — Routing strategy and route preparation

Status: **complete**

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

Notes:

1. Change: `openspec/changes/add-spatial-queries-road-graph-and-routing/`.
2. Verification: `pytest -q` from `server/` against live PostGIS (79 passed), including a
   routing-specific fixture (`tests/fixtures/osm_routing.json`) imported through
   `OSMIngestionService`, covering a shorter-route choice, a restriction forcing a detour, an
   all-prohibited destination, a disconnected destination, and strategy substitution.
3. Decisions: search state is keyed on the traversed segment (not the node), since turn legality
   depends on the approach; ties break on edge id, not push order or iteration order, so repeated
   identical requests are deterministic.
4. Correction made during implementation: `OSMIngestionService._persist_turns` re-derived fresh,
   default-allowed turn candidates (`generate_candidates`) for every restriction relation at a node,
   so a second restriction at the same intersection silently reset an earlier one back to allowed —
   only surfaced by a test needing two restrictions at one node (an all-prohibited intersection).
   Fixed by reading the currently persisted state (new `TurnMovementRepository.list_for_intersection`)
   instead of regenerating defaults; this is a Milestone 3 (`osm-fixture-ingestion`) correctness fix,
   not new Milestone 6 behavior.
5. Deferred: HTTP exposure (Milestone 7); alternative cost models (Milestone 6's non-goals).

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
- GeoJSON export of a scope — either the whole import area or one traced boundary — covering roads
  (with their lane counts), buildings, POIs, and area features. `shapely`'s `mapping()` and PostGIS
  `ST_AsGeoJSON` are already available, so this needs no new dependency.
- Two explicit export modes, because they serve different consumers and are not interchangeable:
  - **filter** — entities intersecting the scope are returned whole, so geometry may extend past
    the traced edge. The network stays coherent: segments still end at real navigable nodes and
    turn movements still resolve, so the result remains routable.
  - **clip** — geometry is cut at the boundary (`ST_Intersection`), matching the traced shape
    exactly. This is the right mode for rendering and the wrong one for analysis: a clipped
    segment no longer terminates at a navigable node and its `distance_meters` no longer matches
    its geometry, so a clipped export is a picture, not a routable dataset.
- Local projection metadata on the export (an origin coordinate plus meters-per-degree factors) so
  a Cartesian renderer can place the data in meters without reprojecting. Degrees are not uniform,
  and a renderer given raw lat/lon draws a stretched scene.

Note: rendering buildings with height is not possible from what is currently ingested. `Building`
carries no height and the OSM adapter captures no `height` or `building:levels` tags, so an export
can only describe footprints. Adding height is an *ingestion and schema* change to the
`osm-fixture-ingestion` capability, not an export change, and belongs in its own change rather than
being smuggled into this one.

Acceptance checks:

- The original rectangular `bbox` and a traced boundary for the same import area can both be read
  back, and imported entity counts are identical before and after a boundary is created or deleted.
- A spatial query scoped to a traced boundary returns only entities inside that shape, while the
  same query scoped to the import area still returns everything.
- A self-intersecting polygon, or one extending outside its import area's rectangle, is rejected
  with an actionable error.
- Several distinct traced boundaries can exist for one import area and be selected independently.
- Exporting one scope in both modes differs as specified: filter mode yields geometry extending
  beyond the traced edge, clip mode yields geometry contained by it.
- An export states its scope, its mode, and its projection origin, and an export of the whole
  import area matches an export of a traced boundary covering the entire rectangle.

Notes:

- The ≤ 1 km × 1 km cap applies to the imported rectangle; a traced boundary inherits it by
  containment, so it needs no separate size rule.
- Mesh formats (glTF) and terrain elevation stay out of scope. Triangulation, extrusion, materials,
  and level of detail are rendering decisions that belong in the client — a Three.js consumer can
  extrude footprints itself, and baking meshes server-side would freeze those choices in the
  backend and add a heavyweight dependency for one consumer.

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

## The raw layer and the content layer

Milestones 10–12 extend the project from reconstructing a map to *enhancing* one: filling
under-mapped blocks with plausible buildings, inferring heights, and attaching renderable asset
identities, so a real city segment can be exported as a populated, renderable map.

One rule governs all of it: **the raw layer is never written to by generation.** Everything OSM
observed stays exactly as ingested, in the tables it already lives in; everything invented lives in
its own tables and can be deleted and regenerated without touching a single observed row. Two
concrete reasons, not just tidiness:

- `buildings.source_id` is `NOT NULL` under `UNIQUE (import_area_id, source_id)`, and ingestion
  upserts on exactly that key. A synthetic building placed in that table would need a fabricated
  source identity, and would sit in the path of the re-import convergence guarantee Milestone 3
  spec'd.
- Keeping them apart preserves the same "both references" property as traced boundaries: the
  observed city and the populated city remain separately queryable and separately exportable.

`blocks` is the existing precedent — `BlockDerivationService` already persists entities that have
no source, because "a block only exists because the enclosing road segments do."

## Milestone 10 — Building attributes from source

Status: **planned**

This completes the *raw* layer rather than starting the generated one: `height` and
`building:levels` are observations OSM carries and this project currently discards. `Building` has
no height field and the adapter reads no height tags, so nothing downstream can render a skyline
from real data.

Deliverables:

- Capture source building height and level count in the OSM adapter and persist them on buildings.
- Unknown stays unknown: a building with no usable height tag stores null, never zero or a
  substituted default — the same discipline already applied to `lane_count`.
- Tolerant parsing of the values OSM actually contains (bare metres, `"12 m"`, and unit-suffixed
  forms), treating unparseable values as unknown rather than failing the import.

Acceptance checks:

- A fixture building tagged with a height persists that height; one tagged only with levels
  persists the level count; one tagged with neither persists nulls for both.
- An unparseable height value leaves the height unknown and does not fail the import.
- Existing imports remain valid: the migration adds nullable columns and changes no counts.

Note: converting levels into an estimated height is *inference*, not observation, and belongs to
Milestone 11. This milestone only records what the source stated.

## Milestone 11 — Generated block content

Status: **planned**

Fills blocks with plausible buildings where the source has none, in new tables that extend the raw
layer without modifying it. Fidelity is explicitly not the goal for unmapped blocks; plausibility
and reproducibility are.

Deliverables:

- New tables for generated content, holding generated buildings (footprint, height, kind, owning
  block) and the generation run that produced them (import area, seed, algorithm version,
  parameters, timestamp). No observed table gains a row or a column.
- A deterministic generation service: the same seed, inputs, and algorithm version SHALL produce
  byte-identical output, so a playable map does not reshuffle between runs. Seeded randomness only;
  never iteration order.
- Block population from data already persisted: subdivide a block into lots along its **ordered**
  `block_boundary_segments` frontage, apply a setback, and place footprints in the buildable area.
- Context-driven density and height inference, using the `RoadClassification` of the block's
  bounding roads, its real neighbours' footprints where present, and level counts from Milestone 10.
- Provenance on every inferred value, so measured, inferred, and defaulted heights stay
  distinguishable to consumers and to any later real-data import.
- Respect for observed data: a generated footprint never overlaps a real building, and real
  buildings in a partially mapped block inform the generated ones' size and setback.
- A staleness policy: a run records the inputs it was derived from, so a re-import that changes the
  road graph — and therefore the blocks — marks affected runs stale rather than leaving content
  that silently no longer fits.
- Extension of Milestone 8's export so a caller selects which layers to export: raw only, generated
  only, or both.

Acceptance checks:

- Running generation twice with the same seed produces identical content; a different seed produces
  different content.
- Generation adds no rows to, and modifies no rows in, any observed table, and deleting a run
  restores the area to raw-only with observed counts unchanged.
- No generated footprint overlaps a real building or extends outside its block's buildable area.
- A block bounded by a higher-classification road yields denser or taller content than one bounded
  only by residential roads.
- Re-importing an area whose road graph changed marks dependent runs stale.

Open question: what "playable" commits us to. Collision geometry, spawn points, and a navmesh are
plausible next asks, and the routing graph is already close to a vehicle navmesh — but none of that
is in scope here until the target is named explicitly.

## Milestone 12 — Renderable asset semantics

Status: **planned**

Gives real POIs and generated buildings a stable, renderable identity, so a consumer can show a
recognisable restaurant rather than an anonymous box.

Deliverables:

- Stable asset identifiers attached to real POIs and generated buildings, derived from the
  categories already persisted.
- Asset hints carried through Milestone 8's export as semantic strings, not models — the server
  ships identities and the renderer resolves them to geometry and materials, consistent with mesh
  formats staying client-side.
- A documented fallback chain, so anything without a specific identity still renders as a sensible
  generic rather than disappearing.

Acceptance checks:

- A POI with a recognised category exports a specific asset identifier; an unrecognised one exports
  the documented generic fallback.
- Asset identifiers are stable across exports of unchanged data.
- No 3D model, mesh, or material is produced or stored server-side.

Open question: what "popular" means operationally. OSM carries no popularity measure; brand,
`wikidata` presence, and cuisine tags are the available proxies, and which of them counts needs
deciding before anything is built on it.

## Milestone completion record

When completing a milestone, update its status and add a short note containing:

1. Commit or pull request reference.
2. Tests and verification commands run.
3. Important decisions or limitations.
4. Deferred work for a later milestone.
