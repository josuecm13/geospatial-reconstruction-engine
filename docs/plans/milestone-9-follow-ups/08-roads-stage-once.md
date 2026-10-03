# 08 — Roads inside inner areas are drawn once in a staged build (#110)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 110`

During the staged build of an outer area, roads inside an inner area are drawn twice. The issue's
symptom is correct, but the cause is not the server's `roads` stage alone. Two copies reach the
client:

1. The outer area's `roads` event. `StageEmitter._layers` (`server/app/api/background_import.py:72-76`)
   sends every segment of the outer area. Inner areas are not stored separately for roads, because
   the road network is stored whole across the rectangle (`docs/architecture.md` → "Nested import
   areas", and the `import-area-api` requirement "An import SHALL skip what completed inner areas
   already hold"). This copy is correct and must stay. It is the network that routing and the
   finished `map-data` use.
2. The inner area's own `map-data`. On `fetched`, the client calls `api.mapData(id)` for each
   `inner_area_ids` entry (`client/src/importing/stagedImport.ts:58-61`), and
   `StagedHandle.addBuilt` (`client/src/scene/stagedScene.ts:186-196`) moves the inner world's
   `area_features`, **`roads`**, `blocks` and `buildings` meshes into the live world. The inner area's
   segments are separate rows for the same OSM ways, so they overlap the outer area's.

The finished world isn't affected. Once the animation ends, the scene reloads the outer area's
`map-data` (`client/src/pages/explore.ts:202-209`), whose road layer is the outer area's own. So the
fix belongs on the client: `addBuilt` stops taking the inner area's roads. The server's `roads` stage
stays as it is, and so does routing. Read the issue's "each road is sent … once" as "each road is
drawn once from one copy". The inner area's `map-data` response still carries its road layer,
because `map-data` has no layer filter, and adding one is out of scope.

## Code to read first

- `server/app/api/background_import.py` (119 lines): `StageEmitter._layers`. `roads` lists
  `RoadSegmentRepository.list_for_import_area_with_street(self.area_id)` (lines 72-76). No change.
- `client/src/importing/stagedImport.ts` (87 lines): `runStagedImport`. On a `fetched` step it fetches
  each inner area's `map-data` and passes it to `handle.addBuilt` (lines 58-61).
- `client/src/scene/stagedScene.ts` (216 lines): `addBuilt` (lines 186-196) builds the inner world
  with `buildWorld(data)`. It then moves the `area_features`, `roads`, `blocks` and `buildings` group
  children across, offset by the inner projection's origin. The `take` helper is at lines 136-140.
  The `roads` reveal step is at lines 155-157.
- `client/src/scene/buildWorld.ts`: `WORLD_GROUPS` (line 10) and how the roads group is filled
  (around lines 72-82).
- `client/src/pages/explore.ts:202-209`: the finished area replaces the build once
  `handle.finished` resolves.
- `client/src/importing/stagedImport.test.ts`: the test at line 57 covers `addBuilt` being called
  for an inner area (`"built:inner-1"`).
- `client/src/scene/stagedScene.test.ts`: tests only `bboxMeters` today. `vite.config.ts` runs
  tests in the `node` environment, and `jsdom` is installed, so a single test file can opt in with
  `// @vitest-environment jsdom`.

## Design

- In `stagedScene.ts`, name the layers an inner area contributes in an exported constant:

  ```ts
  /** What an inner area adds to a staged build. Not its roads: the outer area's `roads` stage carries
   *  the whole network across the rectangle, inner areas included. */
  export const INNER_AREA_LAYERS = ["area_features", "blocks", "buildings"] as const;
  ```

  `addBuilt` loops over `INNER_AREA_LAYERS` instead of the inline list at line 190. The inner world's
  `roads` meshes stay behind with its ground. Dispose their geometries, the same way `abandon` does
  for a whole world (line 204), so they don't leak.
- Don't touch the server's `roads` stage. Filtering it by inner boxes would leave gaps. An inner
  area's network is cut at its own box, and the copies of ways that cross its edge would still
  overlap. The outer network is also the newer one.
- Routing is unaffected, because nothing on the server changes. Say so in the Outcome rather than
  re-testing routing.
- **Out of scope** (record them under Tangents if you confirm them):
  - A building or area feature that crosses an inner edge is stored by both areas, so it is drawn
    twice during the build: once from the outer `buildings` ring, once from the inner `map-data`.
  - An inner area's clipped edge blocks overlap the outer area's whole straddling blocks in the
    same way.

  Both are the same class of problem as roads, but the issue covers roads.

## Tests

- `client/src/scene/stagedScene.test.ts`: add a test that `INNER_AREA_LAYERS` doesn't contain
  `"roads"` and does contain the other three layers. If `createStagedScene` can run under
  `// @vitest-environment jsdom` (it needs a `THREE.Scene` and a container element, not a
  renderer), prefer a behavioural test:
  1. `begin(bbox)`, then `apply` a `fetched` step so a projection is set.
  2. `addBuilt` a `MapData` with one road, one building and one block.
  3. Assert that `world.getObjectByName("roads")!.children` is empty, and that the buildings group
     has the building.

  Build the `MapData` fixture with `buildWorld.test.ts` as a model.
- `client/src/importing/stagedImport.test.ts`: no change needed. It stubs the handle.
- Not mutation-checked (no local runs). Say so.

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, `### Requirement: The client SHALL build an imported
  place in stages as the server streams them` (line 106). Change "A completed area that `fetched`
  names in `inner_area_ids` SHALL be shown fully built at once" to say that the area's features,
  blocks and buildings are shown at once, and its roads are not, because the `roads` stage carries the
  whole network. Add a scenario: WHEN an import's `fetched` event names an inner area, THEN each road
  inside it is drawn once, from the `roads` stage.
- `docs/client-features.md`, the "Import progress as server-sent events" row (line 27): its client
  note says inner areas are shown at once. Add "(their roads come from the `roads` stage)".
- `docs/architecture.md`: no change. The server's behaviour is the same.

## Outcome

## Tangents found
