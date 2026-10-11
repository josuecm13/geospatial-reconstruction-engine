## ADDED Requirements

### Requirement: The API SHALL start a generation run in the background and stream its progress
`POST /import-areas/{id}/generation` SHALL accept an optional body holding an integer seed. Without a body, the seed SHALL be the current run's seed when there is one, and otherwise 1. A started run SHALL answer `202` with the import area id and the URL of its event stream, and the stream SHALL emit one `generation` event carrying the block count, then zero or more `generated` events, then `completed` carrying the run, or `failed`. Each `generated` event SHALL carry the local projection, a ring number, the number of eligible blocks processed so far, the block count, and the buildings generated in that ring of blocks, shaped exactly like map data's generated buildings. Rings SHALL be about 150 m wide around the area's centre, nearest first, and a ring SHALL be split across several events of at most 500 buildings each. A generated building's id SHALL be fixed when it is generated, so the streamed ids equal the stored ones. Streamed buildings SHALL be provisional until `completed`. The job SHALL replace the area's run in one transaction, and the order blocks are streamed in SHALL NOT change the generated buildings. The request SHALL be rejected with `404 import_area_not_found` for an unknown area, `409 import_area_not_ready` when the area is not completed, and `409 import_in_progress` when any job for the area is running, since imports, re-analyses and generation share one registry.

#### Scenario: Generating with no body
- **WHEN** a client posts to an area with a run seeded 7 and no body
- **THEN** the API answers `202` and the new run uses seed 7

#### Scenario: Generating an area with no run
- **WHEN** a client posts to an area that has no run and no body
- **THEN** the new run uses seed 1

#### Scenario: Streaming the generated buildings
- **WHEN** a client follows the event stream of a generation run
- **THEN** it receives `generation`, then `generated` events nearest ring first, each with at most 500 buildings, then `completed`, and the streamed building ids are exactly the ids in the area's map data afterwards

#### Scenario: Generating while an import runs
- **WHEN** a client posts while a re-analysis of the same area is running
- **THEN** the API answers `409 import_in_progress`

#### Scenario: Generating an area that is not completed
- **WHEN** a client posts to an area whose import has not completed
- **THEN** the API answers `409 import_area_not_ready`

### Requirement: The API SHALL report and delete an area's generation run
`GET /import-areas/{id}/generation` SHALL return the area's run, with its id, seed, algorithm version, creation time, building count, block count, eligible block count, whether it is stale and why (`roads_changed` or `terrain_changed`), the block ids with a feedback shortfall, and the calibration ratio (or none). It SHALL answer `404 generation_not_found` when there is no run. `DELETE /import-areas/{id}/generation` SHALL remove the run and answer `204`, or `404 generation_not_found` when there is no run.

#### Scenario: Reading a stale run
- **WHEN** a client reads a run whose roads have changed since it was generated
- **THEN** the response has `stale` true and `stale_reasons` containing `roads_changed`

#### Scenario: Deleting a run
- **WHEN** a client deletes an area's run
- **THEN** the API answers `204`, and reading the run answers `404 generation_not_found`

### Requirement: Map data SHALL carry the generation run, generated buildings, and generation zones
`GET /import-areas/{id}/map-data`, in both modes and with or without a `boundary_id`, SHALL carry a `generation` object holding the run, or null. It SHALL carry `generated_buildings` as a GeoJSON `FeatureCollection` whose features hold the block id, style, levels, height in meters, base elevation (or null), reference block id (or null), count source, and `generated: true`. Generated buildings SHALL be composed from the owner areas, as observed buildings are, and SHALL follow the requested scope and clip mode in the same way. It SHALL carry `generation_zones` as a `FeatureCollection` of the area's own run's zones, each with the block id and reason (`water`, `steep`, `landuse` or `setback`). With no run, both collections SHALL be empty.

#### Scenario: An area with a run
- **WHEN** a client requests map data for an area with a run
- **THEN** the response carries the run object, the generated buildings with their properties, and the zones

#### Scenario: A boundary-scoped request
- **WHEN** a client requests map data for a boundary inside an area with a run
- **THEN** only the generated buildings that intersect the boundary are returned

#### Scenario: Clip mode
- **WHEN** a client requests clipped map data for an area with a run
- **THEN** each generated building's geometry is cut at the scope

### Requirement: Block features SHALL carry their generation state
Each block feature in map data SHALL carry `eligibility`, one of `eligible`, `clipped`, `median` or `no_buildable_area`; `real_building_count`; `generated_building_count`, zero without a run; `is_reference`, true when the block was an exemplar in the current run; `reference_block_id`, or null; `style`, or null without a run; and `feedback`, an object holding the building count (or null), whether it says no buildings, and the update time, or null when there is no feedback.

#### Scenario: A block with feedback and a run
- **WHEN** a client requests map data for a block that has feedback and was generated
- **THEN** the block carries its eligibility, its generated count, its style, and its feedback object

#### Scenario: A block without a run
- **WHEN** a client requests map data for an area with no run
- **THEN** every block's `generated_building_count` is 0 and its `style` is null

### Requirement: Feedback endpoints SHALL follow the generation contract
`PUT /blocks/{block_id}/feedback` SHALL accept exactly one of a building count of zero or more or `no_buildings: true`, answer `200` with the stored feedback, and answer `422 invalid_request` for any other body or `404 block_not_found` for an unknown block. `DELETE /blocks/{block_id}/feedback` SHALL answer `204`, or `404 feedback_not_found`. `GET /import-areas/{id}/feedback` SHALL list the area's feedback, each entry marked `orphaned` when its block no longer exists.

#### Scenario: A body with both fields
- **WHEN** a client puts both a building count and `no_buildings: true`
- **THEN** the API answers `422 invalid_request`

#### Scenario: Listing feedback after a re-import
- **WHEN** a client lists an area's feedback and one block has been removed
- **THEN** that entry is marked `orphaned` true
