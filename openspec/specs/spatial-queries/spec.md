# spatial-queries Specification

## Purpose

Answers spatial questions about imported geographic entities — what is near a coordinate, what falls inside a bounding box, how large a footprint is, and which navigable node or segment is closest — in meter-based units and normalized domain models.

## Requirements

### Requirement: Spatial queries SHALL be scoped to a single import area
Every spatial query SHALL take an import area and SHALL only consider entities belonging to it, so results from separately imported areas never mix. A query naming an import area that does not exist SHALL fail with an actionable error rather than returning an empty result.

#### Scenario: Two import areas hold entities at overlapping coordinates
- **WHEN** a spatial query runs against one import area while another import area contains entities at nearby coordinates
- **THEN** only entities belonging to the queried import area are returned

#### Scenario: Unknown import area
- **WHEN** a spatial query names an import area that does not exist
- **THEN** the system returns an actionable error identifying the unknown import area

### Requirement: Radius queries SHALL be expressed and evaluated in meters
The system SHALL find entities within a given radius of a coordinate, with the radius given in meters and evaluated as a geodesic distance rather than a degree-based approximation. Supported entity types SHALL include navigable nodes, points of interest, buildings, and area features.

#### Scenario: Entity inside the radius
- **WHEN** an entity lies at a geodesic distance smaller than the requested radius from the query coordinate
- **THEN** the query returns that entity

#### Scenario: Entity outside the radius
- **WHEN** an entity lies at a geodesic distance greater than the requested radius from the query coordinate
- **THEN** the query does not return that entity

#### Scenario: No entity within the radius
- **WHEN** no entity of the requested type lies within the radius
- **THEN** the query returns an empty result rather than an error

### Requirement: Bounding-box queries SHALL distinguish intersection from containment
The system SHALL support querying entities whose geometry intersects a bounding box and, separately, entities whose geometry is fully contained by it.

#### Scenario: Geometry straddling the boundary
- **WHEN** an entity's geometry crosses the edge of the query bounding box
- **THEN** the intersection query returns it and the containment query does not

#### Scenario: Geometry fully inside
- **WHEN** an entity's geometry lies entirely inside the query bounding box
- **THEN** both the intersection query and the containment query return it

### Requirement: Building footprint area SHALL be reported in square meters
The system SHALL report a building's footprint area as a geodesic area in square meters, computed from its persisted polygon.

#### Scenario: Footprint area of a known building
- **WHEN** the footprint area of a persisted building is requested
- **THEN** the system returns its geodesic area in square meters

### Requirement: Nearest-navigable lookup SHALL return the closest candidate by meter distance
The system SHALL return the navigable node, and separately the road segment, closest to a given coordinate within an import area, measured geodesically. When the import area contains no candidate, the lookup SHALL report the absence rather than failing.

#### Scenario: Several candidates at different distances
- **WHEN** an import area contains several navigable nodes at different distances from the query coordinate
- **THEN** the lookup returns the geodesically closest one

#### Scenario: Import area with no navigable nodes
- **WHEN** a nearest-node lookup runs against an import area holding no navigable nodes
- **THEN** the lookup reports that no candidate exists rather than returning an arbitrary entity or failing

### Requirement: Spatial queries SHALL return normalized domain models
Spatial query results SHALL be the project's domain entities. Persistence rows, SQLAlchemy models, geometry library objects, and provider-specific structures SHALL NOT be returned to callers.

#### Scenario: Result type of a radius query
- **WHEN** a radius query returns buildings
- **THEN** each result is the project's `Building` domain entity, not a persistence row

### Requirement: Invalid spatial query parameters SHALL be rejected with actionable errors
The system SHALL reject a query whose radius is negative or zero, or whose coordinates are outside valid latitude/longitude ranges, with an error naming the offending parameter.

#### Scenario: Negative radius
- **WHEN** a radius query is issued with a negative radius
- **THEN** the system returns an actionable error naming the radius parameter and performs no query

#### Scenario: Out-of-range coordinate
- **WHEN** a query coordinate has a latitude outside [-90, 90]
- **THEN** the system returns an actionable error naming the coordinate
