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
The API SHALL expose `GET /import-areas/{id}/map-data` returning every road segment, navigable node, block, building, POI, and area feature persisted for that import area, as one GeoJSON `FeatureCollection` per entity type with `[longitude, latitude]` positions. Each feature SHALL carry its entity id and geometry. Road segments SHALL carry their endpoint node ids, distance, lane count, vehicle accessibility, and their street's name and classification as values, without exposing a street identifier. Buildings SHALL carry their category and linked block id (or null); blocks SHALL carry their area in square meters; POIs SHALL carry their category and name; area features SHALL carry their kind. The response SHALL carry an OpenStreetMap attribution string. No provider-specific tags or persistence-layer fields SHALL appear in the response.

#### Scenario: Map data after an import
- **WHEN** a client requests map data for a completed import area
- **THEN** the numbers of navigable nodes, buildings, POIs, area features, and blocks returned equal the area's recorded counts, and buildings inside a derived block reference that block's id

#### Scenario: Attribution is present
- **WHEN** a client requests map data for a completed import area
- **THEN** the response carries the OpenStreetMap attribution string

#### Scenario: Map data for an area that is not completed
- **WHEN** a client requests map data for an import area whose status is not `completed`, including one whose most recent re-import failed
- **THEN** the response is a 409 error with code `import_area_not_ready`
