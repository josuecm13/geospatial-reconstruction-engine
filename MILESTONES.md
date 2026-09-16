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

Status: **planned**

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

## Milestone 2 — Domain model and persistence schema

Status: **planned**

Deliverables:

- Domain entities for import areas, roads, navigable nodes, road segments, buildings, POIs, and area features.
- Database tables, constraints, spatial indexes, and source identity keys.
- Repository interfaces that do not expose OSM-specific types.
- Tests for persistence, geometry validity, building area, and idempotent upserts.

Acceptance checks:

- The schema can be recreated entirely through migrations.
- A fixture dataset can be written and read through domain repositories.
- Repeating the same write does not create duplicate source entities.

## Milestone 3 — OSM adapter and fixture-driven ingestion

Status: **planned**

Deliverables:

- Isolated OSM response adapter/parser.
- Translation from OSM features into domain import records.
- Fixture-based ingestion service for roads, buildings, POIs, and parks.
- Import reporting and meaningful malformed-data errors.

Acceptance checks:

- OSM-specific tags stop at the adapter boundary.
- A representative fixture imports into the custom schema.
- Repeating an import is safe and reports created/updated/skipped counts.

## Milestone 4 — Spatial query capabilities

Status: **planned**

Deliverables:

- Nearby-object queries by coordinate and radius.
- Bounding-box intersection/containment queries.
- Building footprint area calculation through PostGIS.
- Nearest navigable road and node lookup.

Acceptance checks:

- Integration tests prove meter-based distance and area behavior.
- Queries return normalized domain models rather than raw database or OSM records.
- Empty areas and invalid query parameters produce useful errors.

## Milestone 5 — Road graph construction

Status: **planned**

Deliverables:

- Provider-neutral graph interfaces and graph repository.
- Conversion of road segments into directed graph edges.
- Explicit intersection and navigable-node handling.
- Tests for connectivity, one-way roads, and disconnected components.

Acceptance checks:

- The graph can be built from the persisted domain model without OSM dependencies.
- Every edge has valid endpoints and a non-negative traversal distance.
- Connectivity tests demonstrate preserved intersections and directionality.

## Milestone 6 — Routing strategy and route preparation

Status: **planned**

Deliverables:

- `RoutingStrategy` contract and `RoutingEngine` orchestration.
- Nearest-node preparation for origin and destination coordinates.
- First strategy: distance-based Dijkstra.
- Route result model with ordered nodes/segments, geometry, and total distance.
- Tests for successful routes, unreachable destinations, and strategy substitution.

Acceptance checks:

- Routing code depends on the abstract graph, not on SQL or OSM.
- A known fixture produces a deterministic route.
- An alternate test strategy can be injected without changing `RoutingEngine`.

## Milestone 7 — Application API

Status: **planned**

Deliverables:

- Import-area endpoint.
- Map-data and spatial-query endpoints.
- Route endpoint with selectable strategy.
- Application-level request/response models and error handling.
- API integration tests.

Acceptance checks:

- The API can import fixture data, query it, and return a route end to end.
- Responses contain normalized application models and stable error shapes.
- Database failures and disconnected routes are reported clearly.

## Milestone 8 — Minimal visualization and end-to-end demonstration

Status: **planned**

Deliverables:

- Lightweight web map client.
- Rendering of roads, buildings, POIs, and route geometry.
- Documented walkthrough using a bounded real-world import.
- Operational runbook for starting services, migrating, importing, querying, and routing.

Acceptance checks:

- A developer can follow the runbook from a clean checkout.
- The map visibly demonstrates that imported data is served from the custom representation.
- A route from Point A to Point B can be selected and displayed.

## Milestone completion record

When completing a milestone, update its status and add a short note containing:

1. Commit or pull request reference.
2. Tests and verification commands run.
3. Important decisions or limitations.
4. Deferred work for a later milestone.
