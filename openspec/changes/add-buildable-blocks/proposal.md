## Why

The project's primary focus is blocks and the buildings on them, and blocks are currently a raw
`ST_Polygonize` of road centerlines. That has three problems. Each block includes half of every
surrounding road, and a divided road's median becomes a thin fake block. Roads crossing the import
bounding box dangle and never close a loop, so the ring of blocks along the edge is never derived.
And every import deletes an area's blocks and re-creates them with fresh ids, so nothing can be
attached to a block across re-imports, which Milestone 11's generated content needs. Milestone
7.1's generated street widths make the first fix possible.

## What Changes

- **Buildable area (#11)**: at derivation, each block gets a buildable area, which is its boundary
  minus each bounding road buffered by half that road's generated 7.1 width. A block whose
  buildable area can't fit `MIN_BUILDABLE_WIDTH_METERS` (5 m) anywhere is kept but flagged
  `is_median`.
- **Edge blocks (#12)**: the bbox ring is polygonized together with the road segments. A face
  inside the bbox whose boundary runs partly along the ring becomes a block flagged `is_clipped`,
  provided a road that crosses the bbox bounds it. Otherwise it's only what is left of the box
  around loops that stay inside it. No face outside the bbox is a block.
- **Stable block ids (#13)**: a block's id is `uuid5` of its import area and its sorted set of
  bounding segment ids. Blocks are still cleared and re-inserted on every import, but an unchanged
  block is re-inserted under the same id.
- **Schema**: #11's migration adds `buildable_area` (nullable `MULTIPOLYGON`),
  `buildable_area_square_meters`, and `is_median` to `blocks`, and #12's adds `is_clipped`.

## Capabilities

### Modified Capabilities
- `block-derivation`: buildable area and median flag, edge blocks closed against the bbox, and
  deterministic block ids.

## Impact

- `server/app/persistence/block_derivation.py`, `server/app/domain/block.py`, a new
  `server/app/domain/block_identity.py`, `server/app/persistence/models.py`, and two Alembic
  migrations.
- `docs/schema.md`, `docs/architecture.md`, and `MILESTONES.md` (7.2 status).
- No API change. Exporting the buildable area is Milestone 8's GeoJSON export.
