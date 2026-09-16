## Why

The database schema can persist the application's geographic model, but there is no repeatable path from an external map representation into that model. A fixture-driven OSM ingestion milestone establishes and tests that boundary before a live provider adds network and availability concerns.

## What Changes

- Add an isolated OSM adapter that translates supported OSM nodes, ways, and restriction relations into application-owned import records.
- Add an ingestion service that creates or reuses an import area, persists normalized streets, roads, nodes, segments, buildings, POIs, area features, and turn movements, and records an import result.
- Support the OSM tags required for initial street semantics: classification, name, one-way access, lane counts, and supported vehicle turn restrictions.
- Use deterministic fixture payloads for automated ingestion tests; live OSM retrieval is explicitly deferred.
- Reject malformed or internally inconsistent supported source data with actionable ingestion errors, and mark a failed import area appropriately.

## Capabilities

### New Capabilities

- `osm-fixture-ingestion`: Translates supported OSM fixture data into the normalized GeoDB model safely, idempotently, and with lane and turn-restriction semantics preserved.

### Modified Capabilities

None.

## Impact

- Adds source-adapter and ingestion-service modules, fixture data, and integration tests under `server/`.
- Uses the existing persistence repositories, import-area lifecycle, road graph persistence, and turn-movement model.
- Does not add API endpoints, live Overpass/OSM network access, routing, or visualization.
