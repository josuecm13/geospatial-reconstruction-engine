## ADDED Requirements

### Requirement: The API SHALL create, list, fetch, and delete an import area's traced boundaries
The API SHALL expose `POST /import-areas/{id}/boundaries` taking a name and a GeoJSON `Polygon` with a single ring in `[longitude, latitude]` positions, and SHALL respond with status 201 and the stored boundary. It SHALL expose `GET /import-areas/{id}/boundaries` returning the area's boundaries as a GeoJSON `FeatureCollection` ordered by name, `GET /import-areas/{id}/boundaries/{boundary_id}` returning one boundary, and `DELETE /import-areas/{id}/boundaries/{boundary_id}` responding with status 204. A boundary SHALL be returned as a GeoJSON `Feature` carrying its id, its polygon, and its name, import area id, and creation time. Creating or deleting a boundary SHALL NOT change the import area's bounding box or counts.

#### Scenario: Create, read back, and delete
- **WHEN** a client creates a boundary, lists and fetches it, then deletes it
- **THEN** the create responds 201 with the boundary, the list and the fetch return it, the delete responds 204, and a later fetch is a 404 error with code `boundary_not_found`

#### Scenario: The rectangle and its counts are unchanged
- **WHEN** a client creates and then deletes a boundary for an imported area
- **THEN** `GET /import-areas/{id}` returns the same bounding box and counts before the create, after it, and after the delete

#### Scenario: Invalid polygon
- **WHEN** a client posts a self-intersecting polygon, one extending outside the import area's bounding box, one with holes, or a geometry that isn't a GeoJSON `Polygon`
- **THEN** the response is a 422 error with code `invalid_boundary` whose details name the failed rule, and nothing is stored

#### Scenario: Out-of-range coordinate
- **WHEN** a client posts a polygon with a latitude outside [-90, 90] or a longitude outside [-180, 180]
- **THEN** the response is a 422 error with code `invalid_coordinate`

#### Scenario: Duplicate name
- **WHEN** a client creates a boundary with a name already used in the same import area
- **THEN** the response is a 409 error with code `boundary_name_conflict`

#### Scenario: Unknown import area or boundary
- **WHEN** a client addresses an import area that does not exist, a boundary that does not exist, or a boundary that belongs to another import area
- **THEN** the response is a 404 error with code `import_area_not_found` or `boundary_not_found` respectively
