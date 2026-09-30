## ADDED Requirements

### Requirement: The API SHALL report an incomplete source response distinctly
`POST /import-areas` SHALL respond to a payload rejected as incomplete with status 422 and code `source_incomplete`, distinct from `ingestion_failed`, and the area SHALL remain readable exactly as before the request.

#### Scenario: Posting a timed-out Overpass response
- **WHEN** a client re-imports a completed area with a payload whose `remark` reports a runtime error
- **THEN** the response is a 422 error with code `source_incomplete`, and the area's map data is still returned as before
