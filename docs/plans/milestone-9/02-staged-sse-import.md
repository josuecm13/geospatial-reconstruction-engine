# 02 — Staged background import over server-sent events (#90)

## Goal

An import is one synchronous request that takes minutes, so the client sees nothing until it ends.
Add an **opt-in background import** that persists in dependency order and streams each stage, with
its features, to the client as **server-sent events**. The synchronous path stays as it is.

Read the full issue first: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 90`.

## Code to read first

- `server/app/api/routers/import_areas.py`: `create_import_area` (the synchronous import) and
  `get_map_data` (how features and the projection are mapped for the API; reuse those mappers).
- `server/app/ingestion/service.py`: `import_fixture` and `_persist`. Note what's committed when:
  the area row is committed up front, and everything else commits once at the end.
- `server/app/api/mappers.py`: `segment_feature`, `building_feature`, `block_feature`,
  `area_feature_feature`, `poi_feature`, `projection_out`.
- `server/app/domain/local_projection.py`: `local_projection_for`.
- `server/app/api/dependencies.py`: `get_session`, `get_engine`, `get_overpass_client`.
- `server/tests/api/conftest.py` and `server/tests/conftest.py`: how tests isolate sessions with
  savepoints and override dependencies.

## Design (decided; follow it)

**Request.** `POST /import-areas` accepts a new optional body field `"background": true`. When it's
set:
- validate the bbox exactly as today (422 `invalid_bounding_box` synchronously);
- get or create the area row and commit (as today), so there's an id to return;
- refuse with **409 `import_in_progress`** if a job for this area is running, with
  `details: {"import_area_id": …, "events_url": "/import-areas/<id>/events"}`. The synchronous
  path must also refuse while a background job for the area runs;
- start the job and return **202** with `{"import_area_id": "<id>", "events_url": "/import-areas/<id>/events"}`.
  Add an `ImportStartedOut` schema.

**Job registry**: a new module `server/app/ingestion/jobs.py`, in-process, with no broker.
- `ImportJob`: `area_id`, an append-only `events: list[StageEvent]`, `done: bool`, and a
  `threading.Condition` to wake waiting subscribers.
- `StageEvent`: `id: int` (1, 2, 3, … per job), `stage: str`, `data: dict` (JSON-ready).
- `ImportJobRegistry`: `start(area_id, work) -> ImportJob` (raises `ImportAlreadyRunning`),
  `get(area_id) -> ImportJob | None`. Jobs run on a `ThreadPoolExecutor(max_workers=2)`. Finished
  jobs stay retrievable for **10 minutes** for replay, then are dropped.
- The registry is a FastAPI dependency (`get_import_jobs`) returning a module-level singleton, so
  tests can override it.
- The job opens **its own** `Session` from a session factory passed in (production: `get_engine()`'s
  sessionmaker). Tests pass a factory that returns the test's savepoint session, plus an executor
  that runs work inline (`concurrent.futures` with a synchronous fake), so tests are deterministic.

**Staged persistence.** Add `OSMIngestionService.import_staged(bbox, payload, emit)`, where
`emit(stage, data)` is called after each stage's rows are flushed. The **single transaction stays
all-or-nothing**: nothing is committed until every stage succeeds, so `map-data` keeps returning the
previous state, which it reads from committed rows. Restructure `_persist` so both paths share the
same steps. The synchronous `import_fixture` passes a no-op `emit`, and its behavior must not change
(the existing ingestion tests are the guard). Stage order and content:

| Stage | After which step | `data` |
|---|---|---|
| `fetched` | Overpass payload received and `ensure_complete` passed | `{"projection": …, "element_count": n}` |
| `ground` | area features upserted | `{"projection", "area_features": FeatureCollection}` |
| `roads` | streets, roads, segments upserted, stale rows swept, turns persisted | `{"projection", "road_segments": FeatureCollection}` (with cross-sections, as in map-data) |
| `blocks` | blocks derived | `{"projection", "blocks": FeatureCollection}` |
| `buildings` | buildings upserted and linked, **one event per ring batch** | `{"projection", "ring": k, "buildings": FeatureCollection}` |
| `generated` | reserved for Milestone 11; **not emitted** now | — |
| `completed` | committed | the `ImportAreaOut` body |
| `failed` | any exception | `{"code": …, "message": …, "details": …}`: the same code the synchronous path would return (reuse the mapping in `app/api/errors.py`, extracted to a function) |

POIs go out with `ground`. The sweep needs every touched id set before deleting, so either persist
buildings early but **emit** them late, or split the sweep per table. Emitting late is simpler:
upsert everything as today, and emit per stage in the order above. "Persist in dependency order"
from the issue is satisfied by emit order plus the single transaction. **Record which you chose
under Outcome.**

**Rings.** A pure function in `server/app/domain/rings.py`:
`ring_batches(items: Sequence[T], center: Coordinate, position: Callable[[T], Coordinate], ring_width_meters: float = 100.0) -> list[list[T]]`.
Bucket each item by `floor(distance(center, position(item)) / ring_width)`, and return non-empty
buckets in ascending order. Within a bucket, sort by distance, then id, so the output is
deterministic. Use the building's centroid, and an equirectangular distance from
`local_projection_for` (meters per degree at the center), which is accurate enough at 1 km.
The center is the rectangle's center. Unit-test it: ordering, completeness (every item exactly once),
empty rings skipped, and stable ties.

**Failure semantics.**
- Any exception rolls back the job's session. The background path does **not** call `mark_failed`:
  the area's status, counts, and data stay exactly as before. For a brand-new area that means it
  stays `pending` with no data. The `failed` event is the signal.
- Server restart mid-job: nothing was committed, so the same holds.
- The Overpass fetch happens **inside the job** (it's the slow-but-cheap part). A
  `source_incomplete` or `upstream_unavailable` result becomes a `failed` event.

**SSE endpoint.** `GET /import-areas/{id}/events` → `StreamingResponse(media_type="text/event-stream")`,
with no new dependency.
- Each event: `id: <n>\nevent: <stage>\ndata: <compact json>\n\n`.
- It honors the `Last-Event-ID` request header: it replays events with `id >` that value, then
  follows live. Without the header it replays everything.
- It ends the stream after `completed` or `failed`.
- Waiting for new events must not block the event loop: poll the job every 0.25 s with
  `await asyncio.sleep`, or wait on the condition in `asyncio.to_thread`.
- Send a comment line `: keep-alive\n\n` every 15 s while waiting, so proxies don't cut the stream.
- No job for the area → 404 `import_job_not_found`. Unknown area → the usual `import_area_not_found`.
- A client disconnecting must not stop the job: the job never depends on its subscribers.

## Tests (write them; CI runs them)

`server/tests/domain/test_rings.py` (pure); `server/tests/api/test_background_import.py`:
1. Stage order on a fixture payload (`tests/fixtures/osm_neighborhood.json` via the posted-payload
   path, with `background: true`): `fetched, ground, roads, blocks, buildings…, completed`.
2. The building batches' union equals the area's buildings in map-data, with no duplicates, and
   batch `ring` values ascending.
3. Replay: read the stream fully, then reconnect with `Last-Event-ID: 2` and get exactly events 3…end.
4. Mid-stage failure: inject a failure in block derivation (monkeypatch
   `BlockDerivationService.derive_for_import_area` to raise) on an area that has a completed import.
   Expect a `failed` event, and map-data, counts, and status identical to before.
5. 409 `import_in_progress` while a job is running (use a registry whose executor never runs the work).
6. The synchronous import is unchanged: the existing `test_import_areas.py` passes untouched.

## Docs and specs

- `openspec/changes/add-live-import-and-showcase-client/specs/import-area-api/spec.md`: under
  `## ADDED Requirements`, add **"The API SHALL import in the background and stream stages as
  server-sent events"**, with scenarios for stage order, ring order, replay, failure leaving data
  intact, and the 409.
