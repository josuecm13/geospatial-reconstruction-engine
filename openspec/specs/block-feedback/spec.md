# block-feedback Specification

## Purpose

Lets the owner correct a block's building count, or state that it has none, so that the next generation run follows what is actually there. Feedback is kept apart from OSM data and survives a block being removed, so that it is reported rather than misapplied.

## Requirements

### Requirement: The system SHALL store, replace, clear and list a block's feedback
The system SHALL accept feedback for a block as exactly one of a building count of zero or more, or "no buildings". Storing feedback SHALL replace any earlier feedback for that block. The system SHALL return the stored feedback with its update time, SHALL clear a block's feedback on request, and SHALL list an import area's feedback with each entry marked orphaned or not. A request that sets both or neither SHALL be rejected as an invalid request, and feedback for a block that does not exist SHALL be rejected as not found.

#### Scenario: Setting a count
- **WHEN** a user stores a building count of 4 for a block
- **THEN** the block's feedback reads 4 with `no_buildings` false and an update time

#### Scenario: Setting both or neither
- **WHEN** a request sets both a count and "no buildings", or neither
- **THEN** the request is rejected as an invalid request and nothing is stored

#### Scenario: Clearing feedback that does not exist
- **WHEN** a user clears feedback for a block that has none
- **THEN** the request is rejected as not found

### Requirement: A stated count SHALL cap the block's generated buildings
When a block has a building count, the next run SHALL generate no more than that many buildings on it, taking an evenly spaced subset of the lots that fit in walk order, and SHALL report a feedback shortfall for the block when fewer lots fit than the count. Those buildings SHALL be recorded with the source `feedback`.

#### Scenario: A count the frontage can hold
- **WHEN** a block's feedback says 3 and the frontage fits 6 lots
- **THEN** exactly 3 buildings are generated, spread evenly along the walk, with source `feedback`, and no shortfall is reported

#### Scenario: A count the frontage cannot hold
- **WHEN** a block's feedback says 8 and the frontage fits only 5 lots
- **THEN** 5 buildings are generated and the block is reported in the feedback shortfall list

### Requirement: "No buildings" SHALL generate nothing on the block
When a block's feedback says there are no buildings, the next run SHALL generate no buildings on that block.

#### Scenario: A block marked empty
- **WHEN** a block's feedback says no buildings and the run is regenerated
- **THEN** the block has no generated buildings

### Requirement: Feedback SHALL calibrate similar blocks nearby
For a block without feedback, the system SHALL compare the feedback counts of blocks with feedback within 500 metres that share its style, against their generated counts in the previous run. When at least two such blocks exist, it SHALL divide the block's lot width by the ratio of the two sums, clamped to between 0.5 and 2.0, and SHALL record the calibration ratio on the run. Blocks with no feedback nearby SHALL be unaffected.

#### Scenario: Neighbours generated too many
- **WHEN** two similar blocks nearby have feedback totalling half the buildings generated for them last run
- **THEN** the next run's lot widths on similar blocks are divided by 0.5, and the calibration ratio is recorded

#### Scenario: Too few similar blocks
- **WHEN** only one similar block nearby has feedback
- **THEN** no calibration is applied and no ratio is recorded

### Requirement: Feedback SHALL survive a block's removal and be reported as orphaned
Feedback SHALL NOT be deleted when its block is removed by a re-import. The feedback list SHALL report feedback whose block no longer exists as orphaned, and orphaned feedback SHALL NOT be applied to any block.

#### Scenario: A re-import removes a block with feedback
- **WHEN** a re-import removes a block that has feedback
- **THEN** the feedback is listed as orphaned and no generated building is affected by it

### Requirement: Feedback SHALL NOT make a block an exemplar by itself
A block with feedback SHALL be a reference candidate only when it also has at least three real or confirmed buildings and meets the frontage coverage threshold on its real buildings.

#### Scenario: Feedback on an unbuilt block
- **WHEN** a block has feedback of 6 but no real buildings
- **THEN** the block is not an exemplar
