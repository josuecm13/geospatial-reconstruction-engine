# Milestone 11: decisions and contract (#23)

The shared reference for every Milestone 11 brief, and the contract between the server and client
parts, which are built in parallel. Follow it. If something here doesn't fit the source, report it
rather than improvise. The owner's decisions are in #23. This file makes them buildable.

## Layering

- `server/app/domain/generation.py`: pure value types and pure rules (eligibility, fingerprint maths,
  matching, seeded sampling). No shapely, no DB. Add it to `tests/domain/test_purity.py` if that file
  lists modules.
- `server/app/generation/` (new package): the geometry-heavy work (suitability, frontage, lot
  layout), using **shapely 2** (already a dependency, used in `app/persistence/`). All geometry is in
  **local metres** via `app/domain/local_projection.py` (`local_projection_for(area.bbox.ring())`),
  converted back to WGS84 for storage.
- Persistence goes in `server/app/persistence/` (models, repositories, one Alembic migration per brief
  that needs tables), and the API in `server/app/api/`.
- Generation **never writes to an observed table**: streets, roads, nodes, segments, turns, blocks,
  block_boundary_segments, buildings, POIs, area features, traced boundaries.

## 1. Eligibility (per block, pure)

A block is eligible when it's fully enclosed by roads and has room to build. The `eligibility` field
is one of:

- `eligible`
- `clipped` (`is_clipped`)
- `median` (`is_median`)
- `no_buildable_area` (`buildable_area` is null or under 30 m²)

They're checked in that order, and the first reason wins. `domain/generation.py:eligibility(block)`
returns the enum value. Only the area's **own** eligible blocks are generated on: composed inner areas'
blocks belong to their own areas' runs.

## 2. Land-use ingestion (new area-feature kinds)

`AreaFeatureKind` gains these values:

| Kind | OSM tags |
|---|---|
| `forest` | `landuse=forest`, `natural=wood` |
| `farmland` | `landuse=farmland\|meadow\|orchard\|vineyard\|farmyard` |
| `cemetery` | `landuse=cemetery`, `amenity=grave_yard` |
| `railway` | `landuse=railway` |
| `industrial` | `landuse=industrial` |

Extend `_area_kind` in `osm_adapter.py`, keeping the existing order and the existing kinds first. The
Postgres enum `area_feature_kind` gains the values in an Alembic migration (`ALTER TYPE ... ADD
VALUE`). The client draws the new kinds (see 9).

## 3. Suitability inside an eligible block (`app/generation/suitability.py`)

The input is an eligible block's buildable area. The output is a `Suitability` with:

- `suitable`: a MultiPolygon in local metres where buildings may go;
- `zones`: a list of `(reason, polygon)` for display;
- `style`: the block's settlement style.

Excluded, subtracted from `suitable`, each with a zone:

| Reason | Rule |
|---|---|
| `water` | water area features, buffered by **20 m** |
| `steep` | grid cells whose slope exceeds **30%**: the gradient magnitude from the stored exact grid, cells unioned into polygons. Needs stored elevation; skipped, with no zone, when the area has none. |
| `landuse` | `forest`, `farmland`, `cemetery`, `railway`, `industrial` and `park` features, intersected with the block |
| `setback` | the front setback strip (see 5), added per block after its reference is matched |

Style, one per block:

- **`informal`** when the block's suitable-area centroid lies within 150 m of water and its ground
  height minus the nearest water's ground height is under **2 m**. That's height above nearest water;
  both heights are sampled from the stored grid.
- **`sparse`** when real-building coverage within 500 m of the block centroid is under **5%** of land
  area, which counts as rural.
- **`regular`** otherwise.
- Without elevation, `informal` is never chosen.

## 4. Reference blocks and fingerprints (`domain/generation.py` + `app/generation/fingerprint.py`)

- **Frontage line:** the exterior ring(s) of the block's buildable area (the street-front line). Its
  length is `frontage_m`.
