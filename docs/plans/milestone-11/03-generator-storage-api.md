# 03 — The generator, storage, the generation and feedback API, and map-data (#23)

Model: sonnet. Branch: `work/m11-generator`, from the commit the coordinator gives, which is on
`origin/feat/23-generated-block-content`. **One commit per numbered part**, and don't push.
`python3 -m py_compile` is fine (shapely is in `server/.venv`; use
`server/.venv/bin/python -m py_compile`). No pytest or other suites: CI is the gate. Server only.

Read `docs/plans/milestone-11/00-decisions-and-contract.md` (the "contract"). §6–§8 are yours, and
§8 is binding, because the client (brief 04) is built against it in parallel.

Brief 01 already added these. Build on them, and don't rewrite them:

- **`app/domain/generation.py`:**
  - `eligibility(block) -> BlockEligibility`;
  - the enums `SettlementStyle`, `ZoneReason` and `RoadClassGroup`;
  - the types `Spread`, `Fingerprint` and `BuildingMeasure`;
  - `strongest_road_group`, `default_fingerprint(group, style)`, `qualifies_as_exemplar`;
  - `MatchProfile`, `ReferenceCandidate`, `match_score`, and `best_reference(subject, candidates)`,
    which returns None beyond 500 m;
  - `DEFAULT_IQR_FRACTION = 0.2`.
- **`app/generation/geometry.py`:** domain ↔ shapely in local metres (`polygon_to_local`,
  `multipolygon_from_local`, …).
- **`app/generation/suitability.py`:**
  - `suitability(block, *, projection, water, landuse, grid, real_buildings_nearby, area_of_context) -> Suitability`,
    with `.suitable`, `.zones` and `.style`;
  - `Suitability.with_setback(strip)`.
- **`app/generation/fingerprint.py`:** `fingerprint(block, buildings, *, style, projection)`,
  `is_exemplar(...)`, `measure_block(...)`, `frontage_edges(buildable_local)` and
  `measure_building(...)`.
- **`BlockRepository`:** `blocks_within(point, meters, exclude_area_id=None) -> list[(Block, distance_m)]`
  (completed areas, nearest first), and `bounding_road_classes(block_id)`.
- **Milestone 10:** `app/domain/elevation.py` `building_base_height(grid, polygon)` and
  `ElevationRepository.get_grid(area_id)`.

## 1. Storage (contract §7)

- **One Alembic migration, chained after the current head.** Read `server/alembic/versions/` on your
  base and set `down_revision` to the newest revision. There must be exactly one head.
- It creates `generation_runs`, `generated_buildings`, `generation_zones`, `block_fingerprints` and
  `block_feedback`, with the keys, cascades and checks in §7.
- **Models**, and two repositories:
  - `GenerationRepository`: replace the run for an area in one transaction (delete the old run and
    let its cascades go, then insert), read the run, delete it, list generated buildings for owner
    areas, list zones, and fingerprints per run.
  - `BlockFeedbackRepository`: put, delete, get, and list for an area with an `orphaned` flag
    (block id not in `blocks`).
- **Domain value types** for a generated building, a zone, a run summary and feedback, in
  `domain/generation.py` (pure).
- Confirm `ImportAreaRepository.delete` still works through the cascades. `block_feedback` has an FK
  to `import_areas` with a cascade, and no FK to blocks. Say what you checked.
- **Tests** in `tests/persistence/test_generation_repository.py`:
  - replacing a run removes the old buildings and zones;
  - cascades: deleting a block removes its generated buildings, and deleting the area removes
    everything;
  - feedback put, get and delete, and an orphaned flag after its block is deleted;
  - the CHECK rejects both fields set, or neither.

## 2. The generator (contract §6), `app/generation/generator.py` and `app/generation/run.py`

- **`generator.py`**, pure apart from shapely and with no DB:
  - `generate_block(block, *, suitability, fingerprint, reference_block_id, count_source, feedback, rng, grid, real_footprints, projection) -> list[GeneratedFootprint]`.
  - Implement exactly: the setback strip via `with_setback`, the stable edge walk, sampled lots, the
    oriented rectangles, `informal` jitter, the acceptance rules, levels and height, and
    `base_elevation_meters` from the grid.
  - **Feedback:** an evenly spaced subset for a count N, nothing for `no_buildings`, and the
    shortfall reported.
