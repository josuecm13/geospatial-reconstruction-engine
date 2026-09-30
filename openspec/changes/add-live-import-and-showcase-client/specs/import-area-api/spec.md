## ADDED Requirements

### Requirement: The API SHALL report an incomplete source response distinctly
`POST /import-areas` SHALL respond to a payload rejected as incomplete with status 422 and code `source_incomplete`, distinct from `ingestion_failed`, and the area SHALL remain readable exactly as before the request.

#### Scenario: Posting a timed-out Overpass response
- **WHEN** a client re-imports a completed area with a payload whose `remark` reports a runtime error
- **THEN** the response is a 422 error with code `source_incomplete`, and the area's map data is still returned as before

## MODIFIED Requirements

### Requirement: The API SHALL return an import area's full map data as normalized models
The API SHALL expose `GET /import-areas/{id}/map-data` returning every road segment, navigable node, block, building, POI, and area feature persisted for that import area, as one GeoJSON `FeatureCollection` per entity type with `[longitude, latitude]` positions. Each feature SHALL carry its entity id and geometry. Road segments SHALL carry their endpoint node ids, distance, vehicle accessibility, and their logical street's id, name, and classification. Segments of one logical street SHALL share its id, and an unchanged re-import SHALL return the same ids. Road segments SHALL also carry their generated cross-section: the lane count for the segment's direction, the lane type, the road's carriageway width in meters, and a lane-count provenance of `tagged` or `defaulted`. The lane count the source stated (or null) SHALL be carried separately as the source lane count. Buildings SHALL carry their category and linked block id (or null); blocks SHALL carry their area in square meters, their buildable area as a GeoJSON `MultiPolygon` (or null when nothing is buildable) and its area in square meters, and whether they are a median and whether they are clipped by the bounding box; POIs SHALL carry their category and name; area features SHALL carry their kind. The response SHALL carry an OpenStreetMap attribution string. No provider-specific tags or persistence-layer fields SHALL appear in the response.

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

#### Scenario: Segments of one street share its id
- **WHEN** a client requests map data for an area whose import grouped three connected ways into one street
- **THEN** every segment of those ways carries the same street id, and a re-import of the same payload returns the same ids
