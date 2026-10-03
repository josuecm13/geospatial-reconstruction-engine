## ADDED Requirements

### Requirement: The API SHALL list import areas
The API SHALL expose `GET /import-areas` returning import areas most recently imported first (an area that never completed an import is ordered by its creation time), each with the same fields as `GET /import-areas/{id}`. It SHALL accept an optional `status` filter and a `limit` from 1 to 200, defaulting to 50. An invalid `status` or `limit` SHALL be a 422 error with code `invalid_request`.

#### Scenario: Listing completed areas
- **WHEN** a client lists import areas with `status=completed` after importing two areas and failing a third
- **THEN** the response holds the two completed areas, the most recently imported first, each equal to its `GET /import-areas/{id}` response

### Requirement: The API SHALL report an incomplete source response distinctly
`POST /import-areas` SHALL respond to a payload rejected as incomplete with status 422 and code `source_incomplete`, distinct from `ingestion_failed`, and the area SHALL remain readable exactly as before the request.

#### Scenario: Posting a timed-out Overpass response
- **WHEN** a client re-imports a completed area with a payload whose `remark` reports a runtime error
- **THEN** the response is a 422 error with code `source_incomplete`, and the area's map data is still returned as before

### Requirement: The API SHALL import in the background and stream stages as server-sent events
`POST /import-areas` SHALL accept an optional `background: true`. The bounding box SHALL be validated as for a synchronous import, and the API SHALL answer 202 with `import_area_id` and `events_url` (`/import-areas/{id}/events`), then fetch (when no payload was posted) and import inside a job. While a background job runs for an area, a second import of that area, synchronous or background, SHALL be refused with a 409 error with code `import_in_progress`, whose details hold `import_area_id` and `events_url`. `GET /import-areas/{id}/events` SHALL stream one server-sent event per stage, each with an increasing `id`, the stage as `event`, and a JSON `data` carrying the area's `projection`: `fetched` (`element_count`), `ground` (`area_features`, `pois`), `roads` (`road_segments`, with generated cross-sections), `blocks`, `buildings` once per ring of 100 m around the rectangle's centre, nearest first (`ring`, `buildings`), and then `completed` (the import area) or `failed` (`code`, `message`, `details`, the code the synchronous import would have returned). The job SHALL run as one transaction committed only after every stage succeeds. The stream SHALL replay what the job has published, honoring `Last-Event-ID`, then follow it live and end after `completed` or `failed`; subscribers SHALL NOT affect the job. A job is kept for ten minutes after it ends. Without a job, the stream SHALL be a 404 error with code `import_job_not_found`.

#### Scenario: Stages arrive in dependency order
- **WHEN** a client posts a background import and opens the events stream
- **THEN** it receives `fetched`, `ground`, `roads`, `blocks`, one or more `buildings`, and `completed`, with ids 1, 2, 3, … and each stage's features

#### Scenario: Buildings arrive from the centre outward
- **WHEN** an area's buildings lie at several distances from the rectangle's centre
- **THEN** the `buildings` events carry ascending `ring` values, every building exactly once, and together they equal the buildings in the area's map data

#### Scenario: Resuming a stream
- **WHEN** a client reconnects with `Last-Event-ID: 2` after the job ended
- **THEN** it receives exactly the events with ids 3 onward

#### Scenario: A failure leaves the area as it was
- **WHEN** a stage fails during a background import of an area that already has a completed import
- **THEN** the stream ends with a `failed` event, and the area's status, counts, and map data are exactly what they were before

#### Scenario: A second import while one runs
- **WHEN** a client imports an area whose background import is still running
- **THEN** the response is a 409 error with code `import_in_progress` naming the area and its `events_url`

## MODIFIED Requirements

### Requirement: The API SHALL import fixture data for a bounding box
The API SHALL accept `POST /import-areas` with a bounding box (min/max latitude and longitude) and an optional payload, SHALL import it under the `osm` provider, and SHALL run the import synchronously. Without a payload, the API SHALL fetch the bounding box live from Overpass, after validating the box, and import the response. If Overpass is unavailable the response SHALL be a 503 error with code `upstream_unavailable`, and if its response is incomplete a 502 error with code `source_incomplete`. In both cases no import area SHALL be created or changed. A re-import of the same bounding box SHALL reconcile the area with the new payload. A successful response SHALL return the import area's id, provider, bounding box, status, and the counts of imported roads, navigable nodes, buildings, POIs, area features, derived blocks, and buildings linked to a block.

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

#### Scenario: Live import without a payload
- **WHEN** a client posts a valid bounding box and no payload
- **THEN** the API fetches that box from Overpass, imports it, and responds as for a posted payload

#### Scenario: Overpass unavailable
- **WHEN** a client posts a bounding box without a payload and Overpass is unavailable
- **THEN** the response is a 503 error with code `upstream_unavailable` and no import area is created

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
