# 01 — Block derivation under 15 s (#91)

## Goal

`BlockDerivationService.derive_for_import_area` (`server/app/persistence/block_derivation.py`) takes
minutes on a 1 km² city import. Make it take **under 15 s** on the Berlin Mitte area while producing
**byte-identical blocks**.

## Where it stands (measured 2026-10-02, dev machine)

The Berlin Mitte area is stored in the dev database. Its import area id is
`0cc1be0a-d607-4776-9fbc-7ce4ae835c84`, with bbox `13.3930821,52.526332 → 13.4090037,52.5344644`:
549 roads, 1,403 road segments, 1,489 buildings, 81 faces, and 73 blocks.

| Query | Calls | Time before | After commit `c17dc56` |
|---|---|---|---|
| Candidate faces (the big `WITH area … candidates` query) | 1 | 143 s | **3 s** |
| Per-face bounding-segment lookup (`select(RoadSegmentModel.id) … or_(ST_Covers, ST_Length(ST_Intersection(…)))`) | 73 | 48 s | 48 s |
| `_buildable_area` (difference against unioned geography buffers) | 73 | 17 s | 17 s |
| everything else | — | < 2 s | < 2 s |
| **derive total** | | **209 s** | **69 s** |

Commit `c17dc56` already landed the first fix. Inlined, the planner re-ran the buffered road
unions once per face inside its nested loops, so the CTEs are now `AS MATERIALIZED`. Its output was
compared field by field with the pre-change output and is identical.

## What's left

1. **Per-face segment lookup (48 s, 0.65 s per face).** The `or_` disables index use, so every face
   scans every segment and computes an `ST_Intersection` against a buffered boundary. Options, in
   order of preference:
   - Add an index-friendly prefilter that can't change the result, ANDed with the existing
     condition: `RoadSegmentModel.geom.ST_Intersects(func.ST_Expand(boundary_geom, tolerance * 2))`
     (or the `&&` operator against `ST_Expand`). Every segment that passes either branch touches the
     face's boundary within the tolerance, so the prefilter never drops one.
   - Better still: replace the 73 queries with **one** set-based query that returns
     `(face_index, segment_id, locate_order)` for all faces, for example by sending the face WKTs as an
     array and `unnest … WITH ORDINALITY`. The ordering must stay
     `ST_LineLocatePoint(ST_ExteriorRing(face), ST_StartPoint(segment))`, and segments with equal
     locate values must keep their current tie order. Check this: today ties fall back to whatever
     order Postgres returns. If ties exist, add `, road_segments.id` as a secondary sort, and confirm
     the snapshot comparison still passes. If it doesn't, the old order was nondeterministic, and you
     record that under Outcome.
2. **Buildable area (17 s).** The same pattern: one query per face. Batch it into one set-based query
   over all faces, or keep it per face if 01.1 already gets the total under 15 s. Don't change the
   geometry operations themselves: identical output is the bar.
3. **Benchmark script** (an acceptance criterion): `server/scripts/benchmark_import.py`, not run in CI.
   It imports a recorded payload into a throwaway area inside a transaction it rolls back, and
   prints the time per ingestion step (parse, persist features, turns, block derivation, link). To
   get per-step times, wrap the calls in `OSMIngestionService._persist` with an optional timing hook
   (for example a `step_timer` callable passed to the service, defaulting to a no-op). Don't scatter
   `time.perf_counter()` through production code.
   - Record the payload once: `OverpassClient().fetch(bbox)` for the Mitte bbox above, saved
     gzipped to `server/tests/fixtures/overpass/berlin_mitte_1km2.json.gz`. **Check the size
     first.** If it's over ~3 MB gzipped, don't commit it. Make the script fetch and cache it under
     a gitignored path instead, and say so in the script's docstring.
   - Overpass fair use: one query at a time, and don't loop fetches.

## Proving "identical blocks"

Use these two scripts, saved locally (not committed; `/tmp` is fine). Run them against the dev DB
from `server/`, with `set -a; . ./.env; set +a; PYTHONPATH=.`:

```python
# snapshot_blocks.py <out.json> [area_id] — re-derives in a transaction it rolls back
import json, sys, time, uuid
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.config.settings import load_settings
from app.config.database import make_engine
from app.persistence.block_derivation import BlockDerivationService
from app.persistence.repositories.building import BuildingRepository
AREA = uuid.UUID(sys.argv[2] if len(sys.argv) > 2 else "0cc1be0a-d607-4776-9fbc-7ce4ae835c84")
with Session(make_engine(load_settings())) as s:
    svc = BlockDerivationService(s); svc.clear_for_import_area(AREA)
    t = time.perf_counter(); svc.derive_for_import_area(AREA); dt = time.perf_counter() - t
    BuildingRepository(s).link_to_containing_block(AREA)
    rows = s.execute(text("select id::text, ST_AsText(boundary) b, ST_AsText(buildable_area) ba, area_square_meters a, buildable_area_square_meters baa, is_median, is_clipped, (select array_agg(road_segment_id::text order by sequence_order) from block_boundary_segments where block_id=blocks.id) segs from blocks where import_area_id=:a order by id"), {"a": str(AREA)}).fetchall()
    links = s.execute(text("select id::text, block_id::text from buildings where import_area_id=:a order by id"), {"a": str(AREA)}).fetchall()
    s.rollback()
json.dump({"blocks": [dict(r._mapping) for r in rows], "links": [list(r) for r in links]}, open(sys.argv[1], "w"), default=str)
print(f"derive {dt:.1f}s, {len(rows)} blocks")
```

