# 11 — Faster feature persistence and turn generation (#107)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 107`

On the recorded Berlin Mitte payload (`server/tests/fixtures/overpass/berlin_mitte_1km2.json.gz`),
the last measurement gave 24.0 s for `persist features` and 12.9 s for `turns`. Together that is
more than block derivation takes now (about 11 s). Make both steps measurably faster on
`server/scripts/benchmark_import.py`, while the import's output stays unchanged.

The issue's description of the code holds. Both steps make one or more database round trips per
entity, and nothing is batched.

## Code to read first

- `server/app/ingestion/service.py` (589 lines):
  - `_persist` (116-272). Step 1 is wrapped in `self._step(area_id, "persist features")`
    (170-196). It upserts navigable nodes one by one (172-175), streets through `_persist_streets`
    (182, defined at 487-501), and then, per road, the road and each of its segments (184-194).
    After that come buildings, POIs and area features through `_persist_features` (522-550). Step 5
    is `self._step(area_id, "turns")` → `_persist_turns` (219-221, defined at 552-589).
  - `_persist_turns`: for **every** persisted navigable node, it calls
    `TurnMovementRepository.generate_candidates(node.id)` and `persist_candidates(candidates)`. Then,
    for each restriction, it calls `list_for_intersection(via_id)`, adjusts in memory, and calls
    `persist_candidates(adjusted)` again. Restrictions build on one another, so their order matters
    (the comment at 568-570).
  - `_sweep` (347-405) runs **between** steps 1 and 5. Turns are generated over the reconciled
    segments, which are exactly the segments in `segments_by_way`.
- `server/app/persistence/repositories/road_graph.py`: `StreetRepository.upsert` (15-37, with a
  caller-supplied deterministic id), `RoadRepository.upsert` (54-77), `NavigableNodeRepository.upsert`
  (96-115), and `RoadSegmentRepository.upsert` (142-170, keyed on `(road_id, from_node_id,
  to_node_id)`). Each one does a `SELECT` by natural key, then `add` or mutate, then `flush()`. That
  is two round trips per entity, plus the flush overhead.
- `server/app/persistence/repositories/building.py:14-42`, `poi.py:14-…` and `area_feature.py:14-…`:
  the same select, then add or mutate, then flush, keyed on `(import_area_id, source_id)`.
- `server/app/persistence/repositories/turn_movement.py` (134 lines). `generate_candidates` (17-52)
  runs two `SELECT`s per node, for incoming and outgoing segments, and builds candidates from
  `bearing_degrees` and `classify_turn` (`app/domain/geometry.py:35, 45`). `persist_candidates`
  (54-83) runs one `SELECT` per movement, keyed on the unique `(incoming_segment_id,
  outgoing_segment_id)` (`models.py:195-199`), then flushes once per call.
- `server/app/persistence/models.py`: every `id` is `server_default=gen_random_uuid()` (line 43),
  so an `INSERT` needs `RETURNING`. SQLAlchemy 2.0.36 with psycopg 3 batches those inserts
  ("insertmanyvalues") when many pending objects flush together. Unique constraints: streets, roads,
  buildings, POIs and area features on `(import_area_id, source_id)`; navigable nodes likewise
  (line 136); segments on `(road_id, from, to)` (163-165).
- `server/app/persistence/geometry.py`: geometries go through WKB (`from_shape`/`to_shape`), so
  coordinates round-trip exactly.
- `server/scripts/benchmark_import.py` (75 lines): times each `_step` with a `step_timer` while
  importing the payload under provider `"benchmark"`, inside a transaction it rolls back.

## Design

Measure first, then change. Run the benchmark before you touch anything, and record the per-step
times in the Outcome. If you can, also profile the two steps (`cProfile` around `import_fixture` in a
local copy of the script) to confirm that round trips dominate rather than geometry conversion.

**Running the benchmark.** It is a measurement script, not a test suite, so the no-local-tests rule
doesn't forbid it. It needs the dev PostGIS. If PostGIS is up (`pg_isready -h localhost -p 55432`,
or `docker compose ps`), run it from `server/` as its docstring says:
`set -a; . ./.env; set +a; PYTHONPATH=. python scripts/benchmark_import.py`. If it isn't up, say so
in the Outcome and leave the measurement to the coordinator. Don't start or stop the stack yourself,
and don't take this as permission to run `pytest`.

