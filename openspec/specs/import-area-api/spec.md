# import-area-api Specification

## Purpose

Exposes import-area creation, status lookup, and whole-area map data over HTTP so a client can load fixture data and read back the normalized geographic model, including derived blocks.
## Requirements
### Requirement: The API SHALL import fixture data for a bounding box
The API SHALL accept `POST /import-areas` with a bounding box (min/max latitude and longitude) and a fixture payload, SHALL import it under the `osm` provider, and SHALL run the import synchronously. A re-import of the same bounding box SHALL reconcile the area with the new payload. A successful response SHALL return the import area's id, provider, bounding box, status, and the counts of imported roads, navigable nodes, buildings, POIs, area features, derived blocks, and buildings linked to a block.

#### Scenario: Valid fixture is imported
- **WHEN** a client posts a valid bounding box and a valid supported fixture payload
- **THEN** the response has status 200, the import area status is `completed`, and the reported counts match the fixture's supported entities and the blocks derived from its roads

#### Scenario: Same fixture is imported twice
- **WHEN** a client posts the same bounding box and payload twice
- **THEN** both responses report the same import area id and the same counts, including the same block count

#### Scenario: Re-import with a changed payload
- **WHEN** a client re-imports a bounding box with a payload that omits a building the previous payload contained
- **THEN** the response reports the lower building count and the area's map data no longer contains that building

#### Scenario: Invalid bounding box
- **WHEN** a client posts a bounding box whose minimum is not strictly below its maximum, whose coordinates are out of range, or whose area exceeds 1 km²
- **THEN** the response is a 422 error with code `invalid_bounding_box` and no import area is created

#### Scenario: Malformed fixture payload
- **WHEN** a client posts a valid bounding box with a payload containing a malformed supported feature
- **THEN** the response is a 422 error with code `ingestion_failed` and the import area is recorded as `failed`

#### Scenario: Payload outside the bounding box
- **WHEN** a client posts a payload containing a supported feature that does not intersect the posted bounding box
- **THEN** the response is a 422 error with code `payload_outside_bounding_box` whose details name the offending source ids, and the import area is recorded as `failed`

#### Scenario: Oversized request body
- **WHEN** a client posts a request body larger than the configured size limit
- **THEN** the response is a 413 error with code `payload_too_large` and no import area is created

#### Scenario: Concurrent creation of the same import area
- **WHEN** creating the import area fails because a concurrent request created the same provider and bounding box first
- **THEN** the response is a 409 error with code `import_conflict`

### Requirement: The API SHALL report an import area's status and counts
The API SHALL expose `GET /import-areas/{id}` returning the import area's id, provider, bounding box, status, import timestamp, and its recorded entity counts, including its current block count. The status SHALL describe the most recent import attempt.

#### Scenario: Existing import area
- **WHEN** a client requests an import area that exists
- **THEN** the response has status 200 and contains that area's status and counts

#### Scenario: Unknown import area
- **WHEN** a client requests an import area id that does not exist
- **THEN** the response is a 404 error with code `import_area_not_found`

### Requirement: The API SHALL return an import area's full map data as normalized models
The API SHALL expose `GET /import-areas/{id}/map-data` returning every road segment, navigable node, block, building, POI, and area feature persisted for that import area, as one GeoJSON `FeatureCollection` per entity type with `[longitude, latitude]` positions. Each feature SHALL carry its entity id and geometry. Road segments SHALL carry their endpoint node ids, distance, vehicle accessibility, and their street's name and classification as values, without exposing a street identifier. Road segments SHALL also carry their generated cross-section: the lane count for the segment's direction, the lane type, the road's carriageway width in meters, and a lane-count provenance of `tagged` or `defaulted`. The lane count the source stated (or null) SHALL be carried separately as the source lane count. Buildings SHALL carry their category and linked block id (or null); blocks SHALL carry their area in square meters, their buildable area as a GeoJSON `MultiPolygon` (or null when nothing is buildable) and its area in square meters, and whether they are a median and whether they are clipped by the bounding box; POIs SHALL carry their category and name; area features SHALL carry their kind. The response SHALL carry an OpenStreetMap attribution string. No provider-specific tags or persistence-layer fields SHALL appear in the response.

The endpoint SHALL accept an optional `boundary_id` naming one of the area's traced boundaries, and a `mode` of `filter` (the default) or `clip`. In filter mode with a boundary, each layer SHALL contain only the entities whose geometry intersects the boundary, returned whole, and the navigable nodes SHALL also include every endpoint of a returned road segment, so the result stays routable. The response SHALL state its scope (the import area, or the boundary, with its id), its mode, and a local projection: an origin at the scope's centroid and the meters per degree of latitude and of longitude at that origin, on the same sphere the system measures distances on. An export of the import area SHALL equal an export of a boundary covering its whole bounding box, apart from the scope. In clip mode, every geometry, including a block's buildable area, SHALL be cut at the scope (the boundary, or the import area's bounding box without one) and SHALL be contained by it; a cut that leaves several parts SHALL be returned as a multi-part geometry, and an entity with nothing of its own dimension left inside the scope SHALL be omitted. Clip mode SHALL NOT add segment end nodes, and distances and areas SHALL still describe the whole entity, so a clipped export is for rendering, not routing.

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

#### Scenario: Blocks are complete
- **WHEN** a client requests map data for an area with a derived block
- **THEN** the block carries its buildable area, the buildable area's size, and its median and clipped flags

#### Scenario: Filter mode on a boundary
- **WHEN** a client requests map data with the `boundary_id` of a boundary that a road segment crosses
- **THEN** only entities intersecting the boundary are returned, that segment's geometry extends past the boundary, both of its end nodes are returned, and the response states the boundary as its scope, `filter` as its mode, and a projection centred on the boundary

#### Scenario: Whole area and full-rectangle boundary agree
- **WHEN** a client exports the import area and a boundary equal to its bounding box
- **THEN** the two responses are identical apart from their scope

#### Scenario: Clip mode cuts at the scope
- **WHEN** a client exports the same boundary in filter and in clip mode
- **THEN** the filter-mode geometry extends past the boundary, the clip-mode geometry is contained by it, and the response states `clip` as its mode

#### Scenario: Clip mode without a boundary
- **WHEN** a client exports an import area whose roads cross its bounding box in clip mode
- **THEN** every geometry is contained by the bounding box

#### Scenario: A cut in several parts
- **WHEN** a road segment crosses a boundary twice and is exported in clip mode
- **THEN** its geometry is a `MultiLineString` with two parts

#### Scenario: Touching the edge only
- **WHEN** a building only touches a boundary's edge and is exported in clip mode
- **THEN** it is omitted, while filter mode returns it

#### Scenario: Unknown boundary
- **WHEN** a client requests map data with a `boundary_id` that does not exist or belongs to another import area
- **THEN** the response is a 404 error with code `boundary_not_found`

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

