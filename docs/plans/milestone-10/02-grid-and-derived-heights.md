# 02 — Elevation grid, tile source, storage and derived heights (#139, parts A and B)

Model: sonnet. Branch: `work/m10-grid`, from the tip of `origin/fix/136-dense-city-imports`. **One
commit per numbered part below**, don't push. `python3 -m py_compile` is fine. No `pytest` or other
suites: CI is the gate. Server only.

Read `docs/plans/milestone-10/00-decisions-and-contract.md` (the "contract") first. It fixes the
grid layout, the tables and the rules. This brief adds none of the API, import or client wiring;
that's brief 03, which builds on yours. Read the existing code each part names, and match its
style.

## 1. Domain: `server/app/domain/elevation.py` (pure: no DB, HTTP or imaging imports)

- `@dataclass(frozen=True) ElevationGrid`: `origin: Coordinate` (SW), `lat_step`, `lon_step`,
  `rows`, `cols`, and `heights: tuple[float, ...]`, row-major from south to north and west to east.
  Validate the shape in `__post_init__`.
  - `height_at(row, col)`.
  - `sample(point: Coordinate) -> float`: bilinear, clamped to the grid's edges.
  - `contains(point)`.
  - `points()`: each grid coordinate with its row and column.
- `grid_size_for(bbox, target_spacing_m=5.0, max_samples=256) -> tuple[int, int]`, using the
  contract's rule. Look at `app/domain/local_projection.py` for metres per degree, and reuse it.
- `smoothed(grid, radius_m) -> ElevationGrid`: a separable box blur. The radius in cells is
  computed per axis from metres per degree, edges are clamped, and the grid's metadata is unchanged.
- `building_base_height(grid, footprint: Polygon) -> float`: the minimum of `grid.sample` at the
  footprint's vertices and at every grid point inside the footprint. Use the existing
  point-in-polygon helper if `app/domain/` has one, or else a small pure one. The footprint is the
  domain `Polygon` (a tuple of `Coordinate`, closed).
- `vertex_heights(grid, line: LineString) -> tuple[float, ...]`: `grid.sample` at each vertex.
- Constants: `SMOOTHING_METERS = 30.0`, `ELEVATION_SOURCE = "aws-terrain-tiles"`,
  `ELEVATION_ALGORITHM = "terrarium-z15-bilinear-v1"`, and `TERRAIN_ATTRIBUTION` (the exact string
  from the contract).
- `server/tests/domain/test_elevation.py`:
  - bilinear sampling on a hand-built grid, including the edges and clamping;
  - the size rule with its clamps;
  - box blur preserving a constant grid and flattening a spike;
  - the base height of a footprint on a sloped grid equals its lowest corner, and includes an
    interior dip;
  - vertex heights.
- If `server/tests/domain/test_purity.py` keeps a list of modules, add `elevation` to it.

## 2. The tile source: `server/app/ingestion/elevation_source.py`

- Add `Pillow` to `server/requirements.txt`, pinned to a current version that installs on Python
  3.12 (check with `pip index versions pillow` or `pip download`, without installing globally).
- `class ElevationUnavailable(Exception)`.
- `class TerrainTilesSource`, modelled on `OverpassClient` in `app/ingestion/overpass.py`:
  - constructor `(url_template=DEFAULT_TERRAIN_URL, transport=None, sleep=time.sleep,
    backoff_seconds=…)`, with the same `User-Agent`;
  - `fetch_grid(bbox) -> ElevationGrid`.
- `fetch_grid`:
  - compute zoom-15 tile x/y for the box (Web Mercator) with a one-pixel margin;
  - fetch each tile, retrying 429 and 5xx with backoff like Overpass;
  - decode terrarium with Pillow, as RGB with `(R*256 + G + B/256) - 32768`;
  - sample bilinearly in global pixel space at every grid point from `grid_size_for`.
- Keep an in-process LRU cache of decoded tiles (`functools.lru_cache` or a small dict with a cap of
  about 256 tiles), so re-analysis and neighbouring imports don't refetch.
- A timeout, a transport error, or exhausted retries raises `ElevationUnavailable`. A 404 tile (the
  ocean beyond coverage) is treated as height 0 for that tile, not an error.