- **For each real building in the block** (`buildings.block_id`), against the nearest frontage edge:
  - `front_setback_m`: the minimum distance from the footprint to that edge;
  - `width_m`: the footprint's extent projected along the edge;
  - `depth_m`: its extent perpendicular to the edge;
  - its area and levels (null if unknown).
- **Side gap:** sort the buildings along each edge by projected position. `side_gap_m` is the gap
  between neighbours' projected intervals, floored at 0. 0 means attached.
- **Frontage coverage:** `covered_m / frontage_m`, where `covered_m` is the union of the buildings'
  projected intervals.
- **Exemplar:** an eligible block with `coverage >= 0.70` and at least **3** buildings.
- **Fingerprint** (stored per exemplar block per run, so it's reproducible):
  - median and IQR of `width_m`, `depth_m`, `front_setback_m` and `side_gap_m`;
  - median `levels` (null when unknown);
  - the coverage ratio;
  - the `style` of the block.
- **Defaults by the strongest bounding road class**, used when no exemplar matches:

  | Bounding road | width | depth | setback | gap | levels |
  |---|---|---|---|---|---|
  | residential / unclassified / living_street | 10 m | 12 m | 4 m | 3 m | 2 |
  | tertiary / secondary | 14 m | 16 m | 2 m | 1 m | 3 |
  | primary / trunk | 18 m | 20 m | 1 m | 0 m | 5 |

  `sparse` multiplies the gap by 4. `informal` uses width 6, depth 7, setback 0.5, gap 0.5 and levels 1.

## 5. Matching (pure)

For each eligible, non-exemplar block, the candidates are exemplars whose block centroid is within
**500 m**, from any completed import area (query other areas' blocks spatially, with
`ST_DWithin` on geography). The score is `distance_m / 500 + road_class_mismatch (0 or 1) +
|log(area / exemplar_area)| + style_mismatch (0 or 1)`. The lowest score wins, with the block id as
the tie-break. The block uses the best exemplar's fingerprint, or the defaults when there's none,
recording `reference_block_id` (null for defaults). An exemplar block references itself and fills
only its empty frontage.

## 6. Generator (`app/generation/generator.py`)

- **Determinism:** run seed `S`, given or chosen as described in 8. Each block's RNG is
  `random.Random(f"{S}:{block_id}")`. Never depend on iteration order: sort blocks and edges by id
  or position.
- **Per block:**
  1. Inset the frontage by the fingerprint's front setback. That strip is the `setback` zone.
  2. Walk each frontage edge from its start, in a stable order.
  3. For each lot, sample the width, gap and depth from a normal distribution with mean = median and
     σ = IQR / 1.35, clamped to [0.5×, 1.5×] the median.
  4. The footprint is a rectangle `width × depth` on the inner side of the edge, oriented to it.
     `informal` adds a seeded rotation jitter of up to ±8° and an offset of up to 1 m.
  5. Accept a footprint only if it lies inside `suitable`, doesn't intersect a real building or an
     already accepted footprint, and has an area of 15 m² or more.
  6. The levels are the fingerprint's median levels, or the default levels. Height = levels × 3 m.
     `base_elevation_meters` is `building_base_height(grid, footprint)` (Milestone 10) when the area
     has a grid, else null.
- **Feedback** (see 7), when present:
  - **count N:** generate up to N, using an evenly spaced subset of the accepted lots in walk order,
    so it's deterministic. If the frontage yields fewer than N, generate what fits, and report
    `feedback_shortfall`.
  - **`no_buildings`:** generate nothing.
  - These buildings get `count_source = "feedback"`.
- **Calibration** (for non-feedback blocks): over blocks with feedback within 500 m that share this
  block's style, `ratio = Σ feedback_count / Σ generated_count_in_previous_run`. Divide the lot width
  by `clamp(ratio, 0.5, 2.0)` when at least 2 such blocks exist. Record `calibration_ratio` on the
  run's parameters.
- **Promotion:** a block with feedback and at least 3 real or confirmed buildings counts as an
  exemplar candidate. It's still subject to the coverage rule on its real buildings: feedback alone
  doesn't make it one.

## 7. Storage (one migration)

- **`generation_runs`:**
  - `id` UUID PK;
  - `import_area_id` FK import_areas **ON DELETE CASCADE**, **unique**: one current run per area, and
    a regenerate replaces it;
  - `seed` bigint, `algorithm_version` text (`"frontage-lots-v1"`), `parameters` jsonb;
  - `elevation_version` int (null when there's no grid);
  - `road_graph_hash` text: the sha256 of the area's sorted own block ids;
  - `building_count` int, `block_count` int, `created_at` timestamptz.
- **`generated_buildings`:**
  - `id` UUID PK, `run_id` FK generation_runs ON DELETE CASCADE;
  - `block_id` UUID FK blocks **ON DELETE CASCADE**: a re-import that sweeps a block removes its
    generated buildings, and the run is then stale;
  - `geom` POLYGON 4326, `height_meters`, `levels`, `base_elevation_meters` (nullable);
  - `style` text, `reference_block_id` UUID (nullable, no FK);
  - `count_source` text: `reference` | `default` | `feedback`.
- **`generation_zones`:** `id`, `run_id` FK cascade, `block_id` FK blocks cascade, `reason` text,
  `geom` MULTIPOLYGON 4326.
- **`block_fingerprints`:** `run_id` FK cascade, `block_id` UUID (no FK; it may be another area's
  block), `fingerprint` jsonb, PK (run_id, block_id).
- **`block_feedback`:**
  - `block_id` UUID PK, **no FK**: feedback must survive to be reported as orphaned;
  - `import_area_id` UUID FK import_areas ON DELETE CASCADE;
  - `building_count` int null, `no_buildings` bool;
  - CHECK exactly one of `building_count` or `no_buildings` is set;
  - `updated_at`.
- **Stale:** a run is stale when the area's current `road_graph_hash` differs (`roads_changed`) or
  the area's current grid version differs (`terrain_changed`). It's computed on read.
- `ImportAreaRepository.delete` keeps working through the cascades. Check that.

## 8. API contract

**`POST /import-areas/{id}/generation`** takes an optional body `{"seed": int}`.
- With no body, the seed is the current run's seed if there is one, else **1**.
- It answers `202 {"import_area_id", "events_url"}` and streams on the existing
  `/import-areas/{id}/events`: one `generation` event `{"block_count": n}`, then `completed`
  `{"run": <run object>}` or `failed`.
- `404 import_area_not_found`. `409 import_area_not_ready` (not completed). `409 import_in_progress`
  (any job for the area: imports, re-analysis or generation share the registry).
- The job replaces the area's run in one transaction.

**`GET /import-areas/{id}/generation`** returns the run object or `404 generation_not_found`:

```jsonc
{ "run_id": "...", "seed": 1, "algorithm_version": "frontage-lots-v1", "created_at": "...",
  "building_count": 412, "block_count": 57, "eligible_block_count": 61,
  "stale": false, "stale_reasons": [],            // "roads_changed" | "terrain_changed"
  "feedback_shortfall_block_ids": [], "calibration_ratio": null }
```

**`DELETE /import-areas/{id}/generation`**: `204`, or `404 generation_not_found`.

**`GET /import-areas/{id}/map-data`** (both modes) gains:

- `generation`: the run object or null.
- `generated_buildings`: a FeatureCollection.
  - Properties: `block_id`, `style`, `levels`, `height_meters`, `base_elevation_meters`,
    `reference_block_id`, `count_source`, and `generated: true`.
  - It's composed from the owner areas (own and inner), like buildings.
  - It follows the scope like buildings. Clip mode clips geometry.
- `generation_zones`: a FeatureCollection with properties `block_id` and `reason` (`water` | `steep`
  | `landuse` | `setback`), from the area's own run.
- Block features gain:
  - `eligibility`;
  - `real_building_count`;
  - `generated_building_count`, 0 without a run;
  - `is_reference`: true when the block was an exemplar in the current run;
  - `reference_block_id`: the block it learned from, or null;
  - `style`: null without a run;
  - `feedback`: `{"building_count": n|null, "no_buildings": bool, "updated_at"}` or null.

**`PUT /blocks/{block_id}/feedback`**
- Body: exactly one of `{"building_count": int >= 0}` or `{"no_buildings": true}`. Otherwise
  `422 invalid_request`.
- `200` with the stored feedback. `404 block_not_found`.

**`DELETE /blocks/{block_id}/feedback`**: `204`, or `404 feedback_not_found`.

**`GET /import-areas/{id}/feedback`** lists the area's feedback, each entry with
`"orphaned": true|false`. Orphaned means its block id no longer exists.

**`GET /settings/featured-area`** returns `{"import_area_id": "<uuid>" | null}`.

**`PUT /settings/featured-area`**
- Body: `{"import_area_id": "<uuid>" | null}`. Null clears it.
- `200` with the stored value.
- `404 import_area_not_found`. `409 import_area_not_ready` when the area isn't completed.
- Deleting an area that's featured clears the setting, in `ImportAreaRepository.delete` or by a
  cascade.

Storage is a `site_settings` table: `key` text PK, `value` jsonb, `updated_at`. The key is
`featured_area_id`.

## 9. Client contract

- **Types** mirror section 8 exactly.
- **Palette:**
  - Generated buildings use a new `buildingGenerated` material/colour, clearly distinct from the
    measured and defaulted buildings (for example a cool tint on the night-clay palette), in 3D and in
    the 2D overlay colours (`views/mapColors.ts`).
  - The new area kinds are drawn too: forest and farmland as greens distinct from park, cemetery a
    muted green-grey, railway and industrial a neutral grey.
  - Keep the token and contrast guards (`styleTokens.test.ts`, the map-colour scan) green.
- **Generate / Regenerate:**
  - The scene view shows **Generate** when the area has no run, and **Regenerate** when it has one,
    highlighted when it's stale.
  - Regenerate asks the server for a **new seed**: `Math.floor(Math.random() * 2**31)`, sent in the
    body.
  - Progress follows the events stream as "Add terrain" does. On completion, it reloads map-data.
- **Show generated:** a checkbox, checked by default when a run exists, toggling the `generated`
  world group, which is reserved in `WORLD_GROUPS`. The glTF export includes generated buildings
  only while shown, because `onlyVisible` already does that.
- **Blocks:**
  - An inset **dashed outline**, 1.5 m inside the block boundary.
    - In 3D, draped on the terrain like the other ground layers (grid-cut, `LineDashedMaterial`).
    - In 2D, MapLibre `line-dasharray`.
  - Crisp for `eligible`, faint and dotted for the other eligibility values, solid and highlighted
    when selected.
  - **Show blocks** replaces "Show buildable area".
- **Selection:**
  - Clicking a block (3D raycast or 2D click) opens a panel:
    `Block · real: N · generated: M · reference: <short id or "defaults"> · style: …`
    with **Actual number of buildings** (a number input) and **No buildings here**, which `PUT`
    feedback, and **Clear feedback**.
  - After a change, it shows "Applies on the next Generate".
- **Zones:** `generation_zones` are shaded by reason when **Show blocks** is on.
- **Set point:**
  - A **Set point** tool button with the shortcut `P`, plus double-click on the ground, drops a pin
    on the terrain.
  - Fly mode eases its OrbitControls target to the pin over about 400 ms (instant under reduced
    motion) and keeps its distance and angle. OrbitControls' `zoomToCursor` is on.
  - Walk mode starts at the pin at eye height, facing the camera's horizontal direction. A pin inside
    a footprint moves to the nearest open point (reuse `collision.ts`).
  - **Reset to centre** clears it.
  - The pin is a small marker with a ground ring, excluded from picking and from the export.
- **Featured place:**
  - Locations cards for completed areas get **Show on landing**, and the featured card shows a badge.
  - The landing page reads `GET /settings/featured-area`, then `VITE_FEATURED_AREA_ID`, then the most
    recent import (`landing/featured.ts`).
