## ADDED Requirements

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
