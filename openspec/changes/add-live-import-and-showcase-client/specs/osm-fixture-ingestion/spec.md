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
