## ADDED Requirements

### Requirement: Every road SHALL have a generated cross-section computed on read
The system SHALL compute, for every road, a cross-section with a lane count per direction of travel, a lane type, a lane width, and a carriageway width. The cross-section SHALL be computed from the road's classification, its directions of travel, and any source-stated lane counts, each time it is read. It SHALL NOT be stored. A direction whose lane count the source states SHALL use that count. A direction the source is silent on SHALL default to one lane on a two-way road, and to two lanes in the travel direction on a one-way road. The stored per-segment lane count SHALL continue to record only what the source stated.

#### Scenario: Untagged two-way road
- **WHEN** a two-way road has no source lane count
- **THEN** its cross-section has one lane in each direction, both defaulted

#### Scenario: Untagged one-way road
- **WHEN** a one-way road has no source lane count
- **THEN** its cross-section has two lanes in the travel direction, defaulted, and none against it

#### Scenario: Tagged lane count wins
- **WHEN** a road's source states a lane count for a direction
- **THEN** its cross-section uses that count for that direction, marked tagged

#### Scenario: Raw lane count is unchanged
- **WHEN** a road with no source lane count is imported
- **THEN** its stored segment lane count remains unknown

### Requirement: Lane type and width SHALL follow the road classification
The lane type SHALL be `narrow` for service roads; `normal` for residential, unclassified, and tertiary roads; and `wide` for secondary, primary, trunk, and motorway roads. Each lane type SHALL have a fixed lane width held as a domain constant. The carriageway width SHALL be the total lane count across both directions multiplied by the lane width. Parking and sidewalks are excluded.

#### Scenario: Residential street width
- **WHEN** an untagged two-way residential road's cross-section is computed
- **THEN** its lane type is `normal` and its width is two normal lane widths

### Requirement: Ways SHALL be grouped into logical streets with deterministic identifiers
Ingestion SHALL group road ways into streets. Named ways SHALL be grouped when their normalized names match and they share a node, or when they are same-named one-way carriageways running in opposite directions alongside each other, as on a divided road. Unnamed ways SHALL each form their own street. A street's identifier SHALL be derived deterministically from the import area and the source ids of its grouped ways, so that an unchanged re-import keeps every street identifier.

#### Scenario: A named street mapped as several ways
- **WHEN** three connected ways share the name "Main Street" (ignoring case and spacing)
- **THEN** ingestion stores one street for them, and all three roads reference it

#### Scenario: Divided road carriageways
- **WHEN** two same-named one-way ways run in opposite directions within a few meters of each other
- **THEN** ingestion stores one street for both

#### Scenario: Unnamed ways stay separate
- **WHEN** two connected ways have no name
- **THEN** ingestion stores two streets

#### Scenario: Unchanged re-import keeps street ids
- **WHEN** the same payload is imported twice for the same import area
- **THEN** every street keeps its identifier