- **`run.py`:** `GenerationService(session).generate(area, seed) -> RunSummary`. It:
  1. loads the area's own blocks, buildings (per block via `block_id`), the water and landuse area
     features, the grid (if any), the area's feedback, and the previous run (for calibration);
  2. computes eligibility for each block;
  3. computes suitability for the eligible blocks (`area_of_context` is the area's bbox ring, and
     `real_buildings_nearby` are the composed buildings within 500 m);
  4. fingerprints the exemplars (the area's own eligible blocks, plus exemplars from `blocks_within`
     500 m in other areas; fingerprint those from their own buildings), then matches the rest with
     `best_reference` or the defaults;
  5. applies calibration (§6) from the feedback and the previous run;
  6. generates each eligible block in sorted id order with `random.Random(f"{seed}:{block_id}")`;
  7. replaces the run, storing the parameters (`calibration_ratio`, thresholds, and the
     `algorithm_version` `"frontage-lots-v1"`), `elevation_version`, `road_graph_hash` (the sha256 of
     the sorted own block ids), the counts, the zones and the fingerprints used.

  It doesn't commit; the caller commits.
- **Staleness:** `stale_reasons(area, run)` computes `roads_changed` and `terrain_changed` on read.
- **Tests** in `tests/generation/test_generator.py` (pure) and `tests/generation/test_run.py` (DB,
  with a fixture area; follow `tests/ingestion/test_elevation_analysis.py`):
  - the same seed gives identical footprints, and a different seed gives different ones;
  - nothing outside `suitable`, nothing in the setback, no overlap with real or other generated
    buildings;
  - feedback count N gives exactly N where room allows, and `no_buildings` gives 0;
  - no observed table's row count changes;
  - deleting the run restores the counts;
  - re-generation replaces the run;
  - the run is stale after a block-set change.

## 3. API (contract §8)

- **`POST /import-areas/{id}/generation`** runs a background job on the shared registry, exactly like
  `POST …/elevation` in `api/routers/import_areas.py` and `api/background_import.py`
  (`elevation_work`). It emits `generation` `{"block_count"}`, then `completed` `{"run": …}` or
  `failed`. It uses the seed rule from §8, returns 404 and 409 `import_area_not_ready` from
  `completed_import_area`, and 409 `import_in_progress` from the registry.
- **`GET` and `DELETE /import-areas/{id}/generation`**, with 404 `generation_not_found`.
- **Feedback:** `PUT` and `DELETE /blocks/{block_id}/feedback`, and
  `GET /import-areas/{id}/feedback`, in a new `api/routers/generation.py` registered in `main.py`.
  Return 422 `invalid_request` unless exactly one field is set, 404 `block_not_found`, and 404
  `feedback_not_found`.
- **`map-data`** (`get_map_data`):
  - `generation` (the run object with `stale` and `stale_reasons`);
  - `generated_buildings`, composed from the owner areas' runs, scoped like buildings and clipped in
    clip mode (extend `clip_to_scope` / `_clipped` for the new layer);
  - `generation_zones`, from the own run;
  - and the new block properties (§8).

  Add optional parameters to `block_feature` so other callers are unchanged. `real_building_count`
  is counted from `buildings.block_id`.
- **Error mapping:** add the new codes wherever error codes are listed.
- **Tests:**
  - `tests/api/test_generation_api.py`: 202 then events, GET, DELETE, the 404s and 409s, the seed
    rule, feedback put, get, delete, list and orphaned, and the 422 shape.
  - `tests/api/test_map_data_generation.py`: the new layers and properties, empty and null without a
    run.
  - Make sure the conftest overrides keep every test off the network.

## 4. Docs

- `docs/architecture.md`: a "Generated block content" section covering the layering, eligibility,
  suitability, references, the generator, feedback and calibration, and staleness. Point to the
  contract's thresholds.
- `docs/schema.md`: the five tables.
- `docs/client-features.md`: rows for the generation, feedback and settings API, with the client
  column "—"; brief 04 fills it in.
- **Don't edit `openspec/`.**

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(persistence): store generation runs, generated buildings, zones, fingerprints and block feedback (#23)`
2. `feat(blocks): generate buildings along block frontages from local references (#23)`
3. `feat(api): generate in the background, take block feedback, and serve generated content in map-data (#23)`
4. `docs: generated block content (#23)`

Report:
- the SHAs, and `git show --stat` for each;
- the migration's `down_revision`;
- how determinism is ensured;
- the calibration details;
- anything in the contract that didn't fit.
