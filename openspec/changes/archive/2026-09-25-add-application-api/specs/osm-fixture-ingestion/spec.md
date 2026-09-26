## MODIFIED Requirements

### Requirement: The system SHALL make fixture imports idempotent and report their outcome
The system SHALL reuse the import area identified by the provider and bounding box and SHALL reconcile the area's stored entities with the payload: supported source entities are upserted without duplicates, and every navigable node, street, road, road segment, turn movement, building, POI, and area feature of that area which the payload no longer produces SHALL be removed, so that after a successful import the area holds exactly what the payload produces. Entities produced by both the previous and the current payload SHALL keep their identifiers. The import result SHALL contain the reused import area and counts of the imported entity types, and the counts recorded on the import area SHALL equal the number of stored entities of each type. If import processing fails, the system SHALL not report success, SHALL leave the area's previously stored entities unchanged, and SHALL record the import area as failed.

#### Scenario: Same fixture is imported twice
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** the second import reuses the original import area, does not duplicate source entities, and every entity keeps its identifier

#### Scenario: Re-import with entities removed from the payload
- **WHEN** an area is re-imported with a payload that no longer contains a building and a road way that the previous payload contained
- **THEN** that building, that road, and the road's segments and turn movements are no longer stored for the area, the recorded counts match the stored entities, and a route that required the removed road is no longer found

#### Scenario: Restriction removed from the payload
- **WHEN** an area is re-imported with a payload that no longer contains a turn-restriction relation the previous payload contained
- **THEN** the movement that relation prohibited is persisted as allowed

#### Scenario: Malformed supported source data
- **WHEN** a supported OSM feature is malformed or references a required missing member
- **THEN** the system returns an actionable ingestion error and marks the import area as failed

#### Scenario: Failed re-import keeps previous data
- **WHEN** a re-import of a completed area fails
- **THEN** the area's previously stored entities are unchanged and the area is recorded as failed

## ADDED Requirements

### Requirement: Imported features SHALL belong to the import area's bounding box
The system SHALL reject a payload containing a supported road, building, or area feature whose coordinate envelope does not intersect the import area's bounding box, or a supported POI located outside it. The rejection SHALL fail the import with an actionable error naming offending source ids, and SHALL record the import area as failed. A feature that crosses the bounding-box edge SHALL be accepted.

#### Scenario: Road crossing the bounding-box edge
- **WHEN** a payload contains a road way that starts inside the bounding box and ends outside it
- **THEN** the import accepts the road

#### Scenario: Feature entirely outside the bounding box
- **WHEN** a payload contains a building whose footprint lies entirely outside the bounding box
- **THEN** the import fails with an error naming that building's source id and the import area is recorded as failed
