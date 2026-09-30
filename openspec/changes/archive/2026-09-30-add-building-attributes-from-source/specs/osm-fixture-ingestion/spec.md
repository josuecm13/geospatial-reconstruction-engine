## ADDED Requirements

### Requirement: The system SHALL record a building's source height and level count, keeping unknown as unknown
When a supported building carries a height or a level count in the source, the system SHALL persist the height in meters and the level count as a whole number. A height SHALL be accepted as a number optionally suffixed by meters, or as feet converted to meters. A level count SHALL be accepted as a whole non-negative number. A missing, unparseable, non-positive height, or a non-whole or negative level count, SHALL be stored as unknown (null), never as zero or a substituted default, and SHALL NOT fail the import. A re-import SHALL update a building's height and level count in place, keeping its identifier.

#### Scenario: Height, levels, and neither
- **WHEN** an import contains one building tagged with a height of `12 m`, one tagged only with `3` levels, and one tagged with neither
- **THEN** the first stores a height of 12 meters and an unknown level count, the second stores an unknown height and 3 levels, and the third stores both as unknown

#### Scenario: An unparseable height
- **WHEN** an import contains a building whose height is `tall`
- **THEN** the import succeeds and the building's height is unknown

#### Scenario: Height in feet
- **WHEN** an import contains a building whose height is `40 ft`
- **THEN** the building stores a height of 12.192 meters

#### Scenario: A changed height on re-import
- **WHEN** an area is re-imported with a payload in which a building's height changed
- **THEN** the building keeps its identifier and stores the new height
