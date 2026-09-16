## 1. Enum types

- [x] 1.1 Add a migration creating all Postgres ENUM types from `docs/schema.md` (`import_status`, `road_classification`, `building_category`, `poi_category`, `area_feature_kind`, `movement_kind`, `restriction_kind`).

## 2. Import area lifecycle

- [x] 2.1 Add a migration creating `import_areas` with `UNIQUE (provider, bbox)`, status, per-entity-type counts, and `created_at`/`updated_at`.
- [x] 2.2 Add the `ImportArea` domain dataclass and `ImportAreaRepository` (create-or-reuse-by-bbox, update status/counts).
- [x] 2.3 Add repository tests: creating a new import area, reusing an existing one for the same `(provider, bbox)`, and updating status/counts on completion.

## 3. Road graph persistence

- [x] 3.1 Add a migration creating `streets`, `roads`, `navigable_nodes`, `road_segments` with `UNIQUE (import_area_id, source_id)` on the source-identified tables, `UNIQUE (road_id, from_node_id, to_node_id)` on `road_segments`, GiST indexes on geometry columns, and btree indexes on FK columns.
- [x] 3.2 Add domain dataclasses and repositories for `Street`, `Road`, `NavigableNode`, `RoadSegment`, including upsert-by-source-identity behavior.
- [x] 3.3 Implement `distance_meters` computation via geodesic measurement when persisting a `RoadSegment`.
- [x] 3.4 Add repository tests: idempotent upsert by source id, two segments with opposite direction for a two-way road, single nullable `lane_count` per segment (unknown stored as null, not zero), and `distance_meters` correctness against a known geometry.

## 4. Turn movement modeling

- [x] 4.1 Add a migration creating `turn_movements` with `UNIQUE (incoming_segment_id, outgoing_segment_id)`, btree indexes on its FK columns, and a trigger enforcing `incoming_segment.to_node_id = intersection_node_id AND outgoing_segment.from_node_id = intersection_node_id`.
- [x] 4.2 Add the `TurnMovement` domain dataclass and repository, including a method to persist the full candidate set for a given intersection node.
- [x] 4.3 Add repository tests: dense candidate generation for a multi-approach intersection, default-allowed with `restriction_kind = none`, an explicit restriction marking a movement not allowed, and the trigger rejecting a mismatched incoming/outgoing/intersection combination.

## 5. Block derivation

- [x] 5.1 Add a migration creating `blocks` (with `area_square_meters`, GiST index on `boundary`) and `block_boundary_segments` (`UNIQUE (block_id, road_segment_id)`, ordered `sequence_order`, btree indexes on both FKs).
- [x] 5.2 Add the `Block` domain dataclass and `BlockRepository`.
- [x] 5.3 Implement the block-derivation service: union + `ST_Polygonize` over an import area's `road_segments.geom`, persist one `Block` per closed ring (discarding the unbounded outer face), and record its `block_boundary_segments` in order.
- [x] 5.4 Add derivation tests using hand-built segment fixtures: a single closed loop produces one block, the outer face is never persisted, and boundary segments read back in order form a closed loop.

## 6. Buildings, POIs, and area features

- [x] 6.1 Add a migration creating `buildings` (with nullable `block_id` FK), `points_of_interest`, `area_features`, each with `UNIQUE (import_area_id, source_id)`, GiST indexes on geometry, and btree indexes on FK columns.
- [x] 6.2 Add domain dataclasses and repositories for `Building`, `PointOfInterest`, `AreaFeature`, including upsert-by-source-identity behavior.
- [x] 6.3 Implement building-to-block linking via `ST_Contains(block.boundary, building.geom)`, leaving `block_id` null when no block contains the building.
- [x] 6.4 Add repository tests: idempotent upsert for each entity type, each persisted with a valid category/kind, a building correctly linked to its containing block, and a building outside every block left unlinked.

## 7. Documentation

- [x] 7.1 Update `MILESTONES.md` Milestone 2: correct the lane-profile description (single per-segment `lane_count`, not `Street`-level forward/backward counts) and add block derivation to its deliverables and acceptance checks.

## 8. Verification and commit

- [x] 8.1 Run the full test suite against a running PostGIS instance (`docker compose up -d`, then `pytest -q` from `server/`) and confirm it passes.
- [x] 8.2 Verify migrations apply cleanly against an empty database volume and that `alembic downgrade base` cleanly reverses them.
- [x] 8.3 Commit the change using Conventional Commits.
