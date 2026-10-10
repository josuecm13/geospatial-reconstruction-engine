## ADDED Requirements

### Requirement: A background import SHALL run an elevation stage before it completes
After a background import has committed and the area is named, and before `completed`, the import SHALL run an `elevation` stage. Its event data SHALL carry the area's `projection`, the map-data `elevation` object (or null), and `error` (null or a code). On success, `elevation` SHALL be the grid and `error` SHALL be null. When the terrain source is unavailable, the stage SHALL still be emitted with `elevation: null` and `error: "elevation_unavailable"`, and the import SHALL continue to `completed`. The import's own stages and their order SHALL be unchanged.

#### Scenario: Elevation succeeds
- **WHEN** a background import of a box is streamed and the terrain source answers
- **THEN** the stream carries `fetched`, `ground`, `roads`, `blocks`, one or more `buildings`, `elevation` with the grid, and `completed`, in that order

#### Scenario: The terrain source is unavailable
- **WHEN** a background import is streamed and the terrain source fails
- **THEN** the stream carries an `elevation` event with `elevation: null` and `error: "elevation_unavailable"`, and then `completed`, and the import is stored as completed

### Requirement: A synchronous import SHALL run elevation and keep answering as before
A synchronous import (`background: false`) SHALL run elevation after the import has committed. A terrain source failure SHALL be logged, and the import SHALL answer as it did before elevation existed.

#### Scenario: Synchronous import with the source down
- **WHEN** a synchronous import is requested and the terrain source fails
- **THEN** the import answers with its normal success response, and the failure is logged
