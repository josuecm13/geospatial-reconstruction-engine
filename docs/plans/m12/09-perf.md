# 1.9 Performance: the `?fps` readout (#141)

Read first: the performance decision in `openspec/changes/add-scene-themes-and-time-of-day/design.md`, and the
"10 km² area SHALL stay responsive" requirement. Then read `client/src/views/sceneView.ts` (the frame loop),
`client/src/scene/atmosphere.ts` (shadow updates) and `client/src/style.css`.

## Do
1. **`client/src/scene/fpsMeter.ts`**: a pure rolling frame-time meter.
   - `record(deltaMs)` keeps the last 120 frames.
   - `stats()` returns `{ fps, meanMs, p95Ms }`.
   - Tests: a steady 16.7 ms gives about 60 fps; a few long frames push p95 up.
2. **The readout.**
   - When the page URL has an `fps` query parameter, the scene view shows a small fixed readout in a corner,
     updated about 4 times a second.
   - It shows fps, p95 ms, `renderer.info.render.calls` and triangles, texture count, the theme, and whether
     shadows redrew this second (count the atmosphere's shadow redraws: expose a counter from the atmosphere).
   - Use tokens only in CSS. The control is hidden without `?fps`.
3. **Cheap wins that are safe.**
   - Only when the code shows a clear waste. For example: shadow `needsUpdate` set on frames where nothing moved,
     edges casting shadows (lines must not cast), or the sky dome casting or receiving shadows.
   - Fix these and list them. Don't restructure meshes or merge geometry: the design defers that until the owner
     measures.
4. **Docs.** Add a line to `HOW_TO_RUN.md` (or wherever dev flags are listed) about `?fps`.

## Don't
- Merge buildings or change the world's structure.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-perf` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report the files, any waste you fixed, and anything you suspect will miss the budget on a 7,000-building area.
