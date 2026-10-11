## ADDED Requirements

### Requirement: The system SHALL import five land-use kinds as area features
The system SHALL translate these OSM tags into area features of the matching kind, keeping the existing kinds and their precedence: `forest` from `landuse=forest` or `natural=wood`; `farmland` from `landuse=farmland`, `meadow`, `orchard`, `vineyard` or `farmyard`; `cemetery` from `landuse=cemetery` or `amenity=grave_yard`; `railway` from `landuse=railway`; and `industrial` from `landuse=industrial`.

#### Scenario: A forest drawn as natural wood
- **WHEN** an imported area contains a closed way tagged `natural=wood`
- **THEN** it is imported as an area feature of kind `forest`

#### Scenario: A farmland tag
- **WHEN** an imported area contains a closed way tagged `landuse=vineyard`
- **THEN** it is imported as an area feature of kind `farmland`

#### Scenario: A grave yard
- **WHEN** an imported area contains a closed way tagged `amenity=grave_yard`
- **THEN** it is imported as an area feature of kind `cemetery`

#### Scenario: An existing kind keeps its precedence
- **WHEN** a closed way carries both a kind that already existed and one of the new tags
- **THEN** it is imported with the kind that already existed
