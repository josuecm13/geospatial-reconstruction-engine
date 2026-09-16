## Why

Milestone 1 gave the project a runnable runtime, a local PostGIS database, and bounding-box validation, but there is still no domain persistence — no tables, no entities, nothing to query. The project's actual priority is representing city blocks and the buildings inside them, and a block's boundary can only be derived from a road graph, so that graph (streets, roads, navigable nodes, segments, turn movements) has to exist first even though it isn't the end goal itself. This change builds the full persistence schema — road graph, derived blocks, buildings, POIs, and area features — as designed collaboratively in `docs/schema.md`, so Milestone 3 (OSM ingestion) has real tables and repositories to write into.

## What Changes

- Add `import_areas` with a `(provider, bbox)` uniqueness so re-running an import against the same bounding box updates the existing row instead of creating a duplicate.
- Add the road graph tables: `streets`, `roads`, `navigable_nodes`, `road_segments` — each keyed by `(import_area_id, source_id)` for idempotent upserts. `road_segments.lane_count` is a single nullable value (a segment's direction is its own `from_node -> to_node`; there is no forward/backward split at this layer — see `docs/schema.md`).
- Add `turn_movements` as a dense table: one row per geometrically plausible `(incoming_segment, outgoing_segment)` pair at each intersection node, classified (`left`/`right`/`straight`/`u_turn`) and defaulting `allowed = true` unless restricted. Enforced by a DB trigger that the incoming segment ends, and the outgoing segment starts, at the stated intersection node.
- Add `blocks` (derived polygons, not sourced from OSM) and `block_boundary_segments` (an ordered join table recording which `road_segments` enclose each block).
- Add `buildings`, `points_of_interest`, and `area_features`, each keyed by `(import_area_id, source_id)`. `buildings.block_id` is a nullable, denormalized link populated by spatial containment against `blocks`.
- Add Postgres native ENUM types for every classification/category field (`import_status`, `road_classification`, `building_category`, `poi_category`, `area_feature_kind`, `movement_kind`, `restriction_kind`).
- Add GiST indexes on every geometry column and btree indexes on every foreign key.
- Add SQLAlchemy/GeoAlchemy2 models and repository interfaces for all of the above — repositories return normalized domain objects, never raw OSM-shaped data (there is no OSM adapter yet; that is Milestone 3).
- Add persistence/repository tests against a disposable database, including idempotent-upsert and turn-movement-integrity cases.
- Correct `MILESTONES.md`'s Milestone 2 deliverable text: it currently describes lane profiles as living on `Street` with separate forward/backward counts, which this change's design supersedes (see `docs/schema.md`), and it does not yet mention `blocks` at all.

## Capabilities

### New Capabilities
- `import-area-lifecycle`: creating/reusing an `ImportArea` by `(provider, bbox)`, tracking its status and counts, and upserting on re-import.
- `road-graph-persistence`: persisting streets, roads, navigable nodes, and road segments with idempotent source-identity upserts and correct lane/direction semantics.
- `turn-movement-modeling`: persisting the dense set of candidate turn movements at each intersection, their classification, allowed/restricted state, and referential integrity to their bounding segments and node.
- `block-derivation`: deriving block polygons from the persisted road graph, recording their bounding segments in order, and linking buildings to their containing block.
- `building-poi-area-feature-persistence`: persisting buildings, points of interest, and area features with source-identity upserts and categorization.

### Modified Capabilities
- None. `bounding-box-validation` (the only existing main spec) is unaffected.

## Impact

- New Alembic migrations under `server/alembic/versions/` (enum types, all new tables, indexes, the turn-movement trigger).
- New SQLAlchemy/GeoAlchemy2 models and repository interfaces under `server/app/domain/` and a new `server/app/persistence/` package.
- New tests under `server/tests/` requiring a running PostGIS instance (`docker compose up -d`).
- `docs/schema.md` becomes the implemented schema, not just a design proposal.
- `MILESTONES.md` Milestone 2 section updated for accuracy (lane profile description, addition of blocks).
- No API endpoints yet (Milestone 7) and no OSM ingestion yet (Milestone 3) — this change only adds the schema, models, and repositories.