```python
# compare.py <before.json> <after.json> — prints IDENTICAL or each difference
import json, sys
from shapely import wkt as W
a, b = (json.load(open(p)) for p in sys.argv[1:3])
assert a["links"] == b["links"], "building links differ"
assert [x["id"] for x in a["blocks"]] == [x["id"] for x in b["blocks"]], "ids differ"
bad = 0
for x, y in zip(a["blocks"], b["blocks"]):
    for k in ("is_median", "is_clipped", "segs", "b"):
        if x[k] != y[k]: print(x["id"], k); bad += 1
    if (x["ba"] is None) != (y["ba"] is None) or (x["ba"] and not W.loads(x["ba"]).equals_exact(W.loads(y["ba"]), 1e-12)):
        print(x["id"], "buildable differs"); bad += 1
    if abs(x["a"] - y["a"]) > 1e-9 or abs(x["baa"] - y["baa"]) > 1e-6: print(x["id"], "areas"); bad += 1
print("IDENTICAL" if not bad else f"{bad} differences")
```

Take the baseline **from `main`** (`git stash`, or a worktree at `main`). Then snapshot your change
and compare. Running these scripts is allowed: they're measurements, not the test suite.

## Acceptance criteria (from #91)

- Each of derivation's queries is timed on the Mitte data, and the slow one is identified. (Done
  above. Keep the table updated in Outcome.)
- Derivation for that area takes **< 15 s** on a developer machine, and `compare.py` prints `IDENTICAL`.
- `server/scripts/benchmark_import.py` exists and prints the time per ingestion step.
- The existing block-derivation tests (`server/tests/persistence/test_block_derivation*.py`) pass
  unchanged in CI. Don't edit them.

## Docs

- No spec change: behavior is identical.
- Tick nothing in `tasks.md`: #91 isn't in the change's task list. Add a line under its §1 instead:
  `- [x] 1.12d #91 [blocks] Block derivation takes minutes on a 1 km² city import`.
- `HOW_TO_RUN.md`: one short paragraph on running the benchmark.

## Outcome

Derivation on the stored Berlin Mitte area, baseline taken from `main` (`2c83b99`) in a worktree:

| Step | `derive_for_import_area` |
|---|---|
| `main` | 207.6 s |
| `c17dc56` (candidate-face CTEs materialized, from the table above) | 69 s |
| + one set-based segment lookup | 24.5 s (segment lookup 3.2 s, buildable area 17.0 s) |
| + `cut` CTE materialized in `_buildable_area` | **10.6 s** |

- **Per-face segment lookup:** took the "one set-based query" option. The face WKTs go in as a
  `text[]` with `unnest … WITH ORDINALITY`, joined to `road_segments` behind an
  `rs.geom && ST_Expand(face, tolerance * 2)` prefilter, then the original `ST_Covers` /
  `ST_Length(ST_Intersection(…))` condition. `ORDER BY face, ST_LineLocatePoint(…), rs.id`.
- **Buildable area:** kept per face; the geometry operations are untouched. Profiling the stages on
  the biggest face (buffer 0.07 s, union 0.15 s, difference 0.006 s, make-valid 0.009 s, area
  0.02 s, inward buffer 0.02 s) summed to about 0.3 s, against 1.38 s through `_buildable_area`.
  The `cut` CTE is referenced once, so Postgres inlined it and recomputed the whole difference for
  each of the five columns that read `geom`: the same bug as the candidate faces. `AS MATERIALIZED`
  fixed it. Batching into one query wasn't needed.
- **`compare.py` does not print `IDENTICAL` against `main`, for one reason.** Blocks, ids, boundaries,
  buildable areas, areas, `is_median`, `is_clipped` and building links all match, and every block has
  the same set of boundary segments. In 64 of 73 blocks, `sequence_order` differs, only among segments
  whose `ST_LineLocatePoint` is equal (969 tied pairs). I checked for each differing block that the
  locate values read in both orders are the same sorted sequence. The old query had no tie-break, so
  its tie order was whatever Postgres returned; the new one breaks ties by segment id. I did not test
  whether `main`'s order varies from run to run. Block ids don't depend on it (they hash the set of
  segment ids), and the existing derivation tests pass unchanged in CI. The step-2 snapshot is
  `IDENTICAL` to the step-1 snapshot, so the `AS MATERIALIZED` change alone alters nothing.
- **Benchmark:** `server/scripts/benchmark_import.py`, with a `step_timer` hook on
  `OSMIngestionService` (default: no-op). The payload is 0.82 MB gzipped, so it is committed at
  `server/tests/fixtures/overpass/berlin_mitte_1km2.json.gz` (one Overpass fetch, 27,194 elements).
  A run imports it as provider `benchmark` inside a transaction it rolls back (checked: no
  `benchmark` row remained). The payload has 548 roads and yields 72 blocks, against 549 and 73 stored,
  because OSM changed between the two fetches.
- **Fresh import, whole pipeline:** block derivation 13.7 s inside the import (no `ANALYZE` yet on the
  just-written rows, so slower than the 10.6 s on the settled stored area), persist features 24.0 s,
  turns 12.9 s, link buildings 0.7 s, total 51.8 s. Derivation is under 15 s in both, but with less
  margin on a fresh import.
- Guard tests are not mutation-checked (no local test runs). `test_import_reports_each_step_to_the_step_timer`
  guards the hook the benchmark relies on.

## Tangents found

- Persisting features takes 24 s and turn generation 12.9 s on the Mitte payload, together more than
  block derivation now does. (`server/app/ingestion/service.py`, `_persist` steps 1 and 5; the
  benchmark prints them.)
