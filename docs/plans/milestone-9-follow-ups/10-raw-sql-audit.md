# 10 — Audit raw-SQL writes followed by ORM reads (#115)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 115`

A raw SQL write goes straight to the database. It bypasses the session's identity map, so an ORM
object already loaded in the same session keeps its old attribute values. Then a later `select()` or
`session.get()` hands back that stale object. `BuildingRepository.link_to_containing_block` had this
problem, and only `list_for_import_area` was patched (with `populate_existing`). The issue asks for
every repository that writes through raw SQL and reads through the ORM to be checked, and each stale
read fixed and tested.

**The audit, done against the current code.** There is exactly **one** raw SQL write in `server/app`:
`BuildingRepository.link_to_containing_block`. The issue's "other repositories … may have the same
trap" doesn't hold for any other repository. What remains are the other ORM readers of that same
table:

| Write | Kind | Keeps the session in step? |
|---|---|---|
| `BuildingRepository.link_to_containing_block` (`server/app/persistence/repositories/building.py:44-59`) | `text("UPDATE buildings … FROM blocks …")` | **No.** A loaded `BuildingModel` keeps its old `block_id` |
| `BlockDerivationService.clear_for_import_area` (`server/app/persistence/block_derivation.py:43-60`) | ORM-enabled `update(BuildingModel)`, `delete(BlockBoundarySegmentModel)`, `delete(BlockModel)` | Yes. SQLAlchemy 2.0's default `synchronize_session="auto"` updates or expires loaded objects |
| `OSMIngestionService._sweep` (`server/app/ingestion/service.py:347-405`) | ORM-enabled `delete(...)` on seven tables | Yes, same as above |
| `TracedBoundaryRepository.delete` (`server/app/persistence/repositories/traced_boundary.py:54-55`) | ORM-enabled `delete(TracedBoundaryModel)` | Yes |

Every other `text()` in `server/app` is a read: `block_derivation.py:79, 158, 224, 265`, `main.py:29`
(`/health`), and `config/database.py:13`. `scripts/benchmark_import.py` writes nothing raw.

The ORM readers of `buildings` that can see a stale `block_id` after the link, in the same session:

- `BuildingRepository.list_for_import_area` (`building.py:61-69`): already fixed with
  `populate_existing`.
- `BuildingRepository.get` (`building.py:71-73`): `session.get` returns the identity-map object
  as it is. It is **stale**. Today only tests call it after a link
  (`server/tests/persistence/test_block_derivation.py:125, 132, 149, 155-156`, after
  `rederive_for_import_area`).
- `SpatialQueryService` building queries (`server/app/persistence/spatial_queries.py:62-84`, plain
  `select(BuildingModel)`): stale in a session that ran the link. In production every request has
  its own session (`server/app/api/dependencies.py:51-56`), so no API response is wrong today.
  API tests share one `db_session` across requests (`server/tests/api/conftest.py`), and so does the
  background-import test's `nullcontext(db_session)`, so a test can hit the stale value.

The identity map holds clean objects weakly. So a stale value shows up only while something still
references the loaded object. That is why the existing tests in `test_block_derivation.py` pass: the
`BuildingModel` they created is no longer referenced by the time they call `get`. A regression test
has to hold a reference on purpose to be deterministic.

## Code to read first

- `server/app/persistence/repositories/building.py` (86 lines): `upsert` (14-42, which sets
  `block_id` from the domain object, `None` on import), `link_to_containing_block` (44-59), and
  `list_for_import_area` (61-69) with its `populate_existing` comment. Also `get` (71-73).
- `server/app/persistence/block_derivation.py`: `clear_for_import_area` (43-60) and
  `rederive_for_import_area` (62-72). The latter is clear, then derive, then link.
- `server/app/ingestion/service.py`: `_persist` calls `link_to_containing_block` (line 235), then
  `_emit_building_rings` (340, through `list_for_import_area`), then `_counts_for_area` (407-419,
  counts only).
- `server/tests/persistence/test_block_derivation.py:120-160` and
  `server/tests/persistence/test_building_poi_area_feature_repository.py:121-160` (the link tests).
- SQLAlchemy is pinned at `2.0.36` (`server/requirements.txt`).

## Design

Fix it at the writer, so no reader has to know about it. After its raw UPDATE,
`link_to_containing_block` expires `block_id` on every `BuildingModel` of that import area that the
session has loaded:

```python
for obj in list(self.session.identity_map.values()):
    if isinstance(obj, BuildingModel) and obj.import_area_id == import_area_id:
        self.session.expire(obj, ["block_id"])
```

The next access reloads `block_id` from the database. That covers `get`, the spatial queries, and
anything added later.

Decisions:

- **Keep the raw SQL.** It is the clearest form of a spatial `UPDATE … FROM`. The other option is an
  ORM-enabled `update(BuildingModel)` with `synchronize_session="fetch"`. That would also keep the
  session in step, but its support for multi-table `UPDATE … FROM` with expression values is a
  version detail to verify, and it buys nothing here. If you prefer it and confirm it expires or
  refreshes loaded objects, say so in the Outcome.
- **Expire, don't `expire_all()`.** Expiring everything would make every loaded object reload,
  across tables, after each import.
- `import_area_id` comes in as a `uuid.UUID` (from `_persist`) or as whatever the caller passes. Compare
  it like with like. The raw SQL passes `str(import_area_id)`, and the model's column is `UUID(as_uuid=True)`.
- **Remove the `populate_existing` workaround** from `list_for_import_area`, together with its
  comment. The writer now covers it. The regression test below shows it isn't needed.
- No other repository needs a change. Write that in the Outcome, along with the table above, so the
  audit is on record.

## Tests

- `server/tests/persistence/test_building_poi_area_feature_repository.py`, a new test. Build a
  square block and a building inside it (reuse the helpers from `test_block_derivation.py`, or this
  file's own link tests at lines 121-160). Load the `BuildingModel` with `db_session.get(...)` and
  **keep the reference** in a local variable. Run `BlockDerivationService(db_session).rederive_for_import_area(area)`.
  Then assert that `BuildingRepository(db_session).get(building_id).block_id` equals the derived
  block's id, and that the held model's `block_id` does too.
- The same pattern for `list_for_import_area`, now that `populate_existing` is gone. Hold the
  models from an earlier listing, link, then list again.
- The same pattern for `SpatialQueryService.buildings_within_radius` (put it in
  `server/tests/persistence/test_spatial_queries.py`, or in the file above). The returned building's
  `block_id` must be the new one.
- Not mutation-checked (no local runs). Say so in the commit and the Outcome. The check you'd run
  locally would be to delete the expire loop and watch all three tests go red.

## Docs and specs

- No living spec changes. API behaviour doesn't change, because each request has its own session.
  `openspec/specs/block-derivation/spec.md`'s "A building's containing block SHALL be determined by
  spatial containment" already states the intended result.
- No `docs/client-features.md` row.
- `docs/architecture.md`: no change. If the persistence conventions in `AGENTS.md` should mention it,
  record that as a tangent rather than editing `AGENTS.md`. A raw SQL write must leave the session's
  loaded objects coherent.

## Outcome

## Tangents found
