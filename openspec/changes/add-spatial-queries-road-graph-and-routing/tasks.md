## 1. Spatial queries (Milestone 4)

- [ ] 1.1 Add a spatial query module scoped to an import area, with actionable errors for an unknown import area, a non-positive radius, and out-of-range coordinates.
- [ ] 1.2 Implement meter-based within-radius queries over navigable nodes, points of interest, buildings, and area features using `geography` casts.
- [ ] 1.3 Implement bounding-box queries that distinguish intersecting geometry from fully contained geometry.
- [ ] 1.4 Implement geodesic building footprint area in square meters.
- [ ] 1.5 Implement nearest navigable node and nearest road segment lookups, reporting absence rather than failing when the import area holds no candidate.
- [ ] 1.6 Add database-backed tests for inside/outside radius, straddling versus contained geometry, footprint area, nearest selection among several candidates, empty results, cross-import-area isolation, and rejected parameters.

## 2. Road graph traversal (Milestone 5)

- [ ] 2.1 Add pure domain graph types for nodes, directed edges, and traversal state, importing no persistence, SQLAlchemy, or provider types.
- [ ] 2.2 Add a persistence-side loader that bulk-loads one import area's road segments and turn movements into a graph, exposing each edge's persisted `distance_meters` as its cost.
- [ ] 2.3 Offer successors from an incoming segment restricted to turn movements recorded as allowed, and all outgoing segments when departing from a node.
- [ ] 2.4 Exclude road segments not marked vehicle-accessible from the graph.
- [ ] 2.5 Add tests for one-way direction, a prohibited turn not being offered, an only-turn leaving a single option, unrestricted departure from a node, exclusion of vehicle-inaccessible segments, connectivity, disconnected components, edge cost matching the persisted distance, and import-area isolation.

## 3. Route planning (Milestone 6)

- [ ] 3.1 Add a routing fixture with two legal paths of differing length and a restriction that forces a detour, imported through the existing ingestion service.
- [ ] 3.2 Add the `RoutingStrategy` contract and the route result model carrying ordered nodes, ordered segments, geometry, and total distance.
- [ ] 3.3 Add `RoutingEngine` orchestration: snap origin and destination coordinates to nearest navigable nodes, run the strategy, and return either a route or an explicit no-route outcome.
- [ ] 3.4 Implement the distance-based Dijkstra strategy over segment-keyed search state, with deterministic tie-breaking on a stable key.
- [ ] 3.5 Add tests for choosing the shorter of two legal routes, a prohibited turn forcing a longer legal route, an all-prohibited destination reporting no route, a disconnected destination reporting no route, total distance equalling the sum of traversed segments, repeated identical requests, substituting an alternate strategy, and an import area with no navigable nodes.
- [ ] 3.6 Assert the routing and graph domain modules import neither SQLAlchemy nor `app.persistence`.

## 4. Verification

- [ ] 4.1 Run the complete server test suite against PostGIS and fix regressions.
- [ ] 4.2 Run `openspec validate add-spatial-queries-road-graph-and-routing --strict` and update the Milestone 4, 5, and 6 records with verification results when implementation is complete.
