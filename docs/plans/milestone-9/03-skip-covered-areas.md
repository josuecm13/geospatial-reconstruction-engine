# 03 — Skip areas already imported inside the rectangle (#100)

## Problem

Import areas are independent. Importing a rectangle that contains earlier imports fetches and
stores everything again, including what those inner areas already hold. In the dev database, the
1 km² Berlin Mitte area (`0cc1be0a…`) re-stored all 147 buildings of `169e2e6c…` and all 28 of
`cb606402…`, both of which lie entirely inside it. Every entity table is unique per
`(import_area_id, source_id)`, so these are real duplicates: two rows, two block derivations, and two
copies in any combined view.

The user wants a new import to **skip the earlier areas inside it and behave like a ring**: only the
part of the rectangle not already imported is built and streamed. That fits the concentric building
batches from #90 (brief 02). The first ring starts at the edge of what's already there.

## Decision (made: Option A)

How far does "skip" go?

- **Option A, the feature layers skip; the road network stays whole (recommended).** Buildings, POIs,
  and area features whose geometry is **covered by** a completed inner area are not stored in the new
  area and not streamed. Roads and segments are still imported for the whole rectangle, because routing
  and block derivation need a connected network. A ring-only network would leave a hole that no route
  could cross. Blocks whose representative point lies inside an inner area are not stored either
  (the inner area already has them). Blocks straddling an inner edge are stored in the new area,
  because the inner area only has them clipped. Map-data for the new area **composes** the inner
  areas' feature layers into its response, so a client sees one complete place.
- **Option B, true ring areas.** The new area's footprint becomes the rectangle minus the inner
  areas, and every layer, roads included, is clipped to it. This is cleaner storage, but routing and
  blocks across the seam need cross-area stitching, which nothing supports today. It's a much larger
  change.
- **Option C, absorb.** The new area takes over the inner areas: their data moves into it, and they
  become aliases. There are no duplicates and no seams, but the inner areas' traced boundaries and
  ids have to be migrated.

Also to settle: does an area that only **partly** overlaps count? The recommendation is no, only
fully covered completed areas, which is what "inner" means. A partly overlapping one is imported in
full, as today.

**Decision: Option A**, confirmed by the user on 2026-10-02. Partly overlapping areas are imported in full (the recommendation above).

## Plan

1. **Find the inner areas.** `ImportAreaRepository.completed_areas_covered_by(bbox, exclude_id)`:
   completed areas where `ST_CoveredBy(inner.bbox, :bbox)`, excluding the area being imported.
2. **Fetch stays one Overpass query** for the whole rectangle (fair-use policy; ways crossing an
   inner edge need their geometry). Skipping happens at persist time.
3. **Skip at persist.** In `OSMIngestionService`, given the inner bboxes, drop from `ImportRecords`
   the buildings, POIs, and area features whose envelope is covered by an inner bbox (a pure
   function in `app/domain/`, unit-tested). The skipped ones are neither upserted nor counted. On
   re-import of the outer area, reconcile treats them as "not produced" and sweeps any earlier copies
   in the outer area: that is the migration path for duplicates that already exist.
4. **Blocks.** After derivation, drop faces whose representative point is inside an inner bbox, before
   ids are assigned. Then check that block ids for the remaining faces are unchanged:
   `block_ids_for` keys on segment sets plus a representative point, so removing other faces must
   not change any surviving block's id. Write a test for this.
