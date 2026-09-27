## ADDED Requirements

### Requirement: Each block SHALL have a buildable area net of its bounding roads
The system SHALL record, for each derived block, a buildable area equal to the block's boundary minus each bounding road segment buffered by half of that road's generated street width, and the buildable area's size in square meters. A block whose buildable area is empty, or is nowhere at least `MIN_BUILDABLE_WIDTH_METERS` wide, SHALL be kept and flagged as a median.

#### Scenario: Buildable area is smaller by the bounding roads' half-widths
- **WHEN** a fixture whose roads form a closed loop is imported
- **THEN** the loop's block has a buildable area smaller than its centerline area by the strips of half the bounding roads' generated widths

#### Scenario: A divided road's median is flagged
- **WHEN** a fixture whose divided road's two carriageways enclose a thin strip is imported
- **THEN** the strip's block is flagged as a median, and blocks with room to build are not

### Requirement: Blocks along the import bounding box SHALL be closed against it and flagged as clipped
The system SHALL close faces between road segments and the import area's bounding box against the box, derive them as blocks, and flag them as clipped by the import area. A face along the bounding box SHALL be a block only if a road segment crossing the bounding box bounds it. A face outside the bounding box SHALL NOT be a block.

#### Scenario: Roads crossing the bounding box yield edge blocks
- **WHEN** a fixture whose roads cross the bounding-box edge is imported
- **THEN** the faces between those roads and the box are persisted as blocks flagged as clipped, and blocks closed by roads alone are not flagged

#### Scenario: Roads that never cross the edge add no edge block
- **WHEN** a fixture whose roads form a closed loop that stays inside the bounding box, or only touches its edge, is imported
- **THEN** the area has only the loop's block, not flagged as clipped

### Requirement: A block's id SHALL be derived from its bounding-segment set
The system SHALL derive a block's id deterministically from its import area and the set of its bounding road segments, so that re-deriving an unchanged network yields the same block ids.

#### Scenario: Unchanged re-import keeps block ids
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** every block has the same id after the second import as after the first

#### Scenario: Changing one road changes only the blocks it bounds
- **WHEN** an area is re-imported with one road changed so that its segments change
- **THEN** the blocks bounded by that road get new ids and every other block keeps its id

## MODIFIED Requirements

### Requirement: A block's bounding segments SHALL be recorded in order
The system SHALL record, for each block, the ordered sequence of road segments that form its boundary: those the block covers and those sharing a line with its boundary, ordered along its exterior ring. For a block not clipped by the bounding box, they form its closed boundary loop.

#### Scenario: Reconstructing a block's boundary
- **WHEN** a block not flagged as clipped has its bounding segments read back in their recorded order
- **THEN** they form a single continuous closed loop matching the block's boundary

#### Scenario: A clipped block records its road segments
- **WHEN** a block flagged as clipped has its bounding segments read back
- **THEN** they include every road segment that runs along its boundary, including segments that cross the bounding box

### Requirement: Re-deriving an import area's blocks SHALL replace them, not duplicate them
Running block derivation for an import area that already has blocks SHALL remove that area's existing blocks and their boundary-segment records, clear its buildings' block links, and then derive and link afresh, so the area's blocks always reflect its current road network exactly once. A re-derived block with an unchanged bounding-segment set SHALL keep its id. Blocks of other import areas SHALL NOT be affected.

#### Scenario: Same fixture imported twice
- **WHEN** the same fixture is imported twice for the same provider and bounding box
- **THEN** the import area has the same blocks, under the same ids, after the second import as after the first, and each building is linked to exactly one current block or none

#### Scenario: Another import area is untouched
- **WHEN** blocks are re-derived for one import area
- **THEN** the blocks and building links of every other import area are unchanged
