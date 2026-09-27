## 1. Buildable area (#11)

- [x] 1.1 Migration adding `buildable_area`, `buildable_area_square_meters`, `is_median` to `blocks`; model and `Block` fields
- [x] 1.2 Derivation computes buildable area from bounding segments' generated half-widths and flags medians (`MIN_BUILDABLE_WIDTH_METERS`)
- [x] 1.3 Tests: loop fixture buildable area equals centerline area minus half-width strips; a divided-road median is flagged; mutation-check both
- [x] 1.4 Update `docs/schema.md`

## 2. Edge blocks (#12)

- [x] 2.1 Migration adding `blocks.is_clipped`; polygonize the bbox ring with the segments; keep faces inside the bbox; flag `is_clipped`; keep a clipped face only when a bbox-crossing road bounds it
- [x] 2.2 Bounding segments include segments sharing a line with the face boundary
- [x] 2.3 Fixture whose roads cross the bbox edge yields flagged edge blocks; mutation-check

## 3. Stable block ids (#13)

- [ ] 3.1 `app/domain/block_identity.py`: `block_id_for(import_area_id, segment_ids)`, with purity test and table-driven tests
- [ ] 3.2 Derivation inserts blocks under their deterministic id
- [ ] 3.3 Tests: unchanged re-import keeps every block id; changing one road changes only the ids of the blocks it bounds; mutation-check
- [ ] 3.4 Update `docs/schema.md`, `docs/architecture.md`, and `MILESTONES.md` status for 7.2
