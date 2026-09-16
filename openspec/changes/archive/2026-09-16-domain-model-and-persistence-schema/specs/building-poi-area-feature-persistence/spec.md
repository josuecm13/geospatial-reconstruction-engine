## Purpose

Persists buildings, points of interest, and area features as normalized domain entities with idempotent upserts, independent of the road graph.

## ADDED Requirements

### Requirement: Buildings, POIs, and area features SHALL be uniquely identified per import area and source
Each building, point of interest, and area feature SHALL be keyed by its source identity within its import area, so re-processing the same source data upserts existing rows instead of duplicating them.

#### Scenario: Re-processing the same building
- **WHEN** the same source building is processed twice within the same import area
- **THEN** the system upserts the existing building rather than creating a duplicate

#### Scenario: Re-processing the same point of interest
- **WHEN** the same source point of interest is processed twice within the same import area
- **THEN** the system upserts the existing point of interest rather than creating a duplicate

#### Scenario: Re-processing the same area feature
- **WHEN** the same source area feature is processed twice within the same import area
- **THEN** the system upserts the existing area feature rather than creating a duplicate

### Requirement: Each entity SHALL be persisted with a bounded classification category
Buildings, points of interest, and area features SHALL each be persisted with a category drawn from a fixed, system-defined set of values for their entity type.

#### Scenario: A building has a defined category
- **WHEN** a building is persisted
- **THEN** its category is one of the system's defined building categories

#### Scenario: A point of interest has a defined category
- **WHEN** a point of interest is persisted
- **THEN** its category is one of the system's defined point-of-interest categories

#### Scenario: An area feature has a defined kind
- **WHEN** an area feature is persisted
- **THEN** its kind is one of the system's defined area feature kinds