5. **Streaming (brief 02).** The `buildings` ring batches only contain what was stored, so the first
   non-empty ring naturally starts beyond the inner areas. Add `"inner_area_ids": [...]` to the
   `fetched` event, so the client can show the inner areas right away (they're already built).
6. **Map-data composition.** `GET /import-areas/{id}/map-data` (whole-area scope) appends the inner
   areas' buildings, POIs, area features, and blocks, each feature carrying
   `properties.import_area_id`, so a consumer knows its owner. Boundary scopes compose the same way,
   filtered by the boundary. Add `scope.composed_area_ids` to the response.
7. **Counts** on the outer area count only its own rows (they describe what it stores). Document that.

## Acceptance criteria (as filed in #100)

- Importing a rectangle that fully contains a completed area stores none of that area's buildings,
  POIs, or area features, and none of its interior blocks. The road network covers the whole
  rectangle, and a route can cross the inner area.
- The building batches in the event stream skip the inner areas: no building of an inner area is sent.
- `map-data` of the outer area returns one complete place (its own features plus the inner areas'),
  with no source id appearing twice in a layer.
- Re-importing an outer area that already holds duplicates (like the Mitte area today) removes its
  copies of the inner areas' features.
- A partly overlapping area is imported in full, as today.
- Tests: the pure covered-by filter; an API test with an inner fixture area imported first, then the
  outer one; block id stability.

## Docs and specs

- `docs/architecture.md`: import areas can now nest. Covered areas own their features, and the outer
  area composes them on read.
- `docs/schema.md`: no table change expected for Option A. Confirm.
- Spec deltas: `import-area-api`, a new requirement **"An import SHALL skip what completed inner areas
  already hold"**, plus a modified map-data requirement for composition.
- `docs/client-features.md`: the map-data row mentions composition.
- `tasks.md`: add `- [x] 1.12f #100 [ingestion] Skip completed areas inside a new import's rectangle`.

## Issue (filed as #100)

- Title: `[ingestion] Skip completed areas inside a new import's rectangle`
- Label: `enhancement`; milestone `9 Live import and the showcase client`; sub-issue position: right
  after #90; blocked by #90.
- Body: the "Problem" paragraph above, then the acceptance criteria, then
  `### Reference` → `server/app/ingestion/service.py` (`_persist`),
  `server/app/persistence/repositories/import_area.py`, #90.

## Outcome

Done as Option A, in one commit.

- **Inner areas.** `ImportAreaRepository.completed_areas_covered_by(bbox, exclude_id)` (`ST_CoveredBy`,
  completed only). Both `import_fixture` and `import_staged` look them up after parsing.
- **Skip at persist.** `app/domain/covered_areas.py` (pure, in the purity test's list):
  `is_covered_by`, `without_covered`, and `compose_by_source_id`. `_persist` drops covered buildings,
  POIs (by their point), and area features before upserting, so they are neither stored nor counted,
  and the sweep removes earlier copies on re-import.
- **Blocks.** `BlockDerivationService.derive_for_import_area` looks the inner areas up itself (so
  `rederive_for_import_area` agrees, and its signature, which tests monkeypatch, is unchanged).
- **Streaming.** `fetched` carries `inner_area_ids`. Ring batches read stored buildings, so they skip
  the inner areas with no change.
- **Map-data.** Composes inner areas' buildings, POIs, and area features (deduplicated by source id, own
  copy first), plus their blocks that are unclipped and not covered by an outer block
  (`BlockRepository.list_composable`). Boundary and clip scopes compose the same feature layers
  (`map_scope` takes `composed_area_ids`). `scope.composed_area_ids` is new, and blocks, buildings, POIs,
  and area features carry `properties.import_area_id` (in SSE stages too, since the mappers are shared).
  Client types updated to match.
- **Docs.** architecture.md ("Nested import areas"), schema.md (no table change, confirmed),
  client-features.md, spec deltas (new requirement plus the modified map-data requirement and the
  `fetched` payload), tasks.md 1.12f.
- **Tests.** `tests/domain/test_covered_areas.py`, `tests/persistence/test_import_area_repository.py`
  (covered-by query), and `tests/api/test_nested_import_areas.py`: a synthetic 4 x 4 road grid with the
  inner area imported first. Covers skipping, a route across, composition (whole, clip, boundary),
  the event stream, re-import sweeping duplicates with block-id stability, and partial overlap. Not run
  locally (CI is the gate). Guards not mutation-checked.

Decisions that differ from the plan text:

1. **Blocks are dropped when their boundary is covered by an inner box, not when their
   representative point is inside it.** With the representative-point rule, a block straddling an
   inner edge could be dropped while the inner area holds only its clipped piece. That contradicts
   the plan's own "straddling blocks are stored" and the acceptance criterion's "interior blocks".
2. **Block ids are assigned over all faces, then covered faces are dropped**, not dropped first.
   `block_ids_for` numbers faces that share a segment set among themselves, so dropping one first
   could renumber a survivor. Assigning first makes stability hold by construction. The re-import
   test checks it end to end (same ids and geometry before and after an inner area appears).
3. **Composed blocks are an inner area's unclipped blocks that no outer block covers.** Clipped
   pieces would overlap the outer area's whole straddling blocks. The "not covered by an outer block"
   check keeps an outer area imported *before* its inner area (which still holds every block) free of
   duplicate blocks until it is re-imported.

Left undone:

- Two-level nesting where a middle area was imported *before* its own inner area: both hold the
  innermost blocks, and map-data of the outermost area can then show those blocks twice (features
  stay deduplicated by source id). Re-importing the middle area fixes it.

## Tangents found

- Spatial queries (`/nearby`, `/within-bbox`, `/nearest`, footprint-area in
  `server/app/api/routers/spatial_queries.py`) don't compose inner areas. On an outer area they miss
  the buildings, POIs, and area features that an inner area holds, though map-data shows them.
- `docs/client-features.md`, the map-data "Blocks: `buildable_area` …" row: the note "`block_feature`
  exposes only `area_square_meters`" is stale (it exposes all of them), which misleads client work.
