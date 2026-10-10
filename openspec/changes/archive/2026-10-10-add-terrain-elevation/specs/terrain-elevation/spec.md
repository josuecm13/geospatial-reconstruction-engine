## Purpose

Gives every import area a single record of its ground elevation, from which building bases and road heights are derived, so that buildings sit on slopes and roads read as streets.

## ADDED Requirements

### Requirement: The system SHALL fetch and decode terrain tiles for an import area's box
The system SHALL fetch every elevation tile at zoom 15 that the area's bounding box touches, plus a one-pixel margin, from the configured tile source (no key required), and SHALL decode each pixel's height in metres as the red times 256, plus green, plus blue divided by 256, minus 32768. The system SHALL sample each grid point bilinearly in the zoom-15 pixels at that point's Web Mercator coordinate. Heights SHALL be metres above sea level.

#### Scenario: A box touching several tiles
- **WHEN** the system analyses an area whose box touches four zoom-15 tiles
- **THEN** it fetches all four tiles, plus the margin, and every grid sample is interpolated from them

#### Scenario: Decoding a known pixel
- **WHEN** a tile pixel has red 128, green 0, and blue 0
- **THEN** its height is 128 × 256 − 32768 = 0 metres

### Requirement: The system SHALL store an area's ground as a versioned grid
The system SHALL store one elevation grid per import area, aligned to the box in WGS84 with its origin at the south-west corner. Samples SHALL include both edges of the box, and the spacing SHALL be about 5 metres on each axis, clamped to between 2 and 256 samples per axis. Heights SHALL be stored as row-major values, row 0 at the south edge, west to east within each row. The grid SHALL record its source, its algorithm, its smoothing radius, and when it was analysed. Its version SHALL start at 1 and SHALL increase only when the stored heights, size, or origin change.

#### Scenario: First analysis
- **WHEN** an area that has no grid is analysed
- **THEN** the grid is stored with version 1

#### Scenario: Re-analysis that changes the ground
- **WHEN** a re-analysis produces heights, size, or origin different from the stored grid
- **THEN** the stored grid is replaced and its version increases by one

#### Scenario: Re-analysis that changes nothing
- **WHEN** a re-analysis produces the same heights, size, and origin as the stored grid
- **THEN** the stored grid and its version are unchanged

### Requirement: A building's base SHALL be the lowest ground under its footprint
The system SHALL compute each building's base elevation as the minimum of the grid sampled at the footprint's vertices and at every grid point inside the footprint. The base SHALL be stored for every building of an analysed area. The same rule SHALL apply to any building the system places later.

#### Scenario: A building on a slope
- **WHEN** a building's footprint spans ground that rises from 10 metres on its south side to 14 metres on its north side
- **THEN** its base elevation is 10 metres, so the uphill side sits below ground rather than the downhill side floating

#### Scenario: A flat footprint
- **WHEN** every grid point under a footprint is 12 metres
- **THEN** its base elevation is 12 metres

### Requirement: A road segment SHALL store exact and smoothed heights at each vertex
The system SHALL store, for every road segment of an analysed area, two heights per geometry vertex, in vertex order. The exact height SHALL be the grid sampled at the vertex. The smoothed height SHALL be the grid sampled at the vertex after the grid has been low-passed by a separable box blur of 30 metres radius, applied to the field rather than to each segment. The two arrays SHALL have the same length as the segment's geometry.

#### Scenario: Adjacent segments meet at a junction
- **WHEN** two road segments share a junction vertex
- **THEN** the smoothed height at that junction is the same value for both segments

#### Scenario: A segment that is flat on the ground
- **WHEN** the grid is constant under a segment
- **THEN** its exact and smoothed heights are equal at every vertex

### Requirement: Elevation SHALL be stored apart from the OSM-observed rows
The system SHALL store the grid, building bases, and road heights in tables of their own, keyed to the import area, building, and road segment they describe, with foreign keys that cascade on delete. No observed table SHALL gain an elevation column. Deleting an import area, or re-importing it, SHALL remove its grid and derived heights with the rows they describe.

#### Scenario: Deleting an import area
- **WHEN** an import area with a grid and derived heights is deleted
- **THEN** its grid, building bases, and road heights are removed with it

#### Scenario: Re-import sweeps away a building
- **WHEN** an analysed area is re-imported and a building that no longer exists in the source is removed by the sweep
- **THEN** that building's base elevation is removed with it, and no observed row gains or loses an elevation column

### Requirement: Re-analysis SHALL re-fetch no OSM data and SHALL be idempotent
Re-analysing an area SHALL fetch no OSM data, SHALL NOT change any entity id or geometry, and SHALL change nothing when the terrain source returns the same tiles. While a re-analysis runs, the area SHALL remain readable and SHALL be drawn flat.

#### Scenario: Running re-analysis twice
- **WHEN** an area is re-analysed, and then re-analysed again with the same source tiles
- **THEN** the second run changes no grid, no derived height, no entity id, and no geometry

#### Scenario: Reading while re-analysis runs
- **WHEN** a re-analysis is in progress and the area's map data is requested
- **THEN** the map data is returned with its previous elevation, or with no elevation if none was stored yet

### Requirement: Elevation SHALL never fail an import
An elevation failure, including the tile source being unavailable, SHALL NOT fail or roll back an import. The import SHALL complete with the area drawn flat, and the failure SHALL be logged for synchronous imports and reported as an event for background imports. The area SHALL be re-analysable later.

#### Scenario: The tile source is down during import
- **WHEN** the tile source fails during an import
- **THEN** the import completes, the area has no grid, and it can be analysed later

### Requirement: Tests and CI SHALL make no live terrain request
The tile source SHALL be replaceable, and the automated test suite SHALL use a stub source so that no request leaves the test environment.

#### Scenario: Running the suite offline
- **WHEN** the automated test suite runs with no network access
- **THEN** every elevation test passes using the stub source
