## ADDED Requirements

### Requirement: Building features SHALL carry the source height and level count
Every building feature the API returns, in map data and in spatial query results, SHALL carry `height_meters` and `levels`: the source height in meters and the source level count, each null when the source did not state a usable value.

#### Scenario: Heights in map data
- **WHEN** a client requests map data for an area whose import contained a building tagged with a height and one with no height or level tags
- **THEN** the first building's feature carries that height in `height_meters`, and the second carries null for both `height_meters` and `levels`
