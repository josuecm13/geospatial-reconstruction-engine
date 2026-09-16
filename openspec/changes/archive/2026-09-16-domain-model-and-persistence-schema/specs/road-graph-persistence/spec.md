## Purpose

Persists the road graph — streets, roads, navigable nodes, and road segments — as domain-owned entities with idempotent upserts and unambiguous per-segment direction and lane data.

## ADDED Requirements

### Requirement: Road graph entities SHALL be uniquely identified per import area and source
Streets, roads, navigable nodes, and road segments SHALL be keyed by their source identity within their import area, so re-processing the same source data upserts existing rows instead of duplicating them.

#### Scenario: Re-processing the same source way
- **WHEN** the same source way is processed twice within the same import area
- **THEN** the system upserts the existing road rather than creating a duplicate

#### Scenario: Same source id in different import areas
- **WHEN** the same source id appears in two different import areas
- **THEN** the system persists two distinct entities, one per import area

### Requirement: A road segment SHALL represent exactly one direction of travel
A road segment's `from_node` and `to_node` SHALL define its single direction of travel. Its lane count SHALL describe lanes available in that direction only; it SHALL NOT carry a separate forward/backward pair.

#### Scenario: A two-way road produces two segments
- **WHEN** a two-way road is persisted
- **THEN** the system creates two road segments with opposite `from_node`/`to_node` pairs, one per direction

#### Scenario: A segment's lane count reflects its own direction
- **WHEN** a road segment is persisted with a known lane count for its direction of travel
- **THEN** that lane count is stored on the segment itself, with no forward/backward distinction

#### Scenario: An unknown lane count is stored as unknown, not zero
- **WHEN** a road segment's lane count is not known from the source
- **THEN** the system stores it as unknown (null) rather than as zero

### Requirement: A road segment's traversal distance SHALL be computed using meter-based measurement
The system SHALL compute each road segment's `distance_meters` using geodesic (meter-based) measurement of its geometry, not a flat coordinate approximation.

#### Scenario: Segment distance matches geodesic length
- **WHEN** a road segment is persisted
- **THEN** its stored `distance_meters` matches the geodesic length of its geometry
