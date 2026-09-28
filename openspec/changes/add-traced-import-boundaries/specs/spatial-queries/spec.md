## ADDED Requirements

### Requirement: Spatial queries SHALL be narrowable to a traced boundary
Radius, bounding-box, and nearest-candidate queries SHALL accept an optional traced boundary of the queried import area. When one is given, only entities whose geometry intersects the boundary SHALL be considered, and every other rule of the query SHALL apply unchanged. A boundary that does not exist, or belongs to another import area, SHALL be rejected. The footprint-area query addresses one building by id and SHALL NOT take a boundary.

#### Scenario: Scoped radius query
- **WHEN** a radius query covering every entity of a kind is scoped to a boundary that covers only some of them
- **THEN** exactly the entities intersecting the boundary are returned, and the same query without a scope returns all of them

#### Scenario: Scoped nearest lookup
- **WHEN** the nearest node to a point is requested with a boundary that excludes the node closest to it
- **THEN** the closest node that intersects the boundary is returned

#### Scenario: Boundary of another import area
- **WHEN** a query on one import area is scoped to a boundary of another
- **THEN** the query is rejected as naming an unknown boundary
