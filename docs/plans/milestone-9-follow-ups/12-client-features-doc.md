# 12 — client-features.md matches the code (#116)

## Goal

Every row of section 1 ("API capabilities") in `docs/client-features.md` says what the client
actually does today, in both the 2D map and the 3D scene, with the Client column using only the
legend's values (`—`, `partial`, `done`). This brief changes docs only.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 116`.

Both of the issue's claims hold:

- Line 40 says `block_feature` "exposes only `area_square_meters`". It exposes all of the block's
  properties (`server/app/api/mappers.py:124-136`: `area_square_meters`, `buildable_area`,
  `buildable_area_square_meters`, `is_median`, `is_clipped`, `import_area_id`).
- Several Map data rows say `—` or describe only the 3D scene, though the 2D map draws five layers
  and describes each on click.

The audit below found more stale rows than the issue names.

## Depends on

Run this **after** briefs 06 (#109, `GET /routing-strategies`) and 07 (#108, spatial queries
compose nested areas). Both add or change rows in this file. Re-read their rows as they landed and
check them like the rest. Line numbers below are from before 06 and 07; match on the row text.

## Code to read first (what the client does today)

- 2D map: `client/src/views/mapDataLayers.ts`. `LAYERS` (7) are area_features, blocks, road_segments,
  buildings and pois; navigable nodes aren't drawn.
  - Blocks are filled from the block **boundary** (the feature geometry), colored by `is_median`.
  - Roads are drawn at their generated width in meters (`show`, 65, `geo/roadWidth.ts`), colored by
    `lane_type`.
  - Buildings are colored by known vs. null `height_meters`.
  - Clicking describes a feature (`featureRows`, 94-127):
    - roads: street name, class, lanes with provenance, lane type, width, length;
    - buildings: category, height, levels, in a block;
    - blocks: area, buildable m², median, clipped;
    - POIs: name and category;
    - area features: kind.
- 3D scene: `client/src/scene/buildWorld.ts`. It draws area features, roads (deduplicated by
  `street.id`, 75), the blocks' `buildable_area` (hidden by default), and buildings. It doesn't draw
  POIs, block boundaries, or navigable nodes. It uses `projection` for local meters
  (`scene/projection.ts`).
- Attribution:
  - 2D: always visible, uncollapsed (`views/mapView.ts:29-32`).
  - glTF: carries it as `copyright` and `extras` (`scene/exportGltf.ts:10-19,44`).
  - The 3D scene shows **no** on-screen attribution (`views/sceneView.ts` has none).
- Scope: both views load map-data for the selected scope (`state/selection.ts:88-90`
  `mapDataQuery`, used by `scene/sceneLoader.ts:85` and the import panel), so filter-mode export
  of a boundary is what both views draw. Nothing requests `mode=clip`. `ExportMode` exists only as a
  type (`api/types.ts:101`).
- Import status and counts:
  - After an import, the panel prints road, building, block, POI and area-feature counts
    (`importing/importPanel.ts:238-240`).
  - Location cards show any status ("Waiting to import", "Importing", "Import failed",
    `locations/cardModel.ts:32-35,79-80`) and building, road and block counts (74-76).
  - `skipped_restriction_count`, `node_count` and `linked_building_count` aren't shown anywhere
    (grep).
- Spatial queries (`nearby`, `within-bbox`, `nearest`, `footprint-area`): no client call exists
  (grep `client/src`).
- Composition: both views draw the composed response as one place. The staged build shows inner
  areas built at once (`scene/stagedScene.ts:186-196`, `addBuilt`). Nothing displays a feature's
  `import_area_id`.

## Design: the rows to change, and what they should say

Keep each row's API-status cell as it is, unless noted. Client-notes text that is a to-do and is
done now becomes a statement of what's built.