**1. Persist features: one prefetch and one flush per table.** Add a batch upsert to each repository
and keep `upsert(x)` as a one-element call to it, so there's a single code path and existing tests
still exercise it:

```python
def upsert_many(self, import_area_id, items: Iterable[Building]) -> dict[str, Building]:
    """By source id. One SELECT of the area's existing rows, add or mutate, one flush."""
```

- Segments are keyed on `(road_id, from_node_id, to_node_id)`. Prefetch the area's segments with a
  join to `roads`, then upsert all of them in one batch after the roads have ids.
- Flush order follows the foreign keys: streets (their ids are deterministic), then nodes and roads,
  then segments, then buildings, POIs and area features. The existing loop interleaves roads and
  segments per road, so restructure it into those phases. Keep `segments_by_way` exactly as it is
  built today, since `_persist_turns` and restrictions use it.
- **Duplicates within a batch must behave as they do now.** Sequential upserts let a second item
  with the same key update the row the first one created. A dict keyed on the natural key, where
  the second item updates the same model, does the same. This matters for segments, if a way
  produces the same `(from, to)` twice.
- The `touched_*_ids` sets and the created/updated/removed counts must come out identical.
- Choose this over `INSERT … ON CONFLICT DO UPDATE … RETURNING` through Core. That is a raw write
  that bypasses the identity map, which is the trap brief 10 (#115) is about, and the batched ORM
  flush already removes the per-row round trips.

**2. Turns: generate in memory, persist in one batch.**

- Add a pure function to `app/domain/turn_movement.py`:
  `turn_candidates(node_id, incoming: Sequence[RoadSegment], outgoing: Sequence[RoadSegment]) ->
  list[TurnMovement]`. Move the bearing and classification code there from `generate_candidates`.
  `generate_candidates(node_id)` keeps its signature and delegates, so
  `tests/persistence/test_turn_movement_repository.py` still covers it.
- In `_persist_turns`, group the segments in `segments_by_way` by `to_node_id` (incoming) and
  `from_node_id` (outgoing). Then build each persisted node's candidates with `turn_candidates`, with
  no queries. This is equivalent to the per-node `SELECT`s. After the sweep, the area's segments are
  exactly these, and node ids belong to one area only.
- Apply the restrictions in memory, in `records.restrictions` order, against a per-node dict
  `(incoming_id, outgoing_id) -> TurnMovement`. This replaces `list_for_intersection` plus
  `persist_candidates`. After step 5's candidate pass, the persisted state at a node is exactly its
  fresh candidates, so the in-memory state matches what `list_for_intersection` returned. The
  skip rules stay as they are (incoming or outgoing count not 1, or the target pair missing).
- Persist everything once: `TurnMovementRepository.persist_many(movements)`. It runs one `SELECT` of
  the existing movements whose `incoming_segment_id` is among the area's segments, keyed by pair,
  then mutates or adds, and flushes once.

**Output must be unchanged.** Prove it the way brief 01 did for blocks. Write a throwaway snapshot
script under `/tmp`, not committed, that imports the Mitte payload in a rolled-back transaction and
dumps rows by natural key: nodes `(source_id, WKT)`; streets; roads; segments `(road source_id,
from/to node source_ids, WKT, distance, lane_count, is_vehicle_accessible)`; turn movements `(the
same segment keys for incoming and outgoing, movement_kind, allowed, restriction_kind)`; buildings,
POIs and area features `(source_id, category, WKT, height, levels, name)`; plus the `ImportResult`
counts and `skipped_restriction_count`. Database ids are random (`gen_random_uuid`), so compare by
key, never by id. Run it before and after, and diff. Run it twice on the same database to also cover
a re-import, where updates dominate.

Left to the implementer: whether `upsert_many` returns domain objects or ids for buildings, POIs and
area features (`_persist_features` only needs the ids). Also whether to stop at "measurably faster"
or push further. Record the before and after numbers either way.

## Tests

- `server/tests/persistence/test_building_poi_area_feature_repository.py` and
  `test_road_graph_repository.py`: `upsert_many` creates, then updates in place on a second call
  (same ids), and returns results keyed by source id. Two items with the same key in one batch leave
  one row.
- `server/tests/persistence/test_turn_movement_repository.py`: `persist_many` is idempotent (a
  second call updates, no duplicates). `generate_candidates` still passes the existing tests.
- `server/tests/domain/`: a test for `turn_candidates`, covering every incoming/outgoing pair and the
  straight, left and right classification. These are pure and need no database.
- `server/tests/ingestion/test_osm_ingestion_service.py`: the existing import, re-import and
  restriction tests are the output guard, so leave them as they are. Add one with two restrictions
  at the same via node, if none exists, since that is the case the in-memory state must get right.
  Check with a grep first.
- Not mutation-checked (no local runs). Say so.

## Docs and specs

- No living spec changes. Behaviour and output are unchanged by design.
- No `docs/client-features.md` row.
- `docs/architecture.md`: no change, unless it describes how ingestion persists rows. Check, and if
  it does, keep it accurate.
- Put the before and after benchmark table in the commit body and the Outcome.

## Outcome

Done as designed. Every repository got `upsert_many` and `upsert` is now a one-element call to it.
The prefetch is an `IN (...)` over the batch's own keys, chunked at 5000 by the new
`repositories/batching.py`, rather than the whole area, so a single `upsert` costs what it did. The
segment batch prefetches by `road_id`. Nodes, buildings, POIs, area features, streets and roads
return a dict by source id; segments return a list in input order. `_persist` runs in phases
(nodes, streets, roads, segments, then the features) with one flush each; `segments_by_way` is
built as before. `turn_candidates(node_id, incoming, outgoing)` is a pure function in
`app/domain/turn_movement.py`; `generate_candidates` delegates to it. `_persist_turns` builds the
candidates from `segments_by_way` grouped by node (segments de-duplicated by id), applies the
restrictions in memory in order against a per-node `(incoming, outgoing)` dict, and writes once
with `TurnMovementRepository.persist_many` (`persist_candidates` now calls it). No Core
`ON CONFLICT`, so no raw write.

Measured on the dev PostGIS (`benchmark_import.py`, Berlin Mitte, same machine, one run each):

| Step | Before | After |
|---|---|---|
| persist features | 12.3 s | 2.5 s |
| turns | 8.9 s | 2.6 s |
| block derivation | 9.1 s | 8.8 s (untouched) |
| total | 30.6 s | 14.3 s |

(The brief's 24.0 s and 12.9 s were an earlier, slower measurement; this machine gave 12.3 s and
8.9 s before the change.) I did not profile with `cProfile`.

Output unchanged: a throwaway `/tmp` snapshot script imported the payload twice (import, then
re-import) in a rolled-back transaction and dumped nodes, streets, roads, segments, turn
movements, buildings, POIs and area features by natural key, plus the `ImportResult` counts. The
JSON from before and after the change is byte-identical. The Mitte payload has no turn
restrictions, so I also ran the `osm_neighborhood` fixture with two restrictions at one via node
the same way: both are applied (`no_left_turn` and `no_right_turn`, both not allowed, 0 skipped).

Tests written: `upsert_many` create/update/duplicate-key for every repository; `persist_many`
idempotence; `tests/domain/test_turn_movement.py` for `turn_candidates`; and
`test_two_restrictions_at_the_same_via_node_both_hold` in the ingestion tests (no existing test had
two restrictions at one via node). No test suite was run locally (CI is the gate), and the guards
are not mutation-checked.

Not done: `docs/architecture.md` doesn't describe how rows are persisted, so it needs no change.
Duplicate way source ids within one payload: the roads batch collapses them to one row, as before,
but the segments are built from the last such way only, where the old loop upserted both ways'
segments. The adapter yields one record per way id, so this doesn't arise.

## Tangents found

- Block derivation is now the largest step (8.8 s of 14.3 s on Mitte); it is the next speed-up
  candidate.
- `RoadSegmentRepository.upsert` and the other single-item `upsert` methods have no callers in
  `app/` any more besides tests; they remain as the one-element form.
