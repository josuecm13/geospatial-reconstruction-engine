# block-derivation

## Purpose

Derives enclosed block polygons from the persisted road graph and links buildings to the block that spatially contains them — the project's primary focus, since a block cannot be sourced directly from OSM.

## Requirements

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

### Requirement: Blocks SHALL be derived and buildings linked as part of every successful import
A successful import SHALL derive the import area's blocks from its persisted road segments and link its buildings to their containing blocks before the import area is recorded as `completed`, in the same unit of work as the import. Derivation SHALL run after the import has reconciled the area's road segments, so that no block is derived from, or bounded by, a segment the payload no longer produces. If derivation or linking fails, the import SHALL fail and the import area SHALL be recorded as `failed`. The import result SHALL report the number of derived blocks and the number of buildings linked to a block.

#### Scenario: Import of a fixture containing a closed road loop
- **WHEN** a fixture whose roads form a closed loop around a building is imported
- **THEN** the completed import area has one block for that loop and the building is linked to it, without any separate derivation call

#### Scenario: Import of a fixture with no closed loop
- **WHEN** a fixture whose roads form no closed loop is imported
- **THEN** the import completes with zero blocks and every building's block link unset

#### Scenario: Re-import removes a road that closed a loop
- **WHEN** an area whose roads formed a closed loop is re-imported with a payload missing one road of that loop
- **THEN** the area has no block for that loop and the building it contained has its block link unset

### Requirement: Re-deriving an import area's blocks SHALL replace them, not duplicate them
Running block derivation for an import area that already has blocks SHALL remove that area's existing blocks and their boundary-segment records, clear its buildings' block links, and then derive and link afresh, so the area's blocks always reflect its current road network exactly once. Blocks of other import areas SHALL NOT be affected.

#### Scenario: Same fixture imported twice
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** the import area has the same number of blocks after the second import as after the first, and each building is linked to exactly one current block or none

#### Scenario: Another import area is untouched
- **WHEN** blocks are re-derived for one import area
- **THEN** the blocks and building links of every other import area are unchanged
