# spatial-query-api Specification

## Purpose

Exposes the engine's meter-based spatial queries over HTTP, scoped to one import area, returning normalized application models.

## Requirements

### Requirement: The API SHALL find entities within a radius of a coordinate
The API SHALL expose `GET /import-areas/{id}/nearby` taking a latitude, longitude, radius in meters, and an entity kind (`node`, `poi`, `building`, or `area_feature`), and SHALL return the entities of that kind in the import area whose geometry lies within the radius, measured in meters on the ellipsoid.

#### Scenario: Entities inside the radius
- **WHEN** a client queries a radius that covers some but not all entities of the requested kind
- **THEN** the response has status 200 and contains exactly the entities within that distance

#### Scenario: Nothing within the radius
- **WHEN** a client queries a radius that covers no entity of the requested kind
- **THEN** the response has status 200 and an empty result list, not an error

#### Scenario: Non-positive radius
- **WHEN** a client queries with a radius of zero or less
- **THEN** the response is a 422 error with code `invalid_spatial_query`

#### Scenario: Out-of-range coordinate
- **WHEN** a client queries with a latitude outside [-90, 90] or a longitude outside [-180, 180]
- **THEN** the response is a 422 error with code `invalid_coordinate`

### Requirement: The API SHALL find entities by bounding-box intersection or containment
The API SHALL expose `GET /import-areas/{id}/within-bbox` taking a bounding box, an entity kind (`node`, `building`, or `area_feature`), and a mode (`intersects` or `contains`), and SHALL return the entities of that kind whose geometry intersects, or is wholly contained by, that bounding box. The query bounding box SHALL obey the same validation as an import bounding box, including the 1 km² limit.

#### Scenario: Containment excludes partially overlapping entities
- **WHEN** a client queries in `contains` mode with a box that fully covers one building and partially overlaps another
- **THEN** only the fully covered building is returned, while `intersects` mode returns both

#### Scenario: Invalid query bounding box
- **WHEN** a client queries with a bounding box whose minimum is not strictly below its maximum, or whose area exceeds 1 km²
- **THEN** the response is a 422 error with code `invalid_bounding_box`

### Requirement: The API SHALL find the nearest navigable node or road segment
The API SHALL expose `GET /import-areas/{id}/nearest` taking a latitude, longitude, and a kind (`node` or `segment`), and SHALL return the single nearest entity of that kind in the import area, or a null result if the area has none.

#### Scenario: Nearest node
- **WHEN** a client asks for the nearest node to a coordinate beside a known intersection
- **THEN** the response returns that intersection's node

#### Scenario: Area without road data
- **WHEN** a client asks for the nearest node in a completed import area that has no navigable nodes
- **THEN** the response has status 200 and a null result

### Requirement: The API SHALL report a building's footprint area in square meters
The API SHALL expose `GET /import-areas/{id}/buildings/{building_id}/footprint-area` returning the building's footprint area in square meters.

#### Scenario: Known building
- **WHEN** a client requests the footprint area of a building in the import area
- **THEN** the response contains a positive area in square meters

#### Scenario: Building not in the import area
- **WHEN** a client requests a building id that does not belong to the named import area
- **THEN** the response is a 404 error with code `building_not_found`

### Requirement: Spatial queries SHALL be scoped to an existing, completed import area
Every spatial-query endpoint SHALL reject an unknown import area id and an import area whose status is not `completed`, and SHALL only return entities belonging to the named import area.

#### Scenario: Unknown import area
- **WHEN** a client runs any spatial query against an import area id that does not exist
- **THEN** the response is a 404 error with code `import_area_not_found`

#### Scenario: Failed import area
- **WHEN** a client runs any spatial query against an import area whose status is `failed`
- **THEN** the response is a 409 error with code `import_area_not_ready`
