## Purpose

Fills an import area's whole blocks with plausible buildings, drawn from the street and settlement pattern of the place and placed on its stored ground, so that a block can be read as built. The observed buildings are never changed, and a generated layer can be regenerated or removed at any time.

## ADDED Requirements

### Requirement: The system SHALL classify each block's eligibility in a fixed order
The system SHALL classify each block of an import area as `eligible`, `clipped`, `median`, or `no_buildable_area`, checking in that order and giving the first reason that holds. A block SHALL be `clipped` when it is clipped by the bounding box, `median` when it is a median, and `no_buildable_area` when its buildable area is null or under 30 square metres. Only blocks of the area's own SHALL be classified for generation; blocks of composed inner areas SHALL belong to their own areas' runs.

#### Scenario: A clipped median
- **WHEN** a block is both clipped by the bounding box and a median
- **THEN** its eligibility is `clipped`

#### Scenario: A small buildable area
- **WHEN** a whole block's buildable area is 25 square metres
- **THEN** its eligibility is `no_buildable_area`

#### Scenario: An inner area's block
- **WHEN** a generation run covers an area that contains an inner area
- **THEN** the run places no buildings on the inner area's blocks

### Requirement: The system SHALL exclude water, steep ground, and non-residential land from a block's buildable area
For each eligible block, the system SHALL subtract from its buildable area the water area features buffered by 20 metres, the ground whose slope exceeds 30%, and the forest, farmland, cemetery, railway, industrial and park features intersecting the block. Each exclusion SHALL be recorded as a zone with its reason (`water`, `steep` or `landuse`). Steep ground SHALL be excluded only when the area has a stored ground grid; without one, no `steep` zone SHALL be recorded.

#### Scenario: A block beside a river
- **WHEN** a block lies within 20 metres of a water area feature
- **THEN** the buffered water is excluded from the block's suitable ground and recorded as a `water` zone

#### Scenario: A steep slope with a grid
- **WHEN** part of an eligible block's ground has a slope above 30% and the area has a grid
- **THEN** that part is excluded and recorded as a `steep` zone

#### Scenario: A steep slope without a grid
- **WHEN** an area has no stored ground grid
- **THEN** no `steep` zone is recorded for any block

### Requirement: The system SHALL assign each eligible block a settlement style
Each eligible block SHALL have one style: `informal`, `sparse` or `regular`. A block SHALL be `informal` when the centre of its suitable ground lies within 150 metres of water and its ground stands under 2 metres above the nearest water's ground. A block SHALL be `sparse` when the road length within 500 metres of its centroid, clipped to that circle and to the area of context, is under 6 kilometres per square kilometre of land, water excluded; a circle with no land SHALL count as density zero. Every other block SHALL be `regular`. A block SHALL NOT be `informal` when the area has no stored ground grid.

#### Scenario: A village street among fields
- **WHEN** a block's centroid sits in a circle of 500 metres with 2 kilometres of road over 1 square kilometre of land
- **THEN** the block's style is `sparse`

#### Scenario: A dense town with few mapped buildings
- **WHEN** a block lies on a full street grid whose buildings are sparsely mapped
- **THEN** the block's style is `regular`, because the style reads roads, not building coverage

#### Scenario: Low ground beside water without a grid
- **WHEN** a block near water would be `informal` by height, but the area has no stored ground grid
- **THEN** the block's style is not `informal`

### Requirement: The system SHALL measure a reference fingerprint from each exemplar block
A block SHALL be an exemplar when it is eligible, at least 70% of its frontage is covered by its real buildings, and it has at least three real buildings. Frontage SHALL be measured by sampling the buildable area's exterior every metre and casting a ray inward up to 25 m from each sample: the first building the ray hits fronts the street there, and coverage is the share of samples whose ray hits a building. For each real building of an exemplar, the system SHALL measure its width as its longest run of samples, its front setback as the median ray distance, and its depth, area and levels, and the side gap to its neighbours as the uncovered samples between them; buildings no ray reaches do not count toward frontage. The exemplar's fingerprint SHALL hold the median and interquartile range of width, depth, front setback and side gap, the median levels (or none when unknown), the coverage ratio, and the block's style. Each run SHALL store the fingerprint it used.

#### Scenario: A fully built street block
- **WHEN** a block's real buildings cover 80% of its frontage and there are five of them
- **THEN** the block is an exemplar and its fingerprint is stored with the run

#### Scenario: A block with two buildings
- **WHEN** a block has two real buildings, however much of its frontage they cover
- **THEN** the block is not an exemplar

#### Scenario: Unknown levels
- **WHEN** none of an exemplar's buildings has a known level count
- **THEN** its fingerprint's median levels are none

