# 01 — Eligibility, land use, suitability, fingerprints and matching (#23)

Model: sonnet. Branch: `work/m11-foundations`, from the tip of `origin/feat/23-generated-block-content`.
**One commit per numbered part**, and don't push. `python3 -m py_compile` is fine. No suites: CI is the
gate. Server only.

Read `docs/plans/milestone-11/00-decisions-and-contract.md` (the "contract") first. Sections 1–5 are
yours. Brief 03 builds the generator, storage and API on top of what you write, so keep the public
functions small and well named, and list them in your report. No API, run tables or client in this
brief.

## 1. Eligibility (contract §1)

`server/app/domain/generation.py` (new, pure): a `BlockEligibility` enum and `eligibility(block)`.
Tests go in `server/tests/domain/test_generation.py`. Add the module to the purity test if it keeps a
list.

## 2. Land-use kinds (contract §2)

- Add the five `AreaFeatureKind` values.
- Extend `_area_kind` in `server/app/ingestion/osm_adapter.py`.
- Add an Alembic migration adding the enum values. Look at how
  `202609160002_create_enum_types.py` created the type, and how `enum_type` in `persistence/models.py`
  maps it. Note that `ALTER TYPE … ADD VALUE` can't run inside a transaction block on older Postgres.
  PostGIS 16 allows it, but check the migration env, and use `op.execute` with an autocommit block if
  needed. The downgrade can be a documented no-op, because Postgres can't drop enum values.
- Adapter tests in `server/tests/ingestion/test_osm_adapter.py` cover each new tag mapping and that
  the existing ones are unchanged.
- **Check the client compiles with the new kinds.** If `client/src/api/types.ts` lists the kinds as a
  union, add the five values there, as the only client change in this brief. Don't change client
  rendering; brief 04 does that.

## 3. Suitability (contract §3)

`server/app/generation/__init__.py`, `server/app/generation/suitability.py`:
- Work in local metres. Write a small helper module (`app/generation/geometry.py`) to convert domain
  polygons and lines to and from shapely in local metres, using `local_projection_for`.
- `suitability(block, *, water, landuse, grid, real_buildings_nearby, area_of_context) -> Suitability`
  (or a similar clear signature) returns the suitable MultiPolygon, the zones as `(reason, polygon)`,
  and the style.
- The steep zone comes from the stored grid (`app/domain/elevation.py` `ElevationGrid`). Compute the
  slope per cell from the height differences over the cell spacing in metres, and union the cells
  over 30% that intersect the block. Skip it with no zone when there's no grid.
- The `setback` zone isn't part of this function: the generator adds it after matching. Leave a clear
  hook.
- Tests in `server/tests/generation/test_suitability.py` (add `__init__.py`), using hand-built grids
  and polygons:
  - water buffered by 20 m is excluded;
  - a steep strip is excluded only with a grid;
  - a landuse polygon is excluded;
  - style `informal` near low water, `sparse` with low coverage, `regular` otherwise, and never
    `informal` without a grid.

## 4. Fingerprints and exemplars (contract §4)

- Pure maths (medians, IQR, coverage from intervals, side gaps from sorted intervals) goes in
  `domain/generation.py`.
- Geometry goes in `app/generation/fingerprint.py`: the frontage line from the buildable area's
  exterior rings, and each building's nearest edge, setback, projected width and depth.
- `fingerprint(block, buildings) -> Fingerprint | None`, plus `is_exemplar(...)`.
- The defaults by road class (contract table), with the `sparse` and `informal` adjustments, go in
  `domain/generation.py`. To find a block's strongest bounding road class, read the block's bounding
  segments (`block_boundary_segments` via `BlockRepository.get_boundary_segment_ids` or similar) and
  their roads' `RoadClassification`.
- Tests:
  - a hand-built row of 5 attached houses gives side gap 0 and coverage of about 1.0, and is an
    exemplar;
  - detached houses give a gap equal to the spacing;
  - 2 buildings are never an exemplar;
  - the defaults per class and style.

## 5. Matching (contract §5)

- Pure scoring goes in `domain/generation.py`.
- A repository query goes in `server/app/persistence/repositories/block.py`, e.g.
  `blocks_within(point, meters, exclude_area_id=None)`, using `ST_DWithin` on geography over block
  boundary centroids. It returns blocks from any completed import area.
- Tests:
  - scoring prefers near, same-class, similar-area, same-style exemplars, with a stable id tie-break;
  - none within 500 m → defaults;
  - a DB test (follow `tests/persistence/` patterns) that `blocks_within` finds a block in another
    area within the radius and ignores one beyond it.

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(domain): block eligibility for generation (#23)`
2. `feat(ingestion): import forest, farmland, cemetery, railway and industrial land use (#23)`
3. `feat(blocks): land suitability inside eligible blocks (#23)`
4. `feat(blocks): fingerprint nearly complete blocks as references (#23)`
5. `feat(blocks): match each block to its local reference (#23)`

Report:
- the SHAs, and `git show --stat` for each;
- the public functions and signatures brief 03 will call;
- how the migration adds enum values;
- anything in the contract that didn't fit the source.
