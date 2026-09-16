## Purpose

Ensures every geographic area accepted by the system is a well-formed WGS84 bounding box no larger than 1 km × 1 km, so later import and ingestion work always operates on a bounded, meter-measurable area.

## ADDED Requirements

### Requirement: Bounding box coordinates SHALL be valid WGS84 values
A candidate bounding box is defined by a minimum (southwest) and maximum (northeast) coordinate pair. The system SHALL reject a bounding box whose latitude is outside [-90, 90], whose longitude is outside [-180, 180], or whose minimum coordinate is not strictly less than its maximum coordinate on each axis.

#### Scenario: Valid coordinates within range and correctly ordered
- **WHEN** a bounding box is submitted with min (lat 30.0, lon -97.8) and max (lat 30.01, lon -97.79)
- **THEN** the system accepts the bounding box as structurally valid

#### Scenario: Latitude or longitude out of range
- **WHEN** a bounding box is submitted with a latitude or longitude outside the valid WGS84 range
- **THEN** the system rejects it with an error identifying which coordinate and axis is invalid

#### Scenario: Minimum coordinate not less than maximum
- **WHEN** a bounding box is submitted where the minimum latitude or longitude is greater than or equal to the corresponding maximum
- **THEN** the system rejects it with an error indicating the coordinates are inverted or degenerate

### Requirement: Bounding box area SHALL NOT exceed 1 km × 1 km
Given a structurally valid bounding box, the system SHALL compute its ground area using meter-based (geodesic) measurement and SHALL reject the bounding box if that area exceeds 1 square kilometer (equivalent to a 1 km × 1 km bound).

#### Scenario: Bounding box within the size limit
- **WHEN** a structurally valid bounding box has a computed area of 1 square kilometer or less
- **THEN** the system accepts the bounding box

#### Scenario: Bounding box exceeds the size limit
- **WHEN** a structurally valid bounding box has a computed area greater than 1 square kilometer
- **THEN** the system rejects it with an error stating the computed area and the maximum allowed area
