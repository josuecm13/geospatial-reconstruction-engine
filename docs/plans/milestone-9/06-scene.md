# 06 — Build a low-poly 3D scene from map-data (#65)

## Goal

The Scene tab shows the open area, or its selected boundary, as a stylized low-poly 3D world built
from `GET /import-areas/{id}/map-data`. Briefs 07 (fly/walk), 08 (staged build), 09 (route), and
10 (glTF) all build on the **World contract** defined here, so follow it exactly.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 65`.

## Code to read first

- `client/src/views/sceneView.ts`: today an empty world (sky, lights, a 1000 m ground, a grid,
  OrbitControls), with a render loop that stops while hidden.
- `client/src/main.ts`: the scene is imported lazily the first time the Scene tab opens. **Keep
  that.** Three.js must stay out of the map-only bundle.
- `client/src/state/selection.ts`: `SelectionStore` (open area plus scope) and `mapDataQuery(scope)`.
- `client/src/api/types.ts`: `MapData`, `Projection` (`origin`, `meters_per_degree_latitude`,
  `meters_per_degree_longitude`), and the layer property types. Buildings have
  `height_meters: number | null` and `levels: number | null`. Roads have `width_meters`.
- `client/src/geo/roadWidth.ts`: the 2D map already draws roads at `width_meters`.

## World contract (other briefs depend on this)

- **Axes**: meters, with the origin at `projection.origin`. `x` = east, `z` = **south** (so north is
  `-z`, Three.js's convention with `y` up), `y` = up. One function does this:
  `toLocal(projection, [lon, lat]) → {x, z}`, and its inverse
  `toLonLat(projection, x, z) → [lon, lat]` (brief 09 needs it).
- **Scene graph**: `buildWorld(data: MapData): THREE.Group` returns a group named `world`, with
  exactly these child groups in this order: `ground`, `area_features`, `roads`, `blocks`,
  `buildings`, plus an empty one, `generated` (reserved for Milestone 11). Every entity mesh is
  named `<layer>:<entity id>` (for example `building:4f1c…`), and its `userData` holds
  `{layer, id, properties}`. Brief 10 relies on the names, and brief 08 on the layer groups.
- `world.userData = { scope: data.scope, projection: data.projection, attribution: data.attribution }`.
- **Heights**: y = 0 is the ground. Area features sit at y = 0.02, roads at 0.05, the block overlay
  at 0.03 (hidden by default), and buildings start at 0. Small offsets avoid z-fighting.
- **Materials**: `MeshLambertMaterial` with `flatShading: true`, one shared material per kind (don't
  create one per mesh). The palette lives in one `palette.ts`.

## Design

New folder `client/src/scene/`. Pure modules are tested; WebGL-only code is not.

- `projection.ts` (pure): `toLocal` and `toLonLat`, as above.
- `roadGeometry.ts` (pure): `roadPolygon(points: {x,z}[], width: number): {x,z}[]` offsets a
  polyline to both sides by `width / 2` and returns a closed outline (left side forward, right side
  backward). Use a **miter join clamped** to 2 × half-width at sharp angles; beyond that, fall back to a
  bevel. Return `[]` for fewer than two distinct points. Two-way roads appear as two directed segments
  in map-data (a forward and a reverse twin), so **deduplicate**: draw a segment only if its reversed
  geometry hasn't been drawn already. Key on rounded endpoint coordinates plus the street id.
- `buildingHeight.ts` (pure):
  `buildingHeight(props): {height: number; defaulted: boolean}`. `height_meters` when known; else
  `levels × 3.2`; else a **default per category** from a table (`house` 7, `residential`/`apartments`
  15, `commercial`/`retail` 12, `industrial` 10, `church` 20, `garage`/`shed` 3, anything else 9).
  `defaulted` is true only for the table case. Building props are `BuildingProperties` in
  `client/src/api/types.ts`.
- `extrude.ts` (pure where possible): `footprintShape(ring: {x,z}[]): THREE.Shape`, with holes
  ignored (map-data building footprints are single outer rings). Then use `THREE.ExtrudeGeometry`
  with `depth = height` and `bevelEnabled: false`, rotated so the extrusion goes up y. Unit-test the
  ring winding and orientation step without WebGL: building geometry is fine in Node, only the
  renderer needs WebGL.
- `buildWorld.ts`: builds the contract's groups.
  - `ground`: a flat plane covering the scope's extent (from the bbox for the area scope, or the
    boundary polygon's extent; compute it from all features' local coordinates, plus 20 m margin).
  - `area_features`: polygons as flat shapes (`ShapeGeometry`), colored by `kind` (water blue, else green).
  - `roads`: `roadPolygon` per deduplicated segment, as a flat `ShapeGeometry`, colored by `lane_type`.
  - `blocks`: the `buildable_area` (Polygon or MultiPolygon) as a translucent overlay, `visible = false`
    by default, toggled by a checkbox in the scene view's corner ("Show buildable area").
  - `buildings`: extruded. **Defaulted heights are visibly marked**: a paler material, plus a
    `userData.defaulted = true` flag. Measured heights use the solid material, matching the 2D map's
    convention (`mapDataLayers.ts`).
- `sceneView.ts`: add `setWorld(data: MapData)`, which disposes the previous world's geometries
  (traverse and `geometry.dispose()`, keeping shared materials), adds the new world, and frames the
  camera on its extent. Remove the placeholder 1000 m ground and the grid once a world is loaded.
  Keep the empty-state placeholder before then, with a hint "Open an import on the Map tab".
- **Loading** (in `main.ts`, or a small `sceneLoader.ts`): when the scene is shown, and on every
  selection change while it's shown, call `api.mapData(areaId, mapDataQuery(scope))` and then
  `setWorld`. Ignore stale responses: keep a request counter, and drop a response that isn't the
  latest. Errors go through brief 04's reporter if it has landed; otherwise show a plain message in
  the empty state, and note it under Outcome.

## Tests

`projection.test.ts` (a round trip, and north → -z), `roadGeometry.test.ts` (a straight road's
outline width equals `width`, a 90° corner, a degenerate input, twin deduplication),
`buildingHeight.test.ts` (each precedence step, and the defaulted flag), `extrude.test.ts` (a square
footprint gives a box of the right height with a bottom at y = 0), and `buildWorld.test.ts` (a small
hand-written `MapData` fixture gives the contract's group names, in order, and mesh names
`<layer>:<id>`).

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL build a low-poly 3D scene from map-data"**,
  with a scenario that a building without a height or levels is drawn with a defaulted, visibly
  marked height.
- `docs/client-features.md` → Map data: the 3D column for each layer.
- `tasks.md`: tick `1.14 #65`.

