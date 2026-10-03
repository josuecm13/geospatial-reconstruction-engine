# osm-fixture-ingestion Specification

## Purpose

Imports supported OpenStreetMap fixture data into the project's normalized geographic model without leaking provider-specific tags beyond the ingestion boundary.
## Requirements
### Requirement: The system SHALL translate supported OSM features into normalized geographic entities
The system SHALL accept a deterministic OSM fixture containing nodes, ways, and relations, and SHALL translate only supported feature types into the application's street, road, navigable-node, building, point-of-interest, and area-feature entities. Raw OSM tags and element shapes SHALL NOT be returned by the ingestion result or persisted as application behavior.

#### Scenario: Supported mixed fixture is imported
- **WHEN** an import is run with a fixture containing supported road, building, POI, and park features
- **THEN** the system persists their corresponding normalized entities under the target import area and reports their counts

#### Scenario: Unsupported OSM feature is present
- **WHEN** an otherwise valid fixture contains a feature outside the supported initial domain
- **THEN** the system does not create an application entity for that feature and continues the import

### Requirement: The system SHALL derive directed street segments from supported road ways
The system SHALL translate a supported highway way into a normalized street/road representation, navigable endpoint and intersection nodes, and directed road segments. Segment direction and vehicle accessibility SHALL honor the supported one-way semantics.

#### Scenario: Bidirectional road way
- **WHEN** a supported road way is not one-way
- **THEN** the system creates traversable directed segments in both travel directions

#### Scenario: One-way road way
- **WHEN** a supported road way is marked one-way
- **THEN** the system creates traversable directed segments only in the permitted direction

### Requirement: The system SHALL preserve supported lane-count semantics per directed segment
The system SHALL translate supported lane-count tags into the `lane_count` of each directed road segment. A missing or unusable lane-count value SHALL remain unknown rather than being converted to zero.

#### Scenario: Forward and backward lane counts are provided
- **WHEN** a bidirectional source way provides distinct forward and backward lane counts
- **THEN** segments in each travel direction receive the count that corresponds to that direction

#### Scenario: Lane count is absent
- **WHEN** a supported road way has no usable lane-count tag
- **THEN** its directed segments have an unknown lane count

### Requirement: The system SHALL apply supported source turn restrictions to intersection movements
The system SHALL generate candidate turn movements for imported road segments and SHALL apply supported no-turn and only-turn source restrictions to the matching movements. A source restriction that is malformed (missing its from, via-node, or to member, or carrying an unsupported restriction value), that references a way or via node the payload doesn't hold as a supported road or node, or that doesn't resolve to exactly one legal turn at its via node SHALL be skipped without failing the import. The import result SHALL report the number of skipped restrictions, and the system SHALL log their source ids.

#### Scenario: Prohibited right turn
- **WHEN** a fixture contains a supported no-right-turn relation for an imported intersection
- **THEN** the matching right-turn movement is persisted as prohibited with its restriction kind

#### Scenario: Only-turn restriction
- **WHEN** a fixture contains a supported only-turn relation for an imported intersection
- **THEN** the specified movement remains allowed and competing applicable movements from the same incoming segment are persisted as prohibited

#### Scenario: A restriction missing its to way
- **WHEN** a fixture contains a valid no-left-turn relation and a no-right-turn relation with only from and via members
- **THEN** the import completes, the left turn is persisted as prohibited, and the result reports one skipped restriction

### Requirement: The system SHALL make fixture imports idempotent and report their outcome
The system SHALL reuse the import area identified by the provider and bounding box and SHALL reconcile the area's stored entities with the payload: supported source entities are upserted without duplicates, and every navigable node, street, road, road segment, turn movement, building, POI, and area feature of that area which the payload no longer produces SHALL be removed, so that after a successful import the area holds exactly what the payload produces. Entities produced by both the previous and the current payload SHALL keep their identifiers. The import result SHALL contain the reused import area and counts of the imported entity types, and the counts recorded on the import area SHALL equal the number of stored entities of each type. If import processing fails, the system SHALL not report success, SHALL leave the area's previously stored entities unchanged, and SHALL record the import area as failed.

#### Scenario: Same fixture is imported twice
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** the second import reuses the original import area, does not duplicate source entities, and every entity keeps its identifier

#### Scenario: Re-import with entities removed from the payload
- **WHEN** an area is re-imported with a payload that no longer contains a building and a road way that the previous payload contained
- **THEN** that building, that road, and the road's segments and turn movements are no longer stored for the area, the recorded counts match the stored entities, and a route that required the removed road is no longer found

#### Scenario: Restriction removed from the payload
- **WHEN** an area is re-imported with a payload that no longer contains a turn-restriction relation the previous payload contained
- **THEN** the movement that relation prohibited is persisted as allowed

#### Scenario: Malformed supported source data
- **WHEN** a supported OSM feature is malformed or references a required missing member
- **THEN** the system returns an actionable ingestion error and marks the import area as failed

#### Scenario: Failed re-import keeps previous data
- **WHEN** a re-import of a completed area fails
- **THEN** the area's previously stored entities are unchanged and the area is recorded as failed

### Requirement: Imported features SHALL belong to the import area's bounding box
The system SHALL reject a payload containing a supported road, building, area feature, or POI mapped as an area whose coordinate envelope does not intersect the import area's bounding box, or a supported POI mapped as a node located outside it. The rejection SHALL fail the import with an actionable error naming offending source ids, and SHALL record the import area as failed. A feature that crosses the bounding-box edge SHALL be accepted, including a POI area whose representative point falls outside the box.