### Requirement: The system SHALL match each eligible block to a reference or to defaults
For each eligible block that is not an exemplar, the system SHALL consider exemplars whose block centroid lies within 500 metres, in any completed import area. It SHALL score each candidate as the distance divided by 500 metres, plus 1 when the road class differs, plus the absolute log of the area ratio, plus 1 when the style differs, and use the lowest score, with the lower block id breaking ties. When there is no candidate, the block SHALL use the defaults for its strongest bounding road class: residential, unclassified and living street as 10 by 12 metres, 4 metres setback, 3 metres gap and 2 levels; tertiary and secondary as 14 by 16 metres, 2 metres setback, 1 metre gap and 3 levels; primary and trunk as 18 by 20 metres, 1 metre setback, no gap and 5 levels. A `sparse` block SHALL multiply the gap by four. An `informal` block SHALL use 6 by 7 metres, a 0.5 metre setback, a 0.5 metre gap and 1 level. The block SHALL record its reference block, or none for defaults.

#### Scenario: A nearby exemplar wins
- **WHEN** two exemplars are within 500 metres and one is closer with the same road class and style
- **THEN** the closer exemplar's fingerprint is used and recorded as the reference

#### Scenario: No exemplar within reach
- **WHEN** no exemplar lies within 500 metres of an eligible block
- **THEN** the block uses the defaults for its strongest bounding road class and records no reference

#### Scenario: A tie
- **WHEN** two candidates have the same score
- **THEN** the candidate with the lower block id is used

### Requirement: The system SHALL generate one deterministic run per import area
The system SHALL generate buildings on every eligible block of an import area in one run, for a seed. Each block's random sequence SHALL depend only on the seed and the block's id, and blocks and frontage edges SHALL be processed in sorted order, so the same seed, data and stored fingerprints always produce the same buildings. A generated building SHALL lie inside the block's suitable ground, SHALL NOT intersect a real building or another accepted generated building, and SHALL cover at least 15 square metres. Its height SHALL be its levels times 3 metres. Its base elevation SHALL be the lowest ground under its footprint when the area has a grid, and none otherwise. A run SHALL replace the area's previous run in one transaction.

#### Scenario: The same seed twice
- **WHEN** an area is generated twice with the same seed and no data changes
- **THEN** both runs produce the same buildings at the same positions

#### Scenario: A footprint that does not fit
- **WHEN** a candidate footprint would overlap a real building
- **THEN** it is not generated

#### Scenario: Regeneration with a new seed
- **WHEN** an area with a run is generated again with a different seed
- **THEN** the previous run is replaced by the new one in one transaction

### Requirement: Generation SHALL NOT write to observed data, and deleting a run SHALL restore OSM-only data
Generation SHALL read observed streets, roads, blocks, buildings, area features and the ground grid, and SHALL write only generated buildings, zones, fingerprints and the run record. Deleting an area's run SHALL remove those generated rows and leave every observed row unchanged, and the area SHALL then show no generated buildings.

#### Scenario: Generating leaves observed rows unchanged
- **WHEN** an area is generated
- **THEN** its buildings, blocks, roads and area features are unchanged

#### Scenario: Deleting the run
- **WHEN** a user deletes an area's generation run
- **THEN** the area has no generated buildings and its observed data is intact

### Requirement: Generated buildings SHALL stay within eligible, unexcluded ground
Every generated building SHALL lie inside an eligible block, outside every excluded zone, outside the front setback strip, and clear of every real building. A generated building SHALL NOT be placed on a block that is not eligible.

#### Scenario: A block beside a street
- **WHEN** an eligible block lies next to a bounding road
- **THEN** no generated footprint lies in the setback strip along that road

#### Scenario: A clipped block
- **WHEN** a block is clipped by the bounding box
- **THEN** no building is generated on it

### Requirement: A run SHALL be reported stale when its roads or terrain have changed
The system SHALL report a run as stale when the area's road graph hash differs from the one the run recorded, with the reason `roads_changed`, or when the area's grid version differs from the one the run recorded, with the reason `terrain_changed`. Staleness SHALL be computed when the run is read, and a run with neither difference SHALL NOT be stale.

#### Scenario: A re-import that changes roads
- **WHEN** a re-import changes the road graph after a run was generated
- **THEN** the run is reported stale with the reason `roads_changed`

#### Scenario: A re-analysis that changes the ground
- **WHEN** the ground grid's version changes after a run was generated
- **THEN** the run is reported stale with the reason `terrain_changed`

#### Scenario: Nothing changed
- **WHEN** neither the roads nor the grid version has changed since the run
- **THEN** the run is not stale

### Requirement: The suite SHALL run generation offline
The generation pipeline SHALL read only stored data and SHALL make no network request, so the automated test suite runs it without any live call.

#### Scenario: Running the suite offline
- **WHEN** the automated test suite runs with no network access
- **THEN** every generation test passes against stored fixtures