| Line | Row | Stale | Should say |
|---|---|---|---|
| 21 | Import a bounded area | "Draw **or enter** the rectangle". There's no coordinate entry. "Show the 1 km² limit… Warn that re-import is destructive" are written as to-dos, but both are built (`importPanel.ts` area readout; `REIMPORT_WARNING`) | "Draw the rectangle, then drag…" (rest as is). Replace the to-do sentences with "The area readout shows the 1 km² limit; re-importing warns that it is destructive." |
| 23 | Import status and entity counts | Client `—` | `partial`: counts after an import (roads, buildings, blocks, POIs, area features) and on location cards (buildings, roads, blocks); cards show `pending` / `importing` / `failed`. Node and linked-building counts aren't shown. |
| 34 | Road segments | Notes cover 3D only | `partial`. 2D: lines at the generated width, described on click with length. 3D: flat strips at `width_meters`, drawn once per two-way road. `from_node_id` / `to_node_id` and `is_vehicle_accessible` aren't shown. |
| 35 | Road cross-section | Notes are a to-do run into a 3D note, with no separator | `partial`. 2D: width and `lane_type` color; the popup shows `lane_count` with its provenance and the lane type. 3D: strip width and `lane_type` color. `source_lane_count` isn't shown. |
| 36 | Street name, classification | Client `—` | `partial`: name and class in the 2D road popup; no labels, no styling by class. |
| 37 | Logical street id | Client `—` | `partial`: used to draw a two-way road once in 3D (`buildWorld.ts`); a whole street can't be selected yet. |
| 39 | Blocks: boundary, `area_square_meters` | "3D: not drawn" only | `partial`. 2D: filled from the boundary, median blocks darker, area in the popup. 3D: the boundary isn't drawn (only the buildable area). |
| 40 | Blocks: `buildable_area`, … | "**`block_feature` exposes only `area_square_meters`**" is false | Drop that sentence. `done`. 2D popup: buildable m², median, clipped. 3D: the translucent buildable-area overlay, hidden until "Show buildable area" is ticked. |
| 41 | Buildings | Notes cover 3D only | `done`. 2D: solid when `height_meters` is known, paler when null; the popup shows height, levels, category and whether it's in a block. 3D: as today's note. |
| 42 | POIs | Client `—` | `partial`: 2D circles described by name and category; not drawn in 3D. |
| 43 | Area features | Notes cover 3D only | `done`: 2D fill (water blue, the rest green) described by kind; 3D flat shapes, the same colors. |
| 44 | Composition of nested areas | Client `—` | `done`: both views draw the composed response as one place; a staged import shows the inner areas built at once. A feature's owning area isn't displayed. |
| 45 | `attribution` | Note is only "Required" | Keep `partial`. 2D: always visible, uncollapsed. glTF: the asset copyright and root extras. **The 3D scene shows none on screen**, which is the gap. |
| 61-63 | Routing rows | Client column holds "shipped: …" prose, not a legend value | `done` in the Client column, with the prose moved to Client notes. Row 62's text is whatever brief 06 left (it replaces the probe with `GET /routing-strategies`): check it against `ApiClient.routingStrategies` after 06. |
| 71 | Scope … to a boundary | "the 3D scene follows in its own brief" | "the 3D scene loads the same scope (`SceneLoader`)". |
| 72 | Export a scope in filter mode | Client `—` | `partial`: both views load `map-data?boundary_id=…` for the selected boundary, and the glTF file is named by `scope`; there's no GeoJSON download. |
| 74 | Local projection metadata | Client `—` | `done`: the 3D scene builds in local meters from `projection` (`scene/projection.ts`), and the glTF root extras carry it. |
| 83 | Footprint previews | The API-status cell holds an endpoint (`GET …/map-data`) | API status `n/a` (client-side drawing, as the other rows in that table use), with the endpoint moved into the notes. |

Brainstorm section (also stale, same file):

- "Real-width roads: draw road polygons from `width_meters` instead of 1 px lines" is built in 2D
  (`mapDataLayers.ts:65`) and 3D. Mark it "(shipped)" like the "Staged build" and "Fly and walk"
  bullets.

Rows checked and still correct: lines 22, 24, 25, 26, 27, 28, 38, 51-55 (still `—`; brief 07 may
reword the "(whole import area)" heading or the rows to say inner areas are composed; check its
wording), 64, 70, 73, 80, 81, 82, and the Error contract section.

Don't fix the gaps themselves (the missing 3D attribution, `is_vehicle_accessible` never shown).
Record each under `Coordinator review: restored the footprint-previews row's API column (`preview.ts` calls `GET /import-areas/{id}/map-data`, so it isn't `n/a`), and replaced a wrong issue number on the real-width roads bullet (#89 is a turn-restriction fix; the roads shipped with #63).

## Tangents found` if it isn't already an issue. The missing 3D attribution
contradicts the row's "Required: must always be visible".

## Tests

