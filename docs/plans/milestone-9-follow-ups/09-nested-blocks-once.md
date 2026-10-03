# 09 — No duplicate blocks in two-level nesting (#111)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 111`

`BlockRepository.list_composable` can return the same block twice, so the outermost area's `map-data`
shows it twice. Make composition return each block once, with or without a re-import.

The claim holds against the current code. The exact conditions are worth stating, because they
decide what the test must do. Take three areas, O ⊃ M ⊃ I (outer, middle, inner):

- `list_composable(inner_area_ids, outer_area_id)`
  (`server/app/persistence/repositories/block.py:40-58`) drops an inner block only when a block of
  **`outer_area_id`** covers its point on surface. It never compares two composed areas with each
  other.
- `get_map_data` passes every completed area covered by O as `composed_area_ids`
  (`server/app/api/routers/import_areas.py:222-224`, via `completed_areas_covered_by`). Coverage is
  transitive, so both M and I are composed.
- When M was imported before I, M stores the centre block whole. I didn't exist yet, so nothing was
  skipped. I then stores the same block. When O is imported after M exists, O drops every face
  covered by M's box (`BlockDerivationService.derive_for_import_area`,
  `server/app/persistence/block_derivation.py:146-154`), so O holds no block there. O's `map-data`
  returns M's copy and I's copy: a duplicate.
- The orders that reproduce it are M, I, O and M, O, I. **A fully outside-in order (O, M, I) does
  not**: O was imported first and holds every block itself, so `held_by_outer` drops both inner
  copies. The issue asks for "a three-level nest imported outside-in". Read that as "the middle
  before the inner". A test of O, M, I alone passes against today's code and proves nothing.
- Features (buildings, POIs, area features) don't duplicate. `_composed` dedups them by source id
  (`import_areas.py:274-278`). Blocks have no source id, which is why they need a geometric rule.

## Code to read first

- `server/app/persistence/repositories/block.py` (96 lines): `list_composable` (lines 40-58), the
  `held_by_outer` `exists()` using `ST_Covers(outer.boundary, ST_PointOnSurface(BlockModel.boundary))`,
  the `is_clipped` filter, and the order `import_area_id, id`. `_list` (60-74) loads the boundary
  segments.
- `server/app/api/routers/import_areas.py`, `get_map_data` (207-271): blocks are
  `list_for_import_area(area.id)` followed by `list_composable(composed_area_ids, area.id)`
  (lines 231-235). The boundary scope filters by `in_scope.blocks` afterwards.
- `server/app/persistence/repositories/import_area.py:62-75`, `completed_areas_covered_by`: ordered
  by `min_latitude, min_longitude, id`. An area that covers another sorts no later than it, so
  `_composed` already lets M's copy of a feature win over I's.
- `server/app/persistence/block_derivation.py:136-154`: ids are assigned over every face before the
  covered ones are dropped.
- `server/app/persistence/models.py`: `BlockModel` (line 203) and `ImportAreaModel` (line 46, with
  its `bbox` geometry).
- `server/tests/api/test_nested_import_areas.py`: the 4 × 4 road grid with 3 × 3 blocks,
  `INNER_BBOX` (it covers the centre block), `_payload(inner_only=True)` (the ways and features
  that intersect the inner box), and `test_map_data_of_the_outer_area_composes_the_inner_area_once`
  (lines 144-168), which asserts 9 blocks.

## Design

**Rule: the outermost holder wins.** This matches features. In `map-data` the area's own copy wins,
then earlier composed areas, and an area that covers another sorts first. It also matches what M's
own `map-data` shows today: M's block, not I's.

Extend `list_composable`, keeping its signature. A composed block is left out when either of these
covers its point on surface:

