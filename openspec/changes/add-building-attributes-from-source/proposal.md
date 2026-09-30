## Why

The showcase scene in Milestone 9 extrudes buildings to their real heights. Right now the heights
OSM states are thrown away at the adapter, and nothing in the API could carry them. This
completes the raw layer before the client needs it.

See `MILESTONES.md` → "Milestone 8.1 — Building attributes from source" and #22.

## What Changes

- **Building height and levels (#72)**: parse `height` and `building:levels` tolerantly, persist them as nullable columns, reconcile them on re-import, and carry them on building features.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `osm-fixture-ingestion`: buildings keep their source height and level count; unknown stays null.
- `import-area-api`: building features carry `height_meters` and `levels`.

## Impact

- Adapter, domain `Building`, `buildings` table (migration), building repository, ingestion service, API mappers.
- `docs/schema.md`, `docs/client-features.md`, `MILESTONES.md`.
