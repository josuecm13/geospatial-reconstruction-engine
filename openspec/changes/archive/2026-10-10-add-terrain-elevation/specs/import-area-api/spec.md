## ADDED Requirements

### Requirement: The API SHALL return an import area's elevation grid on its map data
`GET /import-areas/{id}/map-data`, in both modes and with a `boundary_id`, SHALL carry a top-level `elevation` object. When the area has no grid, because it has not been analysed or its source was unavailable, `elevation` SHALL be null. Otherwise it SHALL carry the source (`aws-terrain-tiles`), the terrain attribution string, the grid version, the smoothing radius in metres, and the grid: its south-west origin latitude and longitude, its latitude and longitude steps, its row and column counts, and its heights as a flat array of rows × cols values, row-major from south to north and west to east, in metres rounded to 0.1. The grid SHALL be the whole area's, even when the response is scoped to a boundary. In a composed area, the grid SHALL be the requested area's own. The existing top-level OpenStreetMap attribution SHALL be unchanged.

#### Scenario: An analysed area
- **WHEN** a client requests map data for an area with a stored grid
- **THEN** `elevation` carries the source, attribution, version, smoothing radius, and the full grid with its origin, steps, size, and heights

#### Scenario: An area without a grid
- **WHEN** a client requests map data for an area that has not been analysed
- **THEN** `elevation` is null, and every feature's elevation is null

#### Scenario: A boundary-scoped request
- **WHEN** a client requests map data for an area with a `boundary_id`
- **THEN** `elevation` carries the grid of the whole area, not only the boundary's extent

### Requirement: Building and road-segment features SHALL carry their derived heights
Building features SHALL carry `base_elevation_meters`, a number or null when the building has no stored base. Road-segment features SHALL carry `elevation_exact` and `elevation_smoothed`, each either null or an array with one number per vertex of the feature's geometry, in the geometry's order. In clip mode, a clipped segment's arrays SHALL be re-sampled from the stored grid at the clipped vertices: the exact array from the raw grid and the smoothed array from the smoothed grid.

#### Scenario: A building with a stored base
- **WHEN** a client requests map data for an analysed area containing a building with a stored base of 10.2 metres
- **THEN** that building feature carries `base_elevation_meters: 10.2`

#### Scenario: A road segment with stored heights
- **WHEN** a client requests map data for a road segment whose geometry has three vertices
- **THEN** its feature carries `elevation_exact` and `elevation_smoothed`, each with three numbers

#### Scenario: A clipped road segment
- **WHEN** a client requests map data in clip mode for a segment cut by the boundary
- **THEN** the arrays have one value per vertex of the clipped geometry, sampled from the stored grid at those vertices

### Requirement: The API SHALL re-analyse an import area's elevation in the background
`POST /import-areas/{id}/elevation` SHALL start a background re-analysis of a completed import area and SHALL answer 202 with `import_area_id` and `events_url` (`/import-areas/{id}/events`), in the same shape as a background import. The re-analysis SHALL publish one `elevation` event, then `completed` or `failed`, on the area's existing event stream. A source failure during the re-analysis SHALL be a `failed` event with code `elevation_unavailable`. The request SHALL fail with 404 `import_area_not_found` when the area does not exist, with 409 `import_area_not_ready` when the area is not `completed`, and with 409 `import_in_progress` when a job for the area is running, using the same registry and error as imports. When elevation is disabled (`ELEVATION_URL=off`), the request SHALL fail at once with 503 `elevation_unavailable` and start no job.

#### Scenario: Re-analysing a completed area
- **WHEN** a client posts to `/import-areas/{id}/elevation` for a completed area with no running job
- **THEN** the API answers 202 with `import_area_id` and `events_url`, and the event stream later carries one `elevation` event and then `completed`

#### Scenario: An unknown area
- **WHEN** a client posts to `/import-areas/{id}/elevation` for an id that does not exist
- **THEN** the API answers 404 with code `import_area_not_found`

#### Scenario: An area that is not completed
- **WHEN** a client posts to `/import-areas/{id}/elevation` for an area that is importing or failed
- **THEN** the API answers 409 with code `import_area_not_ready`

#### Scenario: A job already running
- **WHEN** a client posts to `/import-areas/{id}/elevation` while an import or re-analysis job for the area is running
- **THEN** the API answers 409 with code `import_in_progress`

#### Scenario: Elevation is disabled
- **WHEN** a client posts to `/import-areas/{id}/elevation` while elevation is disabled
- **THEN** the API answers 503 with code `elevation_unavailable`, no job starts, and no stored grid or derived height changes

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
- **WHEN** a client posts a bounding box whose minimum is not strictly below its maximum, whose coordinates are out of range, or whose area exceeds 10 km²
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

#### Scenario: Import area is named after its place
- **WHEN** an import succeeds and a reverse geocoder names the box's centre
- **THEN** the response, and every later response for that area, carries `place_name` and `place_context` (for example `Mitte` and `Berlin, Germany`), and a re-import looks them up again

#### Scenario: Place lookup fails
- **WHEN** an import succeeds but the reverse geocoder is disabled, unreachable, or has no answer
- **THEN** the import still succeeds, `place_name` and `place_context` are null (or keep their earlier values on a re-import), and no error is reported

#### Scenario: Overpass unavailable
- **WHEN** a client posts a bounding box without a payload and Overpass is unavailable
- **THEN** the response is a 503 error with code `upstream_unavailable` and no import area is created
