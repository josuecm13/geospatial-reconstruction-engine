# live-osm-import Specification

## Purpose
Lets a caller import a bounded real-world area straight from Overpass by selecting a box, and guarantees that a truncated, incomplete, or busy-server response never changes or deletes anything already stored.
## Requirements
### Requirement: The system SHALL fetch a bounding box from Overpass with only what ingestion reads
The system SHALL fetch a bounding box from an Overpass instance (the public instance by default, or one named by configuration) with a single JSON query for the nodes and ways in the box, the multipolygon relations touching it, and the turn restrictions whose via node is inside it, with their inline geometry. The query SHALL use the box's south, west, north, and east bounds, and SHALL carry a server-side timeout.

#### Scenario: The query for a box
- **WHEN** the system builds the query for a bounding box
- **THEN** it names the box as south, west, north, east, asks for multipolygon and via-node restriction relations only, and asks for inline geometry

### Requirement: The system SHALL fetch politely and fail distinctly
Every request SHALL send an identifying `User-Agent` and use a client timeout. Requests SHALL be sequential. A queue-full or busy answer (HTTP 429, 502, 503, or 504) SHALL be retried after a pause, honoring `Retry-After` up to a cap, a bounded number of times. Any other error status, a connection failure, a timeout, or busy on every attempt SHALL be reported as the source being unavailable. A 200 answer whose body is truncated, isn't a JSON object, or carries a `remark` SHALL be reported as incomplete. In either case nothing SHALL be imported or changed.

#### Scenario: Queue full, then success
- **WHEN** Overpass answers HTTP 429 with `Retry-After: 2`, then 200
- **THEN** the system waits 2 seconds, retries once, and returns the payload

#### Scenario: Busy on every attempt
- **WHEN** Overpass answers HTTP 504 to every attempt
- **THEN** the fetch fails as unavailable after the bounded retries

#### Scenario: A truncated body
- **WHEN** Overpass answers 200 with a body cut off mid-JSON
- **THEN** the fetch fails as incomplete

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
