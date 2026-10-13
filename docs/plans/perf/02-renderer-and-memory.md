# 02 — Renderer settings, shadows and freeing memory

Issue: not filed yet (draft in the PR). Urgent: a Chrome tab reaches about 1.8 GB on large areas. Brief 01 batches the
building geometry in parallel. **This brief does not touch `client/src/scene/buildWorld.ts`** or the building and
generated code paths in `views/sceneView.ts` (`spawn`, `showGenerated`, `clearGenerated`).

## The changes

1. **Pixel ratio:**
   - Cap `renderer.setPixelRatio` at 1.5 instead of 2, in `views/sceneView.ts` (line ~57) and
     `landing/featuredStage.ts` (line ~60). Put the cap in one exported constant, shared by both.
   - Add a simple adaptive step in the scene view: when the frame time stays poor (for example the p95 over the last
     ~2 s is above 33 ms), drop the pixel ratio toward 1.0; when it recovers, raise it back up to the cap. Use
     hysteresis so it doesn't oscillate.
   - The `?fps` readout (`scene/fpsReadout.ts`) already measures frames. Reuse its numbers if that's clean, and show
     the current pixel ratio in the readout.
   - Keep the decision logic pure and unit-tested (vitest, next to it).
2. **Antialiasing:** keep `antialias: true` (a context can't change it later), but note the trade-off in a comment.
   The pixel-ratio cap is the main saving.
3. **Shadows (`scene/atmosphere.ts`):**
   - Read how the shadow camera is fitted (`scene/shadowFit.ts`) and how often it redraws (`autoUpdate = false`,
     `dirty`).
   - Make sure the shadow map is redrawn only when the sun, the fitted box or the casters change, and never every
     frame while the camera is still.
   - If walking or orbiting redraws it on every small camera move, add a threshold: refit only when the target moves
     by more than a fraction of the fitted half-size.
   - Keep `SHADOW_MAP_SIZE` at 2048 unless you find a measured reason. Read the code; don't guess.
4. **Freeing memory:**
   - `landing/featuredStage.ts` `dispose`: also call `renderer.forceContextLoss()`, and dispose the atmosphere's and
     any cloned materials. Check the `Animator`'s material clones are disposed.
   - `views/sceneView.ts` `dispose`: the same `forceContextLoss()`, and make sure the world, the placeholder ground and
     every render target are released.
   - Check that leaving the explore page and coming back doesn't leave a second WebGL context alive. `pages/explore.ts`
     disposes the scene; verify the path.
   - Check `scene/themes/textures.ts`: are the DataTextures built once and shared, or rebuilt per theme or per world?
     Fix any duplication.
   - Check `scene/palette.ts` `restyle` (line ~219): it creates a `MeshBasicMaterial` per line it restyles. Is that per
     object, per call? If it allocates per object on each theme change, cache it by key.
5. **MapLibre and the scene at once:** the map view stays alive while the scene is shown (`pages/explore.ts`). Check
   whether the map keeps rendering while it's hidden. If it does, stop its render loop while hidden (MapLibre doesn't
   repaint a hidden container unless something triggers it; verify the code and only change it if it's needed).

## Tests

vitest next to the pure logic (the adaptive pixel-ratio controller). No WebGL in tests. Do **not** run `npm test`,
`npm run build` or any suite: CI is the gate. A quick `npx tsc --noEmit -p client` is allowed.

## Deliverable

Commit on a `work/perf-renderer-memory` branch (`perf(client): ...`), ending the message with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- each change, with file and line;
- what you verified and found already fine (say so explicitly, with the evidence);
- anything left undone.
