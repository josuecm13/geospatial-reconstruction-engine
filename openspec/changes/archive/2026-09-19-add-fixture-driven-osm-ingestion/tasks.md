## 1. Ingestion contracts and OSM translation

- [x] 1.1 Add provider-neutral import-record types and actionable ingestion error types.
- [x] 1.2 Implement a fixture-backed OSM adapter that parses supported nodes, ways, and relations while ignoring unsupported features.
- [x] 1.3 Map supported road classifications, names, one-way semantics, and lane tags to normalized street and road import records.
- [x] 1.4 Map supported building, POI, park, and area features to normalized import records and reject malformed supported geometries or missing required members.
- [x] 1.5 Add adapter unit tests for supported mappings, ignored features, unknown lane counts, and malformed-data errors.

## 2. Topology and turn-restriction translation

- [x] 2.1 Build ordered road topology from source way node references, splitting at endpoints and shared navigable intersections.
- [x] 2.2 Create directed segment records for bidirectional and one-way roads, assigning directional lane counts correctly.
- [x] 2.3 Resolve supported `no_*` and `only_*` restriction relations through from-way, via-node, and to-way members.
- [x] 2.4 Generate dense turn candidates and apply resolved restrictions, including prohibiting competing movements for `only_*` restrictions.
- [x] 2.5 Add topology and restriction tests covering a one-way road, directional lanes, a prohibited turn, an only-turn, and an unresolved restriction.

## 3. Transactional ingestion service

- [x] 3.1 Implement an ingestion service that creates or reuses the import area and persists translated entities through the existing repositories.
- [x] 3.2 Make a successful import update entity counts, completion status, and an application-level import result.
- [x] 3.3 Make a failed import roll back the attempted entity writes, mark the import area failed, and return an actionable error.
- [x] 3.4 Ensure repeated imports converge without duplicate source entities or turn movements.

## 4. Fixture integration verification

- [x] 4.1 Add a representative OSM fixture containing roads, an intersection, lane data, a turn restriction, buildings, a POI, and a park.
- [x] 4.2 Add database-backed integration tests for successful import, persisted counts, source identity idempotency, directionality, lanes, and turn permissions.
- [x] 4.3 Run the complete server test suite against PostGIS and fix regressions.
- [x] 4.4 Run `openspec validate add-fixture-driven-osm-ingestion --strict` and update the milestone record with verification results when implementation is complete.
