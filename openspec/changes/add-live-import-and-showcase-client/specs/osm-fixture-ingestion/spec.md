## ADDED Requirements

### Requirement: An incomplete source response SHALL never reach reconcile
The system SHALL reject a payload that carries an Overpass `remark` (as Overpass does when a query times out or runs out of memory) before the import area is created, marked importing, or reconciled. The rejection SHALL leave the area's stored entities, counts, and status exactly as they were.

#### Scenario: A timed-out response over an imported area
- **WHEN** an area that already holds imported entities is re-imported with a payload whose `elements` are empty and whose `remark` reports a runtime error
- **THEN** the import is rejected as incomplete, and the area's stored entities, recorded counts, and status are unchanged

#### Scenario: A remark on a first import
- **WHEN** a bounding box that has never been imported is imported with a payload carrying a `remark`
- **THEN** the import is rejected as incomplete and no import area is created

### Requirement: Way nodes given only as inline geometry SHALL be imported
When a way references a node that has no node element but the way carries an inline `geometry` array index-aligned with its nodes (as Overpass's `out geom` returns for nodes outside the query box), the system SHALL use that geometry's coordinates for the node. A node element that is present SHALL take precedence over inline geometry.

#### Scenario: A recorded live response
- **WHEN** a recorded Overpass response in which ways reference nodes outside the bounding box is imported
- **THEN** the import completes, and those ways are imported with their full geometry
