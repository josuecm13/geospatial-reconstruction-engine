## RENAMED Requirements

- FROM: `### Requirement: Bounding box area SHALL NOT exceed 1 km × 1 km`
- TO: `### Requirement: Bounding box area SHALL NOT exceed 10 km²`

## MODIFIED Requirements

### Requirement: Bounding box area SHALL NOT exceed 10 km²
Given a structurally valid bounding box, the system SHALL compute its ground area using meter-based (geodesic) measurement and SHALL reject the bounding box if that area exceeds 10 square kilometers (a limit on area, not on side length).

#### Scenario: Bounding box within the size limit
- **WHEN** a structurally valid bounding box has a computed area of 10 square kilometers or less
- **THEN** the system accepts the bounding box

#### Scenario: Bounding box exceeds the size limit
- **WHEN** a structurally valid bounding box has a computed area greater than 10 square kilometers
- **THEN** the system rejects it with an error stating the computed area and the maximum allowed area
