## ADDED Requirements

### Requirement: The API SHALL scope spatial queries to a traced boundary on request
`GET /import-areas/{id}/nearby`, `/within-bbox`, and `/nearest` SHALL accept an optional `boundary_id` query parameter naming one of the import area's traced boundaries. With it, results SHALL be limited to entities intersecting that boundary; without it, the query SHALL behave exactly as before. `GET /import-areas/{id}/buildings/{building_id}/footprint-area` SHALL NOT take a boundary.

#### Scenario: Scoped and unscoped results
- **WHEN** a client runs the same query with and without the `boundary_id` of a boundary covering part of the area
- **THEN** the scoped response contains only the entities intersecting the boundary, and the unscoped one contains all of them

#### Scenario: Two boundaries select independently
- **WHEN** a client scopes the same query to each of two disjoint boundaries
- **THEN** the two results share no entity

#### Scenario: Unknown or foreign boundary
- **WHEN** a client passes a `boundary_id` that does not exist, or that belongs to another import area
- **THEN** the response is a 404 error with code `boundary_not_found`