1. a block of `outer_area_id` (today's `held_by_outer`, unchanged), or
2. an unclipped block of **another** composed area whose bounding box covers this block's area's
   bounding box.

Sketch:

```python
owner, other_owner, other = aliased(ImportAreaModel), aliased(ImportAreaModel), aliased(BlockModel)
held_by_a_more_outer_inner = exists().where(
    other.import_area_id.in_(inner_area_ids),
    other.import_area_id != BlockModel.import_area_id,
    other.is_clipped.is_(False),
    other_owner.id == other.import_area_id,
    owner.id == BlockModel.import_area_id,
    func.ST_CoveredBy(owner.bbox, other_owner.bbox),
    func.ST_Covers(other.boundary, func.ST_PointOnSurface(BlockModel.boundary)),
)
```

Decisions and edge cases:

- **Only unclipped blocks of the other area count.** A clipped block is never returned, so it
  can't be the copy that wins.
- **The winner never drops out itself.** M's copy can be dropped only by O (rule 1). In that case
  O's block covers I's copy as well, so I's copy goes too. The result never loses the block
  altogether.
- **Equal boxes.** Two completed areas can have identical bboxes under different providers. Each
  then "covers" the other, and both copies would drop. Break the tie, for example with
  `or_(~func.ST_Equals(owner.bbox, other_owner.bbox), other.import_area_id < BlockModel.import_area_id)`.
- **Re-imports.** Re-importing M after I exists makes M skip I's faces, so only I's copy remains, and
  rule 2 has nothing to drop. The visible owner changes from M to I, and that's expected.
- Nothing changes at import time. The duplicate exists only on read, so the fix is on read.
  Re-deriving or migrating stored data isn't needed.
- Left to the implementer: whether `owner`/`other_owner` are joins or correlated subqueries. Check
  the query against a large area if the plan looks poor. The composed set is small (a handful of
  areas).

## Tests

Add these to `server/tests/api/test_nested_import_areas.py`:

- A `MIDDLE_BBOX` strictly between `INNER_BBOX` and `OUTER_BBOX` that covers the centre block whole,
  for example `{"min_latitude": 10.1003, "min_longitude": -84.1997, "max_latitude": 10.1027,
  "max_longitude": -84.1973}`. Check it against the grid (`LAT0 = 10.100`, `LON0 = -84.200`,
  `STEP = 0.001`): it must cover the inner box and be covered by the outer one. Import it with
  `_payload(inner_only=True)`. The grid ways in rows and columns 1-2 are the ones that intersect it,
  but check `_validate_within_bounding_box` accepts the payload, and adjust it if not.
- `test_a_middle_area_imported_before_its_inner_area_composes_each_block_once`: import M, then I,
  then O. In O's `map-data`, `len(blocks) == 9`, no two blocks share a boundary, and the centre
  block's owner is M. `scope.composed_area_ids` lists both.
- The same with the order M, O, I.
- `…once_after_reimporting_the_middle`: M, I, O, then re-import M with the same payload. Still 9
  blocks, and the centre block's owner is now I.
- Keep a fully outside-in case (O, M, I: 9 blocks) as a regression check. Note in its docstring that
  it passed before the fix.
- Boundary scope: a boundary over the centre in O's `map-data?boundary_id=…` returns the centre
  block once.

Not mutation-checked (no local runs). Say so, and say which of these tests failed on the old code
by reasoning (the M-before-I ones).

## Docs and specs

- `openspec/specs/import-area-api/spec.md`, `### Requirement: The API SHALL return an import area's
  full map data as normalized models` (line 61). The composition sentence at line 64 covers the area
  versus "an inner area". Add: where two composed areas hold the same block, the one whose bounding
  box covers the other's SHALL be returned, and no block SHALL appear twice. Add a scenario: WHEN an
  area composes a middle area imported before its own inner area, THEN each block inside the inner
  area appears once, owned by the middle area.
- `docs/architecture.md` → "Nested import areas", the composition paragraph (lines 134-138): add
  that with several levels, the outermost holder of a block wins, as it does for features.
- `docs/client-features.md`: the "Composition of nested areas" row says no source id appears
  twice. Add "and no block appears twice".

## Outcome

## Tangents found
