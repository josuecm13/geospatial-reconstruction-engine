# 04 — Delete an import area: the API (#133)

Model: sonnet. Branch: `work/133-delete-server`, from the tip of `origin/feat/133-night-clay`. One
commit, don't push. Python syntax checks are fine. No `pytest` / `npm test` / `openspec validate`:
CI is the gate.

## The problem

There is no way to remove an import area. Its derived data stays in the database and the area
stays in `GET /import-areas`. The owner wants a hard delete: the rows go, no soft-delete flag.

Every derived table points at `import_areas` without `ondelete` (`server/app/persistence/models.py`):
- directly by `import_area_id`: streets, roads, navigable_nodes, blocks, buildings,
  points_of_interest, area_features, traced_boundaries;
- one step down: road_segments (`road_id`, and both end nodes), turn_movements (node and two
  segments), block_boundary_segments (`block_id`, `road_segment_id`). Buildings also point at
  blocks (`block_id`), and roads at streets (`street_id`).

Delete explicitly, children first, in one transaction. Don't add a migration.

## Nested areas: refuse

An import of a rectangle that covers a completed area skips what that inner area holds
(`server/app/domain/covered_areas.py`), and the outer area borrows those features back at read time
(`composed_import_area_ids`, `server/app/api/dependencies.py:100`). Deleting an inner area would
leave holes in every outer area. **The owner chose to refuse that delete.**

An area is *in use* when another import area with status `completed` or `importing` has a bounding
box that covers this area's bounding box (`ST_CoveredBy(this.bbox, other.bbox)`, edges may touch,
excluding itself). This is the inverse of `ImportAreaRepository.completed_areas_covered_by`; put
the new query next to it.

## The contract

`DELETE /import-areas/{import_area_id}`
- **204**, no body: the area and everything derived from it are gone.
- **404 `import_area_not_found`**: unknown id. Reuse the existing `import_area` dependency, which
  already raises this.
- **409 `import_in_progress`**: `jobs.is_running(area.id)`. Reuse `_import_in_progress` in
  `server/app/api/routers/import_areas.py`, the same check `create_import_area` makes.
- **409 `import_area_in_use`**: the area is in use (above). The message says which areas borrow
  from it. `details`: `{"covering_areas": [{"id": "<uuid>", "name": "<place name or null>"}]}`.
  Nothing is deleted.

Failed and pending areas that aren't running can be deleted.

## Parts

1. `ImportAreaRepository`: `areas_covering(bbox, exclude_id)` and `delete(import_area_id)`. The
   delete removes the dependants in FK order, then the area. Follow `TracedBoundaryRepository.delete`'s
   style (`sqlalchemy.delete`, no session commit inside the repository).
2. The route in `server/app/api/routers/import_areas.py`, committing like `delete_boundary` does in
   `traced_boundaries.py`.
3. Tests:
   - `server/tests/persistence/test_import_area_repository.py`: after a delete, no row in any derived
     table names the area. A second area's rows survive. `areas_covering` finds a covering completed
     area, ignores a partly overlapping one, and ignores a failed one.
   - `server/tests/api/`: a new `test_delete_import_area.py` covering 204 (then GET and `map-data`
     are 404), unknown id 404, running import 409 `import_in_progress`, and a nested inner area 409
     `import_area_in_use` with `covering_areas`. Deleting the outer area of a nested pair succeeds,
     and the inner area is still intact. Build fixtures the way `test_nested_import_areas.py` and
     `test_import_areas.py` do.
4. Docs and spec:
   - `openspec/specs/import-area-api/spec.md`: a requirement for the delete with scenarios matching
     the contract.
   - `openspec/specs/api-error-contract/spec.md`: add `import_area_in_use` only if the spec lists
     codes.
   - `docs/client-features.md`: the capability's row.

Commit message:
`feat(api): delete an import area and everything derived from it (#133)` followed by a blank line
and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
