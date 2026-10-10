# 04 — The scene on terrain, the road toggle, and re-analysis from the client (#139, part F)

Model: sonnet. Branch: `work/m10-client`, from the tip of `origin/fix/136-dense-city-imports`. Make
**one commit per numbered part**, and don't push. `cd client && npx tsc --noEmit` is fine. Don't run
`npm test`, vitest, or `npm run build`: CI is the gate. Client only. Keep the token rule
(`styleTokens.test.ts`: no colour literals outside `:root`), keep motion under
`prefers-reduced-motion: no-preference`, and keep WebGL out of tests: pure logic goes next to its
`*.test.ts`.

The server is built in parallel. Code against the **API contract** in
`docs/plans/milestone-10/00-decisions-and-contract.md` (the "contract"), not against server code.
Read it first.

## 1. Types and the API client

- `src/api/types.ts`:
  - `MapData.elevation: Elevation | null`, with `Elevation` and `ElevationGrid` interfaces exactly
    as in the contract;
  - building properties gain `base_elevation_meters: number | null`;
  - road-segment properties gain `elevation_exact: number[] | null` and
    `elevation_smoothed: number[] | null`;
  - `IMPORT_STAGES` becomes the contract's list, with `elevation` after `buildings`;
  - add the `elevation` stage's data to `StageData`.
- Update every consumer `tsc` flags. In particular, `src/landing/selectionDemo.ts` lists the
  ticker stages; check `selectionDemo.test.ts` still holds, since it derives from `IMPORT_STAGES`.
- `src/api/client.ts`: `analyseElevation(areaId): Promise<{ import_area_id: string; events_url:
  string }>` (POST `/import-areas/{id}/elevation`). Add a `client.test.ts` case.

## 2. The terrain model: `src/scene/terrain.ts`, pure and tested

- `createTerrain(elevation: Elevation, projection: Projection)` returns an object with:
  - `baseline`: the grid's minimum height. Every y in the world is `height - baseline`, so the
    scene stays near y = 0 and existing camera framing keeps working.
  - `heightAtLonLat([lon, lat])`: bilinear on the grid, clamped at the edges.
  - `heightAtLocal(x, z)`: via `toLonLat` from `scene/projection.ts`, then the above, minus the
    baseline.
  - `roadHeights(feature, mode: "exact" | "smoothed")`: that segment's array, or null.
- `flatTerrain()` is the same interface with every height 0, used when `elevation` is null, so the
  rest of the scene needs no null checks.
- `subdivideRing(ring: Local[], maxEdge: number)` and a `drape` helper. Flat ground layers are
  triangulated with large triangles, which would cut through a slope. Subdivide polygon edges, and
  the triangulated interior (a regular grid of extra points clipped to the polygon, or
  subdividing triangles until no edge exceeds `maxEdge`, about the grid spacing in metres), before
  setting each vertex's y from `heightAtLocal`. Keep it pure, operating on arrays of points or
  `BufferGeometry` position arrays without WebGL.
- `src/scene/terrain.test.ts`:
  - bilinear sampling, edges and clamping;
  - the baseline offset;
  - `flatTerrain` returns 0;
  - subdivision bounds every edge by `maxEdge`;
  - draping puts every vertex on the surface for a sloped grid.

## 3. Building the world on terrain (`src/scene/buildWorld.ts` and the staged build)

- Create the terrain from `data.elevation`, or the flat terrain, and keep it on
  `world.userData.terrain`.
- **Ground**: replace the flat plane with a mesh from the grid (`groundPlane` stays for the flat
  case), shaded the same way (`shadeGeometry`, `MATERIALS.ground`, same name and render order).
- **Area features and blocks**: subdivide and drape their flat geometry. Keep the existing
  `LAYER_Y` offsets *on top of* the draped height, and the render orders.
- **Roads**: drape the road outline using the segment's per-vertex heights in the current road
  mode. Each outline vertex takes the height interpolated along the centreline at its nearest
  position. Keep both arrays in the mesh's `userData`. If a segment has no arrays, sample the
  terrain instead.
- **Buildings**: translate each building up to `base_elevation_meters - baseline`, falling back to
  the terrain's minimum under the footprint if it's null. Height and extrusion are unchanged.
  Edges follow, since they're a child.
- **Road toggle**: `setRoadMode(world, mode)` re-drapes only the road meshes from their stored
  arrays, with no rebuild.
- The staged build (`stagedScene.ts`, `stagedBuild.ts`) receives the `elevation` stage last.
  Either re-drape the staged world when it arrives, or have the scene swap to a normal
  `buildWorld` from the completed area. Read how the staged scene hands over today and pick the
  smaller change.
- The route layer (`routeLayer.ts`) draws the route at a small y offset. Lift each route vertex by
  `heightAtLocal`.
- Pure tests next to the code where logic is pure: building y offsets from base heights, and
  `setRoadMode` switching arrays (test the pure part that computes positions).

## 4. Walking, the toggle UI, attribution, export, and "Add terrain"

- **Walk mode** (`cameraModes.ts`): the camera's y is `heightAtLocal(x, z) + EYE_HEIGHT` every frame
  (or on every move), so walking up a slope keeps you on the ground. Fly mode is unchanged.
  `collision.ts` stays 2D.
- **Toggle**: in the scene view (`views/sceneView.ts`, next to the "Show buildable area"
  checkbox), add a "Smooth roads" checkbox, checked by default, that calls `setRoadMode`. Show it
  only when the area has elevation.
- **Attribution**: wherever the scene or explore page shows the OSM attribution, also show
  `elevation.attribution` when elevation is present. Find the existing attribution text and follow
  its pattern.
- **glTF export**: it already exports the world. Make sure the terrain mesh and the draped, toggled
  roads go out as they are, and put `elevation.version` and the road mode in the export's scene
  extras next to the existing attribution and projection (`exportGltf.ts`). Add a test case if
  `exportGltf.test.ts` checks the extras.
- **Add terrain**: when a completed area has `elevation: null`, the scene view shows a quiet "Add
  terrain" button. It calls `api.analyseElevation`, follows the `events_url` (reuse how the import
  panel follows events), shows progress, and on `completed` reloads map-data and rebuilds the
  world. On `failed`, it shows the server's message by `code` (`elevation_unavailable`,
  `import_in_progress`), in the existing error style. Put the message mapping in a pure function
  with a test, like `locations/deleteMessage.ts`.
- **Docs**: in `docs/client-features.md`, fill in the client column of the rows brief 03 adds
  (`elevation` on map-data, the re-analysis endpoint, the `elevation` stage). If those rows aren't
  there yet on your base, add them in the existing format. The coordinator reconciles any overlap.
  **Don't edit `openspec/`.**

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(client): elevation types, the elevation stage and re-analysis in the API client (#139)`
2. `feat(client): a pure terrain model with draping (#139)`
3. `feat(client): build the scene on terrain, with exact and smoothed roads (#139)`
4. `feat(client): walk on the ground, toggle road smoothing, show attribution, add terrain (#139)`

Report:
- the SHAs, and `git show --stat` for each;
- how draping subdivides, and the `maxEdge` you chose;
- what you did for the staged build;
- where the toggle and the "Add terrain" button live;
- anything in the contract that didn't fit the client.
