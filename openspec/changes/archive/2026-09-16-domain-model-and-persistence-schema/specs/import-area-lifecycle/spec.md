## Purpose

Tracks the lifecycle of an import area identified by its provider and bounding box, so re-running an import against the same area updates existing data instead of duplicating it.

## ADDED Requirements

### Requirement: Import area identity SHALL be unique per provider and bounding box
The system SHALL treat an import area's `(provider, bounding box)` pair as its identity. Requesting an import for a bounding box that already has an import area for that provider SHALL reuse the existing import area rather than creating a new one.

#### Scenario: First import of a new bounding box
- **WHEN** an import is requested for a provider and bounding box with no existing import area
- **THEN** the system creates a new import area for that provider and bounding box

#### Scenario: Re-importing the same bounding box
- **WHEN** an import is requested for a provider and bounding box that already has an import area
- **THEN** the system reuses the existing import area instead of creating a second one

### Requirement: Import area SHALL track status and result counts
The system SHALL record an import area's status (e.g. pending, importing, completed, failed) and, once an import completes, the count of each entity type produced for that area.

#### Scenario: A newly created import area starts pending
- **WHEN** a new import area is created
- **THEN** its status is a non-terminal state indicating the import has not yet completed

#### Scenario: Completing an import records counts
- **WHEN** an import for an import area finishes successfully
- **THEN** the import area's status becomes completed and its per-entity-type counts are populated
