# osm-fixture-ingestion Specification

## Purpose

Imports supported OpenStreetMap fixture data into the project's normalized geographic model without leaking provider-specific tags beyond the ingestion boundary.

## Requirements

### Requirement: The system SHALL translate supported OSM features into normalized geographic entities
The system SHALL accept a deterministic OSM fixture containing nodes, ways, and relations, and SHALL translate only supported feature types into the application's street, road, navigable-node, building, point-of-interest, and area-feature entities. Raw OSM tags and element shapes SHALL NOT be returned by the ingestion result or persisted as application behavior.

#### Scenario: Supported mixed fixture is imported
- **WHEN** an import is run with a fixture containing supported road, building, POI, and park features
- **THEN** the system persists their corresponding normalized entities under the target import area and reports their counts

#### Scenario: Unsupported OSM feature is present
- **WHEN** an otherwise valid fixture contains a feature outside the supported initial domain
- **THEN** the system does not create an application entity for that feature and continues the import

### Requirement: The system SHALL derive directed street segments from supported road ways
The system SHALL translate a supported highway way into a normalized street/road representation, navigable endpoint and intersection nodes, and directed road segments. Segment direction and vehicle accessibility SHALL honor the supported one-way semantics.

#### Scenario: Bidirectional road way
- **WHEN** a supported road way is not one-way
- **THEN** the system creates traversable directed segments in both travel directions

#### Scenario: One-way road way
- **WHEN** a supported road way is marked one-way
- **THEN** the system creates traversable directed segments only in the permitted direction

### Requirement: The system SHALL preserve supported lane-count semantics per directed segment
The system SHALL translate supported lane-count tags into the `lane_count` of each directed road segment. A missing or unusable lane-count value SHALL remain unknown rather than being converted to zero.

#### Scenario: Forward and backward lane counts are provided
- **WHEN** a bidirectional source way provides distinct forward and backward lane counts
- **THEN** segments in each travel direction receive the count that corresponds to that direction

#### Scenario: Lane count is absent
- **WHEN** a supported road way has no usable lane-count tag
- **THEN** its directed segments have an unknown lane count

### Requirement: The system SHALL apply supported source turn restrictions to intersection movements
The system SHALL generate candidate turn movements for imported road segments and SHALL apply supported no-turn and only-turn source restrictions to the matching movements. A source restriction that cannot be resolved to imported segments SHALL fail the import with an actionable error.

#### Scenario: Prohibited right turn
- **WHEN** a fixture contains a supported no-right-turn relation for an imported intersection
- **THEN** the matching right-turn movement is persisted as prohibited with its restriction kind

#### Scenario: Only-turn restriction
- **WHEN** a fixture contains a supported only-turn relation for an imported intersection
- **THEN** the specified movement remains allowed and competing applicable movements from the same incoming segment are persisted as prohibited

### Requirement: The system SHALL make fixture imports idempotent and report their outcome
The system SHALL reuse the import area identified by the provider and bounding box, upsert supported source entities without duplicates, and return an import result containing the reused import area and counts of imported entity types. If import processing fails, the system SHALL not report success and SHALL record the import area as failed.

#### Scenario: Same fixture is imported twice
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** the second import reuses the original import area and does not duplicate source entities

#### Scenario: Malformed supported source data
- **WHEN** a supported OSM feature is malformed or references a required missing member
- **THEN** the system returns an actionable ingestion error and marks the import area as failed
