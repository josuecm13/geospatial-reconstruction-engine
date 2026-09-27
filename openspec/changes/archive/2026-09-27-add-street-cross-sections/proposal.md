## Why

The project builds its own representation of a map, and OSM supplies hints rather than the truth
to reproduce. OSM rarely states a road's lanes (`lanes` is on under 6% of residential ways) or
width (under 2% on every class). Today a missing lane value is therefore just unknown, and nothing
downstream knows how wide a street is. Milestone 7.2's buildable area needs street widths.
Separately, a `Street` is one row per OSM way, so a named street mapped as four ways is four
streets. A street should be a derived, logical entity.

## What Changes

- **Generated cross-section (#9)**: a pure domain function computes, on read, each road's lane
  count per direction, its lane type (`narrow` / `normal` / `wide` by classification), and its
  carriageway width. A tagged lane count wins. An untagged direction defaults to two lanes per
  street: 1 + 1 on a two-way road, and both forward on a one-way road. Nothing is stored, and
  there is no migration. The raw `road_segments.lane_count` still records only what the source
  stated.
- **Visible provenance (#10)**: map-data road segments carry the generated lane count, lane type,
  width, and whether the lane count was `tagged` or `defaulted`. The raw source value stays
  visible under its own name. The docs replace "a missing lane value is unknown" with "defaulted,
  visibly".
- **Logical streets (#8)**: ingestion groups ways into streets by normalized name plus
  connectivity, and pairs same-named one-way carriageways of a divided road. Unnamed ways stay
  single-way streets. A street's id is deterministic, derived from its grouped road ids, and
  stable across unchanged re-imports.

## Capabilities

### New Capabilities
- `street-cross-sections`: generated lane count, lane type, and street width, and the grouping of
  ways into logical streets.

### Modified Capabilities
- `import-area-api`: map-data road segments carry the generated cross-section and its provenance.

## Impact

- Domain: new `app/domain/cross_section.py` and `app/domain/street_grouping.py`, and a new
  `LaneType` enum.
- Persistence: the map-data segment read also returns the road's own classification. No schema
  change.
- Ingestion: streets are upserted per group, not per way.
- API: map-data segment properties change. `lane_count` becomes the generated value, and the raw
  value moves to `source_lane_count`.
- Docs: `docs/architecture.md`, `docs/schema.md`, `MILESTONES.md`.
