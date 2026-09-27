## 1. Generated cross-section (#9)

- [x] 1.1 Add `LaneType` to `app/domain/enums.py` and `app/domain/cross_section.py` with lane widths, `lane_type_for`, `cross_section_for_road`, and `cross_sections_by_segment`
- [x] 1.2 Return the road's own classification from `RoadSegmentRepository.list_for_import_area_with_street`
- [x] 1.3 Add the module to the domain purity test; table-driven unit tests for defaults, tags, lane types, and width
- [x] 1.4 Mutation-check the purity guard and the exhaustive lane-type mapping

## 2. Visible provenance (#10)

- [x] 2.1 Map-data road segments carry generated `lane_count`, `lane_type`, `width_meters`, `lane_count_provenance`, and raw `source_lane_count`
- [x] 2.2 API test over `osm_neighborhood.json`: defaulted counts, lane type, width, and raw value still null; mutation-check the raw-value guard
- [x] 2.3 Replace "a missing lane value is unknown" in `docs/architecture.md` and `docs/schema.md`

## 3. Logical streets (#8)

- [x] 3.1 Add `app/domain/street_grouping.py` (name + connectivity, divided one-way pairs, deterministic group key and id)
- [x] 3.2 Ingestion upserts one street per group and points each road at its group's street
- [x] 3.3 Unit tests for grouping; ingestion test with a grouped-streets fixture covering count, shared street id, and id stability across re-import
- [x] 3.4 Update `docs/schema.md`, the `RoadSegmentWithStreet` docstring, and `MILESTONES.md` status for 7.1
