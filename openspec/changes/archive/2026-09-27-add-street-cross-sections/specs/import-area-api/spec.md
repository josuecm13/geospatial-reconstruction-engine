## MODIFIED Requirements

### Requirement: The API SHALL return an import area's full map data as normalized models
The API SHALL expose `GET /import-areas/{id}/map-data` returning every road segment, navigable node, block, building, POI, and area feature persisted for that import area, as one GeoJSON `FeatureCollection` per entity type with `[longitude, latitude]` positions. Each feature SHALL carry its entity id and geometry. Road segments SHALL carry their endpoint node ids, distance, vehicle accessibility, and their street's name and classification as values, without exposing a street identifier. Road segments SHALL also carry their generated cross-section: the lane count for the segment's direction, the lane type, the road's carriageway width in meters, and a lane-count provenance of `tagged` or `defaulted`. The lane count the source stated (or null) SHALL be carried separately as the source lane count. Buildings SHALL carry their category and linked block id (or null); blocks SHALL carry their area in square meters; POIs SHALL carry their category and name; area features SHALL carry their kind. The response SHALL carry an OpenStreetMap attribution string. No provider-specific tags or persistence-layer fields SHALL appear in the response.

#### Scenario: Map data after an import
- **WHEN** a client requests map data for a completed import area
- **THEN** the numbers of navigable nodes, buildings, POIs, area features, and blocks returned equal the area's recorded counts, and buildings inside a derived block reference that block's id

#### Scenario: Attribution is present
- **WHEN** a client requests map data for a completed import area
- **THEN** the response carries the OpenStreetMap attribution string

#### Scenario: Map data for an area that is not completed
- **WHEN** a client requests map data for an import area whose status is not `completed`, including one whose most recent re-import failed
- **THEN** the response is a 409 error with code `import_area_not_ready`

#### Scenario: Defaulted cross-section is visible
- **WHEN** a client requests map data for an area whose roads have no source lane counts
- **THEN** each road segment carries a generated lane count with provenance `defaulted`, its lane type and width, and a null source lane count