## Outcome

Built `client/src/scene/` (`projection`, `roadGeometry`, `buildingHeight`, `extrude`, `palette`,
`buildWorld`, `sceneLoader`) with a `*.test.ts` for each, and wired `sceneView.setWorld` /
`showMessage` / `clear`, plus the "Show buildable area" checkbox and the empty-state hint. The
World contract is as specified; extra exports for later briefs: `WORLD_GROUPS`, `LAYER_Y`,
`MATERIALS`/`roadMaterial` (palette), `polygonShape`/`flatGeometry`/`extrudeFootprints` (extrude).
Building meshes also carry `userData.height`.

Decisions:
- Loading lives in `scene/sceneLoader.ts` (`SceneLoader`, with `shown()`/`hidden()`), which takes the
  API, selection, and scene view as interfaces so its request-counter logic is unit-tested without
  WebGL. `main.ts` creates it with the lazily imported scene view. It skips a reload when the same
  selection is already showing.
- Errors go through brief 04's reporter (`useErrorReporter`) with a small scene messages map in
  `main.ts`, shown in the empty state.
- `dedupeTwins` is generic over items and sorted-line keys, so clip-mode `MultiLineString` segments
  deduplicate too. Roads, buildings and blocks that are Multi* become one mesh per feature.
- Ground extent is computed from area features, roads and buildings (not blocks), plus 20 m; an
  empty response gets a 200 m square.
- Area features and blocks honor polygon holes; buildings ignore them, as the brief says.
- Tests not run locally (per CI-only rule); only `tsc --noEmit` was run. No mutation checks.

## Tangents found

- `docs/client-features.md` Map data rows still said Client `—` although the 2D map draws every
  layer; this brief set the rows it touched to `partial` (3D done, 2D already) but did not audit the
  2D claims.
