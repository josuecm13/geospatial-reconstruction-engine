# 03 — Elevation in imports, re-analysis, and the API (#139, parts C, D and E)

Model: sonnet. Branch: `work/m10-api`, from the tip of `origin/fix/136-dense-city-imports` **after
brief 02's commits are on it**. The coordinator tells you the commit to start from. **One commit
per numbered part**, don't push. `python3 -m py_compile` is fine. No suites: CI is the gate. Server
only.

Read `docs/plans/milestone-10/00-decisions-and-contract.md` (the "contract") first. Its "API
contract" section is binding, because the client (brief 04) is being built against it in parallel.
Brief 02 already added these, so build on them and don't rewrite them:
- `app/domain/elevation.py`: `ElevationGrid`, `smoothed`, `vertex_heights`, the constants and
  `TERRAIN_ATTRIBUTION`;
- `app/ingestion/elevation_source.py`: `TerrainTilesSource`, `ElevationUnavailable`;
- `app/persistence/repositories/elevation.py`: `ElevationRepository`;
- `app/ingestion/elevation_analysis.py`: `ElevationAnalysis`.

## 1. Configuration and the import stage

- `app/api/dependencies.py`: add `get_elevation_source() -> TerrainTilesSource | None`, modelled
  exactly on `get_geocoder`. `ELEVATION_URL` overrides the template, and `off` or an empty string
  gives `None`.
- In `app/api/background_import.py` `background_import_work`, after the import commits and the
  area is named:
  - run `ElevationAnalysis(session, source).analyse(area)` and commit;
  - then `job.emit("elevation", {...})` with the contract's stage data (`projection`,
    `elevation` = the map-data elevation object for the area, and `error`);
  - then `completed`.
- On `ElevationUnavailable`: roll back only the elevation work (don't lose the committed import),
  log a warning, and emit `elevation` with `elevation: null, error: "elevation_unavailable"`.
- When the source is `None` (disabled), emit `elevation` with `elevation: null, error: null`.
- Thread the dependency through `_start_background_import` and the router, as `geocoder` is.
- `StageEmitter._layers` raises on unknown stages. Either emit `elevation` through `job.emit`
  directly, as `completed` is, or add the stage there. Pick whichever keeps `projection` in the
  data.
- Synchronous `POST /import-areas` (`api/routers/import_areas.py` near line 131): run the same
  analysis after the import and naming. On `ElevationUnavailable`, log and still answer as before.
- Put a helper `elevation_out(stored_grid) -> dict | None` in `app/api/mappers.py`, building the
  contract's object (heights rounded to 0.1). Add a matching pydantic model in `api/schemas.py`
  (`ElevationOut`, `ElevationGridOut`) if that keeps the response typed. Brief 1's stage and
  map-data both use it.
- Add an `elevation_unavailable` error mapping (503) wherever `describe_error` / `ApiError` maps
  ingestion errors. Check how `UpstreamUnavailable` is mapped, and mirror it.
- Tests:
  - `tests/api/test_background_import.py`: the stage list now includes `elevation` before
    `completed`, carrying an elevation object with a stub source.
  - With a source that raises, the import still completes, `elevation` is null, and `error` is set.
  - With the source disabled, `elevation` is null and `error` is null.
  - Override `get_elevation_source` the way the tests override `get_geocoder` and
    `get_overpass_client`. **Every existing API test must keep working with no network.** Make sure
    the conftest overrides `get_elevation_source`, to a stub or `None`, for all tests by default.

## 2. Re-analysis endpoint and script

- `POST /import-areas/{id}/elevation` in `api/routers/import_areas.py`, as the contract says. Use
  the `completed_import_area` dependency for 404 and 409 `import_area_not_ready` (check it raises
  those codes), and `jobs.start(area.id, …)`. Translate `ImportAlreadyRunning` with the existing
  `_import_in_progress`. The job body:
  - opens a session through `session_scope`;
  - runs the analysis, commits, and emits `elevation`;
  - emits `completed` with `{"import_area_id": ..., "version": ..., "changed": ...}`;
  - on any error, rolls back and emits `failed` with `describe_error`'s code and message.
- If the source is disabled, answer `503 elevation_unavailable` straight away.
- `server/scripts/backfill_elevation.py`, modelled on `server/scripts/backfill_place_names.py`:
  - by default it runs over every completed area **without** a grid, and with `--all` over every
    completed area;
  - it runs one area at a time, commits per area, and keeps going on a per-area failure;
  - it prints one line per area (id, version, changed or error) and a summary.
  - Document it in `docs/runbook.md`, next to the place-name backfill if that's described there.
- Tests:
  - `tests/api/test_elevation_reanalysis.py`: 202 then events `elevation` and `completed`. A
    second run's `completed` says `changed: false` with the same version.
  - Unknown id → 404. An area not completed → 409 `import_area_not_ready`. A running job → 409
    `import_in_progress`. Source disabled → 503.
  - Building ids, block ids and counts are unchanged by re-analysis.
  - Look at how `test_background_import.py` drives the registry synchronously.
  - A small test of the script's per-area loop with a stub source, if the place-name script has
    one. Otherwise skip it.

## 3. Elevation in map-data and the scoped export

- `get_map_data`:
  - load the requested area's stored grid and set `elevation` (null when there's none);
  - load stored building bases for every owner area (`area.id` and the composed ones) and segment
    heights for the area;
  - add the contract's feature properties: `base_elevation_meters` on buildings, and
    `elevation_exact` / `elevation_smoothed` on road segments (null when absent).
- Add the properties in the mappers, through optional parameters on `building_feature` and
  `segment_feature`, so the other callers (the stages and the spatial queries) stay unchanged.
- Clip mode: after `_clipped`, a segment's geometry may be cut, or become a MultiLineString.
  Re-sample both arrays at the clipped geometry's vertices from the stored grid and its smoothed
  grid (`smoothed(grid, stored.smoothing_meters)`). For a MultiLineString, flatten the parts' vertices
  in order. Without a grid, both stay null.
- `MapDataOut` gains `elevation: ElevationOut | None = None`.
- Tests in `tests/api/test_scope_export.py` / `test_scope_export_clip.py`, or a new
  `tests/api/test_map_data_elevation.py`:
  - null without analysis;
  - after analysis with a stub sloped grid: the object's shape and size, building bases, and
    segment arrays the same length as their vertices;
  - clip mode arrays matching the clipped vertices;
  - a boundary scope still carrying the whole area's grid.
- Specs and docs:
  - Update `docs/client-features.md` with rows for `elevation` on map-data, the re-analysis
    endpoint and the `elevation` stage, using the format of the existing rows (client column "—";
    brief 04 fills it in).
  - **Don't edit `openspec/`.** The OpenSpec change is being written in parallel by brief 01, and
    the coordinator reconciles it.

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(ingestion): add elevation to every import as its own stage (#139)`
2. `feat(api): re-analyse an area's elevation in the background, and backfill every area (#139)`
3. `feat(api): serve elevation, building bases and road heights in map-data and the export (#139)`

Report: the SHAs, `git show --stat` each, how the elevation step is isolated from the committed
import on failure, how the tests avoid the network by default, and anything in the contract that
didn't fit the source.
