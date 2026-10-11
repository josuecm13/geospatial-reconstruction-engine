# 10 — Terrain hides what's behind and below it (client)

Folded into PR #143 at the owner's request. Branch from `feat/141-scene-themes`, commit on `work/terrain-depth`, don't push.

## Problem
Ground-level layers are built with `depthWrite: false` (`client/src/scene/palette.ts`, the `decal` helper in `buildMaterials`),
and `LAYER_ORDER` in `client/src/scene/buildWorld.ts` alone decides what shows on top. That predates terrain. With terrain
(`terrainGround`), nothing records the ground's depth, so (a) buildings behind a ridge draw over the ridge, and (b) the parts of
buildings sunk below the ground (bases go down to `lowestUnder`) show through the slope.

## Change
- The ground material (`ground`, including Blueprint's `withGrid` ground and Realistic's) writes depth. It already draws first (`LAYER_ORDER.ground`).
- Layers drawn on top of it (green, water, forest, farmland, cemetery, railway, industrial, roads, buildable, zones, block fills) keep
  `depthWrite: false` and their draw order, still depth-test, and get a negative `polygonOffset` (`polygonOffset: true`,
  factor/units around -1/-4, stronger for later layers if needed) so they win against the ground surface they lie on but are hidden by
  terrain in front of them. Keep it in palette.ts, the only place materials are built.
- Roads follow stored smoothed heights, which can sit slightly under the terrain mesh between grid points. If the offset alone
  can't keep them visible, raise `LAYER_Y.roads` modestly (document why). Don't change server heights.
- Check the placeholder ground in `views/sceneView.ts`, `groundPlane`, the staged build (`stagedBuild.ts`/`stagedScene.ts`) and
  `buildAnimation.ts` (it clones materials with `transparent = true`; clones inherit depthWrite/polygonOffset — make sure the ground
  clone still writes depth during the fade, or that the fade doesn't break occlusion afterwards).
- The theme restyle path (`restyle` in palette.ts) must carry the same settings for every theme.
- Update the comments that say the layers write no depth (`LAYER_ORDER`'s doc, the `decal` doc).

## Tests
Add/adjust a palette test: the ground material has `depthWrite === true` in every theme; overlay layers have `depthWrite === false`,
`polygonOffset === true`. Don't run test suites locally (CI is the gate); a type check of touched files is fine.

## Commit
`fix(client): the terrain hides buildings behind and below it (#141)` with the Co-Authored-By trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
