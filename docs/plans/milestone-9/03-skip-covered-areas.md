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

## Tangents found
