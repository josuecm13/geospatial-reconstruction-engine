# 03 — Batch roads, area features and block outlines

Issue: #151. Brief 01 merged the building layers into chunks and added `client/src/scene/batching.ts`
(`cellKey`, `groupByKey`, `mergeChunks`, `featureAtFace`, `ChunkIndex`). This brief does the same for the other layers,
reusing that module. Read `batching.ts` and the batched building path in `buildWorld.ts` first.

## The change (in `client/src/scene/buildWorld.ts`, batched path only; `{ batched: false }` stays per feature for the glTF export)

- **Roads (`roads` group):**
  - Merge road meshes per (150 m cell, material).
  - `setRoadMode` (`buildWorld.ts`, near the end) swaps each road between exact and smoothed geometry by iterating
    `roads` children. Read how it works, and keep both modes working on merged chunks. For example, build an exact and
    a smoothed chunk per cell and toggle `visible`, or whatever matches the current mechanism. Don't merge the two
    modes into one geometry.
  - Leave `road_outlines` (Blueprint, `roadOutlineLines`) as it is; it's already one object.
- **Area features (`area_features` group):** merge per (cell, material). Keep `renderOrder` and `LAYER_ORDER`
  behaviour; read how the scene view applies `LAYER_ORDER`.
- **Blocks (`blocks` group):**
  - Merge the block outline `THREE.Line`s into one `LineSegments` per (cell, outline kind or material). Dashed
    materials need `computeLineDistances()` on the merged segments; with segments, each segment's dashes start fresh,
    which is acceptable.
  - Merge the buildable-area fills and the generation zones per (cell, material).
  - Read `scene/blockSelection.ts` and `scene/blockOutline.ts`: if the selection highlight relies on a per-block
    outline object (`blockOutlineSelected`), draw the selected block's outline as its own single object added on
    selection, instead of swapping a material on a per-block line.
- **Picking:** `pinLayer.ts`, `routeLayer.ts` and `blockSelection.ts` raycast `ground`, `area_features` and `roads` and
  only use `hit.point`. That works on merged meshes. Keep `raycast = () => {}` on lines.
- **Staged import (`scene/stagedScene.ts`):** builds partial worlds per layer and moves the group children. Check it
  still works with chunks.
- **Theme restyle (`palette.ts` `restyle`):** merged objects keep their material's `userData.key`.
- **`landing/featuredStage.ts`:** fades the area, road and block layers by group. Check that it still works.

## Tests

Update the vitest tests that assume one object per road, area feature or block (`buildWorld.test.ts`,
`stagedScene.test.ts`, and any others you find by grepping for `road:` and `area_feature:` names). Add tests for the
merged output: object counts that grow with cells, not features, and both road modes present. No WebGL in tests.

Do **not** run `npm test`, `npm run build` or any suite: CI is the gate. A quick `cd client && npx tsc --noEmit` is
allowed.

## Deliverable

Commit on `work/perf-batch-layers` (`perf(client): ...`), ending the message with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- per-file changes;
- how each item above is handled (file:line);
- tsc result;
- anything you couldn't keep.
