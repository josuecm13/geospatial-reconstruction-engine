## Context

See [proposal.md](proposal.md) for motivation. The constraints that shape this design are already in the codebase:

- Every geometry column is `Geometry(..., srid=4326)` with a GiST index. SRID 4326 is geographic, so PostGIS distance and area on the raw `geometry` type are measured in **degrees**, not meters.
- `RoadSegment` already carries a geodesic `distance_meters`, computed on every upsert; `TurnMovement` already carries `allowed` and `restriction_kind`, generated densely per intersection by ingestion. This change reads both and adds neither.
- Existing meter math (`linestring_length_meters`) runs in Python, which works for a value computed once per row on write but cannot filter or sort rows in the database.
- Import areas are capped at 1 km × 1 km, which bounds every table this change reads.
- `AGENTS.md` requires `server/app/domain/` to stay importable without a database and free of SQLAlchemy.

## Goals / Non-Goals

**Goals:**

- Answer spatial questions in meters, correctly, on SRID 4326 data.
- Make the persisted network traversable through an abstraction that carries turn legality with it, so no consumer re-derives restriction semantics.
- Keep the routing algorithm pure: no SQL, no persistence models, no provider types.
- Keep each milestone independently reviewable inside one change.

**Non-Goals:**

- Query performance tuning beyond what the 1 km² cap makes necessary.
- Traced/trimmed boundary scoping (Milestone 8) and HTTP exposure (Milestone 7).
- Alternative cost models (time, turn penalties, road class preference) beyond the distance strategy.

## Decisions

### Evaluate spatial predicates by casting to `geography`

Radius, nearest, and area queries cast to `geography` at the predicate — `ST_DWithin(geom::geography, point::geography, meters)`, `ST_Area(boundary::geography)` — so PostGIS measures on a spheroid in meters and square meters.

Projecting each import area into a metric SRID (UTM) was rejected: it requires picking a zone per area and reprojecting on every read, which is real complexity for a box a kilometre across. Computing distances in Python, as the existing write-path helper does, was rejected because the database must do the filtering and ordering; pulling candidate rows into the application to measure them defeats the purpose of a spatial database.

The cost is that a `::geography` cast does not use the existing plain-`geometry` GiST indexes, so these queries plan as sequential scans. That is accepted deliberately rather than overlooked: under the 1 km² cap these tables hold thousands of rows, and a functional index on the cast would mean a migration this change otherwise does not need. Revisit when a measurement, not a guess, says to.

### Load the graph per import area, then traverse in memory

The graph loader issues one bulk read of an import area's segments and turn movements and builds an in-memory adjacency structure. Search then runs entirely against that structure.

Querying the database during search — a lookup per node expansion — was rejected: it puts N+1 round trips inside Dijkstra's inner loop, and it forces a live session into the routing layer, which would make "routing depends on the abstract graph, not on SQL" true only by convention. Loading once makes it true structurally. The trade-off is memory proportional to area size, which the 1 km² cap bounds; if that cap is ever lifted, this is the decision to revisit first.

### Key the search state on the traversed segment, not the node

Turn legality depends on how you arrived: going straight through an intersection may be legal from one approach and prohibited from another. A search keyed on nodes cannot express that, and would either lose restrictions or need them flattened into the node.

So a search state is the directed segment just traversed; its successors are the outgoing segments whose turn movement from it is `allowed`; the cost of a step is the outgoing segment's `distance_meters`. Departure is the one exception: starting at a node, no turn is being made, so every outgoing segment is open. This mirrors the `road-graph-traversal` requirement of the same shape.

The state space becomes O(segments) instead of O(nodes). That is the standard cost of turn-aware routing and stays small under the area cap.

### Place the graph in the domain, its loader in persistence

`RoadGraph` and its edge/state types are pure structures, so they live in `server/app/domain/` and import nothing framework-specific. The loader that fills one from the database lives with the other persistence code and uses the existing repositories. Routing depends on the domain graph only.

This keeps `AGENTS.md`'s rule — domain stays importable without a database — and makes the routing purity requirement checkable by import, not by inspection. Putting the graph itself in the persistence layer was rejected because routing would then import persistence to name its own inputs.

### Distinguish "no match" from "bad request"

An empty neighbourhood, or an import area with nothing near a coordinate, is a legitimate answer and returns an empty result or an absent nearest candidate. A negative radius, an out-of-range coordinate, or an import area that does not exist is a caller error and raises.

Milestone 4's acceptance check phrases these together as "empty areas and invalid query parameters produce useful errors." Reading that literally would make a legitimately empty neighbourhood an exception, which would force callers to catch a normal outcome; the requirement is instead interpreted as: referencing something that does not exist, or passing a nonsensical parameter, errors — finding nothing does not.

### Add a routing-specific fixture instead of extending the existing one

Routing tests need a network with two legal paths of different lengths and a restriction that forces a detour. `tests/fixtures/osm_neighborhood.json` cannot grow those: Milestone 3's tests assert exact counts against it (3 roads, 5 segments, 1 building, 1 POI, 1 park), so adding ways would break passing tests for no reason.

A second fixture is imported through the real `OSMIngestionService`, so graph and routing tests exercise data produced the way production data is produced, rather than hand-built rows that could drift from what ingestion actually writes.

## Risks / Trade-offs

- [`::geography` casts bypass the GiST indexes, so queries are sequential scans] → Bounded by the 1 km² import cap; add functional indexes only when a measurement justifies the migration.
- [The in-memory graph grows with area size] → Same cap bounds it; this is the first decision to revisit if the cap is lifted.
- [Snapping to the *nearest node* can select a node that is close in metres but awkward to reach, so a route may begin by heading away from the destination] → Accepted for this change and documented; snapping to the nearest segment (and splitting it) is the natural later refinement.
- [Equal-cost paths could make the "same request returns the same route" requirement flaky] → Break ties on a stable key (segment identity) rather than on dictionary or set iteration order, so the search is deterministic by construction rather than by luck.
- [Milestone 8 will add traced-boundary scoping to these same queries] → No scope abstraction is built now, since there is exactly one scope today; the mitigation is that all spatial queries live in one module, so adding a second scope later is a localized change rather than a signature change scattered across the codebase.

## Migration Plan

1. No Alembic migration: this change reads existing tables and adds no columns, tables, or indexes.
2. Land the work in milestone order — spatial queries, then graph traversal, then routing — keeping the suite green at each boundary so each milestone is separately reviewable and revertible.
3. Rollback is removal of the new modules and their tests; nothing else depends on them until Milestone 7 exposes them.

## Open Questions

- Whether nearest-*segment* snapping (splitting a segment at the projected point) should eventually replace nearest-node preparation. It is deferrable: it changes route endpoints at the margins, not the graph, the strategy contract, or the task breakdown.
