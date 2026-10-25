# 11 — Void pixels in the terrain tiles become deep pits (server)

Folded into PR #143 at the owner's request. Branch from `feat/141-scene-themes`, commit on `work/terrain-voids`, don't push.

## Problem
`server/app/ingestion/elevation_source.py` decodes terrarium tiles and bilinearly samples them into an `ElevationGrid` with no check
for broken pixels. Near coasts the tiles have voids/bad pixels. The stored grid for Santa Ana (Panama City, about 8.95 N, 79.55 W)
has 72 single cells more than 15 m below the median of their 8 neighbours, the worst 310 m (-303.7 m in a city near sea level).
The scene draws them as downward spikes. Costa Rica grids checked the same way have none.

## Change
- Add a pure domain function (in `server/app/domain/elevation.py`, no I/O) that despikes a grid: a cell whose height differs from the
  median of its in-grid neighbours (8, fewer on edges/corners) by more than a threshold AND lies outside the min..max of those
  neighbours is replaced by that median. Threshold as a named constant (e.g. 15 m — real 30 m-spaced terrain rarely jumps that far
  beyond all neighbours; justify in a comment). One pass over the original values (don't cascade). Handle both pits and peaks.
  Consider clusters of 2–3 bad cells: a second pass is acceptable if it's simple; say what you chose.
- Apply it in `TerrainTilesSource.fetch_grid` before returning the grid (or better, on the decoded tile pixels before bilinear
  sampling, if that's cleaner — bilinear spreads one bad pixel into up to 4 grid cells; pick and justify).
- Bump `ELEVATION_ALGORITHM` to `terrarium-z15-bilinear-despike-v2` (or similar). The repository already bumps `version` when heights
  change, so re-analysis refreshes existing areas; confirm by reading `server/app/persistence/repositories/elevation.py`.
- Building base heights and road heights are derived from the grid in `elevation_analysis.py`; confirm they read the despiked grid.
- Update `docs/architecture.md` (terrain section) in a sentence or two.

## Tests
Unit tests in `server/tests/domain/` (or next to existing elevation tests): a flat grid with one -300 m cell is fixed; a real slope
(linear ramp) is untouched; an edge/corner pit is fixed; a peak is fixed. Plus a source-level test in
`server/tests/ingestion/test_elevation_source.py` with a fake tile containing a void, if the existing fake-transport helpers make it cheap.
Don't run test suites locally (CI is the gate).

## Commit
`fix(ingestion): void pixels in the terrain tiles no longer become pits (#141)` with the trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