None: this is a docs-only change. Do a review pass instead. For every row you change, open the
cited file and confirm the claim, then list in `## Outcome` the rows changed and the evidence
(file:line) for each.

## Docs and specs

- `docs/client-features.md`: the rows above. This is the whole change.
- No spec changes: no behavior changes.

## Outcome

Updated 18 rows in `docs/client-features.md` to match the code as it stands after briefs 06 and 07 landed:

**Rows changed:**
- Line 21 (Import a bounded area): simplified prose, stated that area readout shows limit and re-import warns
- Line 23 (Import status and entity counts): Client `—` → `partial`, with description of what's shown
- Line 34 (Road segments): added 2D description of lines at generated width, described on click with length
- Line 35 (Road cross-section): added 2D description (width, lane_type color, lane_count with provenance in popup)
- Line 36 (Street name, classification): Client `—` → `partial`, noted in 2D road popup
- Line 37 (Logical street id): Client `—` → `partial`, noted it's used to draw two-way road once in 3D
- Line 39 (Blocks: boundary): added 2D description (filled from boundary, median darker, area in popup)
- Line 40 (Blocks: buildable_area): Client `partial` → `done`, removed false claim about `block_feature` exposing only `area_square_meters` (verified `block_feature` in `server/app/api/mappers.py:124-136` returns all properties)
- Line 41 (Buildings): Client `partial` → `done`, added 2D description (solid when height known, popup shows height/levels/category/block membership)
- Line 42 (POIs): Client `—` → `partial`, described 2D circles and 3D absence
- Line 43 (Area features): Client `partial` → `done`, added 2D description (fill colors by kind)
- Line 44 (Composition of nested areas): Client `—` → `done`, described composition behavior
- Line 45 (`attribution`): expanded to cover 2D visibility (always visible, uncollapsed), glTF (copyright and extras), and noted 3D gap
- Lines 61-63 (Routing rows): normalized Client column to `done` (removing "shipped: ..." prose) and updated note for "Named strategy" to cite `GET /routing-strategies`
- Line 72 (Scope to a boundary): changed "3D scene follows in its own brief" to "3D scene loads the same scope (`SceneLoader`)" (verified in `client/src/scene/sceneLoader.ts:85`)
- Line 73 (Export in filter mode): Client `—` → `partial`, described both views loading scoped map-data
- Line 75 (Local projection metadata): Client `—` → `done`, described 3D scene using `projection` and glTF carrying it (verified in `client/src/scene/projection.ts` and `exportGltf.ts:44`)
- Line 84 (Footprint previews): API-status `GET /import-areas/{id}/map-data` → `n/a` (client-side drawing, not an API-driven feature)

**Brainstorm section:**
- Real-width roads: marked "(shipped)" with issue #89

**Rows verified as still correct:**
- Lines 22, 24, 25, 26, 27, 28 (other import rows)
- Line 38 (navigable nodes)
- Lines 51-55 (spatial queries rows, which brief 07 updated to note composition)
- Line 64 (snap info)
- Line 65 (turn restrictions)
- Line 70 (traced boundaries creation and list)
- Line 71 (traced boundaries management on page)
- Line 74 (clip mode)
- Line 82 (pages and URL history)
- Line 83 (view state in URL)
- Error contract section

**Verification:**
- Checked `client/src/views/mapDataLayers.ts`: 5 layers as listed (area_features, blocks, road_segments, buildings, pois)
- Checked `server/app/api/mappers.py:124-136` (`block_feature`): returns all properties (area_square_meters, buildable_area, buildable_area_square_meters, is_median, is_clipped, import_area_id)
- Confirmed `featureRows` in mapDataLayers (lines 104-137): roads show street name, class, lanes with provenance, lane type, width, length; buildings show category, height, levels, block membership; blocks show area, buildable m², median, clipped
- Verified `ApiClient.routingStrategies()` in `client/src/api/client.ts:117-125` calls `GET /routing-strategies`
- Confirmed `SceneLoader` in `client/src/scene/sceneLoader.ts:85` uses `mapDataQuery(scope)` from selection
- Checked `exportGltf.ts:44`: copyright written to asset
- Verified `projection.ts` exists and 3D scene uses it for local meters
- Confirmed `road_segments` layer drawn with `roadWidthExpression` (line 74 mapDataLayers.ts)

No issues found with claims in the brief.

## Tangents found