- `docs/client-features.md` → Import areas: add rows for background import and the events stream.
- `docs/architecture.md`: a short section on the in-process job registry and the single-transaction rule.
- `tasks.md`: add `- [x] 1.12e #90 [ingestion] Import in stages in the background and stream each stage as server-sent events`.

## Out of scope

Generated content (the `generated` stage is reserved, never emitted), splitting the Overpass query,
persisting job state across restarts, and the client side (brief 08).

## Outcome

- **Emit late, persist as today** (the brief's simpler option). `_persist` upserts everything in its
  existing order and announces stages afterwards: `ground` right after the sweep (so stale rows never
  go out), `roads` after turns, `blocks` after derivation, and `buildings` after they are linked to
  their blocks. `fetched` goes out once the payload is parsed and validated.
- **Layering.** The service doesn't know JSON. It calls `emit(stage, **info)` once a stage is flushed
  (`StageEmitter` type in `service.py`), and `app/api/background_import.py` maps it, reading the rows back
  through the job's own session (same transaction, so uncommitted rows are visible) with the `map-data`
  mappers. `ground` carries `area_features` and `pois`; `buildings` carries `ring` and `buildings`.
- `OSMIngestionService.import_staged(bbox, payload, emit)` shares `_persist` with `import_fixture`
  (which passes the no-op emitter and skips the ring batching entirely). It doesn't catch-and-mark-failed:
  the job rolls back. Non-ingestion exceptions are wrapped in `OSMIngestionError` like the synchronous path,
  so a block-derivation crash is `ingestion_failed`.
- `describe_error(exc)` in `app/api/errors.py` is the extracted mapping; the HTTP handlers for the import
  errors now call it, and the `failed` event uses it. `IntegrityError` maps to `import_conflict` there too.
- `app/ingestion/jobs.py`: `ImportJob`, `StageEvent`, `ImportJobRegistry` (thread pool of 2, ten-minute
  retention, `ImportAlreadyRunning`). `get_import_jobs` and `get_job_session_scope` are the overridable
  dependencies. `app/domain/rings.py`: `ring_batches` (with an optional `tie_break` key, because a generic
  item has no id) and `mean_vertex`. `ImportAreaRepository.find` is new, so the 409 check doesn't create an area.
- **`BuildingRepository.list_for_import_area` now uses `populate_existing`.** `link_to_containing_block`
  updates with raw SQL, so listing buildings in the same session straight afterwards returned the old
  (null) `block_id`. That would have put wrong `block_id`s in the `buildings` events.
- `ring` in a `buildings` event is the index of the non-empty ring (0, 1, 2, …), not the distance bucket,
  so empty rings leave no gap.
- Tests: `test_rings.py` (pure) and `test_background_import.py` (stage order and content, ring coverage,
  replay, failure leaving the area untouched, failed fetch, 409 for both paths, invalid rectangle, 404s).
  Not run locally; guards are not mutation-checked. Checked locally: `py_compile` and loading the app.
- Not done: nothing from the brief. The keep-alive comment line and the 0.25 s poll are not tested.

## Tangents found

- `BuildingRepository.link_to_containing_block` updates through raw SQL, so any caller that lists buildings
  from the same session afterwards gets stale `block_id`s unless it refreshes. Fixed for the one listing
  this brief needed; other repositories that mix raw SQL and ORM reads may have the same trap.
