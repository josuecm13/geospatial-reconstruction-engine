## ADDED Requirements

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