#### Scenario: Road crossing the bounding-box edge
- **WHEN** a payload contains a road way that starts inside the bounding box and ends outside it
- **THEN** the import accepts the road

#### Scenario: Feature entirely outside the bounding box
- **WHEN** a payload contains a building whose footprint lies entirely outside the bounding box
- **THEN** the import fails with an error naming that building's source id and the import area is recorded as failed

#### Scenario: POI area crossing the bounding-box edge
- **WHEN** a payload contains a POI mapped as an area whose footprint crosses the bounding-box edge and whose center lies outside the box
- **THEN** the import accepts the POI

### Requirement: The system SHALL record a building's source height and level count, keeping unknown as unknown
When a supported building carries a height or a level count in the source, the system SHALL persist the height in meters and the level count as a whole number. A height SHALL be accepted as a number optionally suffixed by meters, or as feet converted to meters. A level count SHALL be accepted as a whole non-negative number. A missing, unparseable, non-positive height, or a non-whole or negative level count, SHALL be stored as unknown (null), never as zero or a substituted default, and SHALL NOT fail the import. A re-import SHALL update a building's height and level count in place, keeping its identifier.

#### Scenario: Height, levels, and neither
- **WHEN** an import contains one building tagged with a height of `12 m`, one tagged only with `3` levels, and one tagged with neither
- **THEN** the first stores a height of 12 meters and an unknown level count, the second stores an unknown height and 3 levels, and the third stores both as unknown

#### Scenario: An unparseable height
- **WHEN** an import contains a building whose height is `tall`
- **THEN** the import succeeds and the building's height is unknown

#### Scenario: Height in feet
- **WHEN** an import contains a building whose height is `40 ft`
- **THEN** the building stores a height of 12.192 meters

#### Scenario: A changed height on re-import
- **WHEN** an area is re-imported with a payload in which a building's height changed
- **THEN** the building keeps its identifier and stores the new height

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

### Requirement: Link and living-street ways SHALL join the road network
A `motorway_link`, `trunk_link`, `primary_link`, `secondary_link`, or `tertiary_link` way SHALL be imported as a road of its parent class (motorway, trunk, primary, secondary, or tertiary), and a `living_street` way SHALL be imported as a residential road, so that none of them is dropped and they receive that class's generated cross-section.

#### Scenario: Routing across a slip road
- **WHEN** two primary roads connected only by a `primary_link` way are imported
- **THEN** a route from one road to the other is found across the link

### Requirement: A roundabout SHALL be one-way in its drawn direction unless tagged otherwise
A road way tagged `junction=roundabout` without a `oneway` tag SHALL be imported as one-way in the direction its nodes are drawn. An explicit `oneway` tag on the way SHALL take precedence.

#### Scenario: An untagged roundabout
- **WHEN** a road way tagged `junction=roundabout` and no `oneway` tag is imported
- **THEN** it produces only the segment in its drawn direction

#### Scenario: An explicit oneway wins
- **WHEN** a road way tagged `junction=roundabout` and `oneway=no` is imported
- **THEN** it is imported as two-way

### Requirement: Reversible and alternating one-way roads SHALL import as two-way
A road way tagged `oneway=reversible` or `oneway=alternating` SHALL be imported as two-way, because each direction is legal at some time and the road graph holds no time-dependent access. Such a way SHALL NOT fail the import. Any other unsupported `oneway` value SHALL still fail it.

#### Scenario: A reversible road
- **WHEN** an import contains a road way tagged `oneway=reversible`
- **THEN** the import completes and the road has segments in both directions

### Requirement: Vehicle-scoped restrictions SHALL apply only when they bind a car
A restriction relation's plain `restriction` tag SHALL take precedence. Without one, the system SHALL use `restriction:motorcar`, then `restriction:motor_vehicle`, then `restriction:vehicle`, the most specific first. A restriction relation tagged only with other vehicle-scoped keys (for example `restriction:bus` or `restriction:hgv`) SHALL be skipped without failing the import. A restriction relation with no restriction tag at all SHALL still fail it.

#### Scenario: A bus-only restriction
- **WHEN** an import contains a restriction relation tagged only `restriction:bus=no_left_turn`
- **THEN** the import completes and no movement is prohibited by it

#### Scenario: A car-scoped restriction
- **WHEN** an import contains a restriction relation tagged only `restriction:motorcar=no_left_turn`
- **THEN** the corresponding movement is prohibited

### Requirement: Multipolygon buildings and areas SHALL import as their outer rings
A `type=multipolygon` relation carrying a building tag or a supported area-feature tag SHALL be imported as one building or area feature per closed outer ring. Outer members SHALL be joined end to end in either drawing direction, taking their points from the member's inline geometry or else from the member way's nodes. Inner rings SHALL be ignored. A multipolygon whose outer rings can't be closed from the payload SHALL be skipped without failing the import. Each feature's source identity SHALL be distinct from any way's, and stable across re-imports.

#### Scenario: A building mapped as a multipolygon
- **WHEN** an import contains a multipolygon relation tagged `building=yes` whose outer ring is split across two member ways
- **THEN** one building is imported with the joined ring as its footprint, and a re-import keeps its identifier

#### Scenario: An incomplete multipolygon
- **WHEN** an import contains a multipolygon building whose outer member is missing from the payload
- **THEN** the import completes without that building