- `server/tests/ingestion/test_elevation_source.py`:
  - build terrarium PNGs **in the test** with Pillow (encode known heights, for example a plane
    rising east), and serve them through `httpx.MockTransport`;
  - assert the decoded and sampled grid matches the plane, and that the tile x/y covering a box are
    right;
  - assert a 429 is retried then succeeds, that exhausted retries raise `ElevationUnavailable`, and
    that a 404 tile counts as zeros;
  - no network, and no binary fixtures committed.

## 3. Storage: migration, models, repository

- An Alembic migration in `server/alembic/versions/`, named after the existing ones (for example
  `202610100001_create_elevation_tables.py`), creating the three tables in the contract with their
  cascades. Use `postgresql.ARRAY(sa.Float)` for the arrays and `LargeBinary` for `heights`. Look
  at an existing migration for the house style, including the downgrade.
- Models in `server/app/persistence/models.py`: `AreaElevationGridModel`,
  `BuildingElevationModel`, `RoadSegmentElevationModel`.
- `server/app/persistence/repositories/elevation.py`, `ElevationRepository(session)`:
  - `get_grid(area_id) -> StoredGrid | None`, where `StoredGrid` holds the grid, `version`,
    `source`, `algorithm`, `smoothing_meters` and `analysed_at`. Put it in the domain module if it
    stays pure, or else in the repository.
  - `save_grid(area_id, grid, smoothing_meters) -> int`: insert at version 1. If the stored grid's
    origin, steps, size and heights bytes are identical, change nothing and return the existing
    version. Otherwise replace it and bump the version. Pack heights with `struct` or `array` as
    little-endian float32. Watch out: compare after a float32 round trip, so an unchanged grid
    really compares equal.
  - `replace_building_bases(area_id, {building_id: base})` and
    `replace_segment_heights(area_id, {segment_id: (exact, smoothed)})`: delete the area's
    existing rows (via a join to the area's buildings and segments), then insert. Writing the same
    values again must leave the same rows.
  - `building_bases(area_id) -> dict` and `segment_heights(area_id) -> dict`, for brief 03's
    mappers.
- No change to `ImportAreaRepository.delete` should be needed, because of the cascades. Confirm
  that, and say so in your report.
- `server/tests/persistence/test_elevation_repository.py`: the save and version rules (first save
  is v1, an identical save stays v1, a changed save is v2); replace being idempotent; and the
  cascades (deleting the area via `ImportAreaRepository.delete` removes all three tables' rows).
  Build areas the way `test_import_area_repository.py` does.

## 4. The analysis service: `server/app/ingestion/elevation_analysis.py`

- `class ElevationAnalysis(session, source: TerrainTilesSource)`, with `analyse(area: ImportArea) ->
  ElevationResult` (the version, whether the grid changed, and how many buildings and segments got
  heights).
  - Fetch the grid for `area.bbox`, then `save_grid`, and build the smoothed grid with
    `smoothed(grid, SMOOTHING_METERS)`.
  - For each of the area's own buildings (`BuildingRepository.list_for_import_area`), store
    `building_base_height(grid, building.geom)`.
  - For each of the area's own road segments (find the repository method that lists them with
    their geometry, as `get_map_data` does), store `vertex_heights` from the exact and the smoothed
    grid.
  - It doesn't commit. The caller commits, as other services do.
  - It touches no observed table.
  - `ElevationUnavailable` propagates, and nothing is written in that case. Fetch before any write.
- `server/tests/ingestion/test_elevation_analysis.py`, with a stub source returning a hand-built
  sloped grid:
  - import a fixture area (follow existing service tests) and analyse it;
  - building bases equal the lowest corners, and segment arrays have one value per vertex;
  - a second analysis returns `changed=False` with the same version, and the rows are unchanged;
  - building ids, block ids and entity counts are identical before and after;
  - a source raising `ElevationUnavailable` leaves no elevation rows.

## 5. Docs

`docs/schema.md`: brief 01 (docs) also edits this file in parallel. **Don't touch
`docs/schema.md`.** The coordinator merges the docs. Mention anything about the tables you think
the docs need in your report.

Commit messages, one per part, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(domain): elevation grid, sampling, smoothing and the building base rule (#139)`
2. `feat(ingestion): fetch and decode AWS Terrain Tiles into an elevation grid (#139)`
3. `feat(persistence): store elevation grids and derived heights apart from observed tables (#139)`
4. `feat(ingestion): analyse an area's elevation into stored building and road heights (#139)`

Report: the SHAs, `git show --stat` for each, the Pillow version, how you made the grid-equality
check robust, the repository method you used for segments with their geometry, and anything in
the contract that didn't fit the source.
