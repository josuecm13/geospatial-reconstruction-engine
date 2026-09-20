## Why

Milestones 0–3 built and populated the normalized model, but nothing reads it back. There is no way to ask a spatial question about imported data, to traverse the road network, or to produce a route. This change delivers the read side of the system — query, traverse, route — which is what makes the persisted data useful and what the later API milestone will expose.

These three milestones are proposed together because they form one dependent stack: routing consumes a graph abstraction, and route preparation consumes nearest-node lookup. Splitting them would mean designing each layer's contract twice — once speculatively, once for real. They stay separable inside this change: one capability per milestone, and tasks phased so each milestone is independently reviewable and leaves the suite green.

## What Changes

- Add coordinate-and-radius, bounding-box, containment, area, and nearest-neighbor queries over the already-persisted navigable nodes, road segments, POIs, buildings, and area features, returning domain models.
- Add a provider-neutral road graph abstraction over the persisted `road_segments` and `turn_movements`, exposing only movements recorded as allowed, with existing `RoadSegment.distance_meters` as edge cost.
- Add a `RoutingStrategy` contract, a `RoutingEngine` that prepares origin/destination coordinates into graph entry points, and a first distance-based Dijkstra strategy whose search state is turn-aware.
- Add a route result model carrying ordered nodes, ordered segments, geometry, and total distance.
- No new persisted entities, no schema migration, and no change to how data is written: this change only reads what ingestion already produces.

## Capabilities

### New Capabilities

- `spatial-queries`: Answers spatial questions about imported entities — within-radius, within-bounds, containment, footprint area, and nearest navigable node/segment — in meters, returning normalized domain models.
- `road-graph-traversal`: Exposes the persisted road network as a provider-neutral directed graph whose legal moves honour recorded turn-movement permissions, independent of SQL and OSM.
- `route-planning`: Produces a route between two coordinates through a substitutable routing strategy, respecting turn legality and reporting an actionable outcome when no route exists.

### Modified Capabilities

None. `road-graph-persistence`, `turn-movement-modeling`, and the entity-persistence capabilities are consumed as they already behave; none of their requirements change.

## Impact

- Adds read-side modules and tests under `server/app/` and `server/tests/`; no Alembic migration expected.
- Depends on existing repositories, `RoadSegment.distance_meters`, `TurnMovement.allowed`, and the GiST-indexed SRID 4326 geometry columns already in place.
- Does not add HTTP endpoints (Milestone 7), traced import-area boundaries (Milestone 8), or live OSM retrieval and visualization (Milestone 9), and does not resolve when block derivation is invoked (Milestone 7).
