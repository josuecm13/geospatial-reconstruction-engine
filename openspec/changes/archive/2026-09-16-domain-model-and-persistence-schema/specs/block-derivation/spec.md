## Purpose

Derives enclosed block polygons from the persisted road graph and links buildings to the block that spatially contains them — the project's primary focus, since a block cannot be sourced directly from OSM.

## ADDED Requirements

### Requirement: A block SHALL be derived from a closed loop of road segments, not imported directly
The system SHALL derive each block's boundary by finding closed loops formed by connected road segments within an import area. The system SHALL NOT record the unbounded area outside the road network as a block.

#### Scenario: A closed loop produces a block
- **WHEN** road segments within an import area form a closed loop
- **THEN** the system persists exactly one block whose boundary matches that loop

#### Scenario: The outer, unbounded area is not a block
- **WHEN** block derivation runs for an import area
- **THEN** the unbounded area outside all closed loops is not persisted as a block

### Requirement: A block's bounding segments SHALL be recorded in order
The system SHALL record, for each block, the ordered sequence of road segments that form its boundary loop.

#### Scenario: Reconstructing a block's boundary
- **WHEN** a block's bounding segments are read back in their recorded order
- **THEN** they form a single continuous closed loop matching the block's boundary

### Requirement: A building's containing block SHALL be determined by spatial containment
The system SHALL link a building to the block whose boundary spatially contains the building's geometry. A building not contained by any derived block SHALL have no linked block.

#### Scenario: A building inside a derived block
- **WHEN** a building's geometry lies within a block's boundary
- **THEN** the system links that building to that block

#### Scenario: A building outside every derived block
- **WHEN** a building's geometry is not contained by any derived block's boundary
- **THEN** the system leaves that building's block link unset rather than linking it to an incorrect block
