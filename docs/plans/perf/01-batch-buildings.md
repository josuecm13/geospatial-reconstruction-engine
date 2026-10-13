# 01 — Batch the building layers

Issue: #151. Urgent: a large area (Centrum, 16,002 observed buildings) takes a Chrome tab to
about 1.8 GB and drops the frame rate.

## The problem

`client/src/scene/buildWorld.ts` builds one `THREE.Mesh` per building (`entity`) and gives each one a child
`LineSegments` with its own `EdgesGeometry` (`withEdges`). `generatedMeshes` does the same for generated buildings.
That makes about 32k objects and buffer geometries on Centrum, and as many draw calls, plus the casters again in the
shadow pass. Every mesh also keeps `userData.properties`, a reference to its feature's properties.

## The change

Draw the building layers as **merged chunks** rather than one mesh per building.

- **Observed buildings (`buildings` group):** one merged `THREE.Mesh` per (spatial grid cell, material), using cells
  of about 150 m in local metres. The material is `buildingMeasured` or `buildingDefaulted`.
- **Generated buildings (`generated` group):** one merged mesh per (block, material). Generated buildings stream in
  block by block (`views/sceneView.ts` `spawn`), and "Show generated" rises them block by block, so a block is the
  natural unit. Group by `properties.block_id`; fall back to the grid cell when there is none.
- **Positions:** a chunk's `position.y` is the lowest base of its buildings. Each building's vertices are offset by its
  own base above that, so `scale.y` from 0 to 1 still reads as a rise from the ground. Bake x/z into the vertices.
- **Edges:** one merged `LineSegments` per chunk, as the chunk's child, so it follows `scale.y`. Build the edges
  directly from each footprint (the vertical corner edges plus the top and bottom rings) instead of
  `new THREE.EdgesGeometry(...)`. Generated edges still call `computeLineDistances()` for the dashed Blueprint
  material. Keep `edges.raycast = () => {}` and the name `edges`.
- **Identity:** each chunk mesh records `userData.featureIds` (in order) and the triangle range of each feature, or
  equivalent. Add a small exported helper in a new `client/src/scene/batching.ts` that resolves a raycast
  intersection's `faceIndex` to a feature id. Put the reusable merge logic there too (merge geometries with
  `BufferGeometryUtils.mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`, chunk keys, merged
  edges), so the next brief can reuse it for roads and area features.
- **Properties once:** don't put `properties` on every object. Keep one `Map<id, properties>` per world in
  `world.userData` (for example `world.userData.features`) and change readers to use it. One reader is
  `views/sceneView.ts` `showGenerated` (`block_id`); grep for the others.
- **Chunk names:** chunks must not use `<layer>:<id>` names. Use something like `buildings:chunk:<key>` and keep
  `userData.layer`.

## Things that must keep working (read each caller)

- **`views/sceneView.ts`:**
  - `spawn` dedupes by `generated:<id>` names; switch it to the ids recorded on the chunks.
  - `showGenerated` rises per block: with block chunks, each chunk is one rise point.
  - `clearGenerated` and `removeWorld` dispose geometries, including the edge children.
- **`scene/buildAnimation.ts`:** `rise`/`riseAt` take meshes and set `scale.y` and `visible`. Chunk meshes work as is.
  `fadeIn` clones materials and must restore and dispose them; check that it does.
- **`landing/featuredStage.ts`:**
  - It reads building footprints from the group children (lines 78–88) for the drone shot. Give it what it needs, for
    example the per-feature centres and heights from the data or recorded on the chunk.
  - Its story steps `rise` the building groups' children; that works with chunks.
- **`scene/stagedScene.ts`:** the import animation builds partial worlds with `buildWorld` and moves the group
  children; that works with chunks.
- **`scene/palette.ts` `restyle`:** themes swap materials by `userData.key`. Merged meshes keep their material's key.
  Check that the edge child is restyled too.
- **glTF export (`scene/exportGltf.ts`):** the spec (`openspec/specs/showcase-client/spec.md`, around line 131)
  requires entity nodes named `<layer>:<id>`, so a building must still export as `building:<id>`. Keep a per-feature
  build path, either an option on `buildWorld` (for example `{ batched: false }`) or a separate function sharing the
  same code. Have the export rebuild the per-feature world from the map data the scene view already holds, and match
  the visible layers. Check how `exportGltf` and the scene view's download button get the world today.
- **Shadows:** keep `castShadow` on building chunks and `receiveShadow` as now.

## Out of scope (another brief)

- Roads, area features and block outlines.
- The pixel-ratio cap, renderer settings, the landing renderer's disposal.

## Tests

Update or add vitest tests next to the code for the pure parts:
- chunk keying and grouping;
- the footprint edges (segment counts for a box footprint);
- face-to-feature lookup.

Keep WebGL out of tests. Do **not** run `npm test`, `npm run build` or any test suite: CI is the gate. A single-file
type check with `npx tsc --noEmit -p client` is allowed if it is quick.

## Deliverable

Commit on a `work/perf-batch-buildings` branch (conventional commit, `perf(client): ...`), ending the message with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- what changed, per file;
- how each "must keep working" item is handled;
- anything you couldn't keep and why.
