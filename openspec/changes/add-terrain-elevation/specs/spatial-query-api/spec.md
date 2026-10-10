## MODIFIED Requirements

### Requirement: The API SHALL find entities by bounding-box intersection or containment
The API SHALL expose `GET /import-areas/{id}/within-bbox` taking a bounding box, an entity kind (`node`, `building`, or `area_feature`), and a mode (`intersects` or `contains`), and SHALL return the entities of that kind whose geometry intersects, or is wholly contained by, that bounding box. The query bounding box SHALL obey the same validation as an import bounding box, including the 10 km² limit.

#### Scenario: Containment excludes partially overlapping entities
- **WHEN** a client queries in `contains` mode with a box that fully covers one building and partially overlaps another
- **THEN** only the fully covered building is returned, while `intersects` mode returns both

#### Scenario: Invalid query bounding box
- **WHEN** a client queries with a bounding box whose minimum is not strictly below its maximum, or whose area exceeds 10 km²
- **THEN** the response is a 422 error with code `invalid_bounding_box`
