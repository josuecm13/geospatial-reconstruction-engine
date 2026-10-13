# 05 — Fold generated chunks into cells, and shadows from high up

Issue: #151. Brief 04 runs in parallel and owns `client/src/scene/detail.ts`, the box level and the render-loop detail
call. **Don't touch those.**

## The changes

1. **Fold generated chunks.**
   - Generated buildings arrive and rise one chunk per block (`views/sceneView.ts` `spawn`, `showGenerated`), which
     gives up to 740 chunks on Centrum.
   - Once a block's rise has finished (or right away under reduced motion or Skip), merge the generated chunks of the
     same 150 m cell and material into one cell chunk, `generated:chunk:<cell>:<material>`, using
     `batching.ts`'s merge logic.
   - Keep `featureIds`, `triangleStarts`, `centres`, `baseLift`, the edges child (dashed: `computeLineDistances`) and
     `userData.block` information. A cell chunk spans several blocks, so record the block of each feature (for example
     `blocks: string[]` parallel to `featureIds`).
   - Also record the cell (`userData.cell`). Brief 04's policy reads it, so name it exactly `cell` and hold the
     `cellKey` string.
   - Every reader of generated chunks must keep working:
     - `spawn`'s dedupe by feature ids;
     - `showGenerated`: re-ticking it rises per block. With cell chunks, rising per cell chunk is acceptable; use each
       chunk's centre as its point.
     - `clearGenerated`;
     - `featuredStage`'s footprints (`centres`);
     - the glTF export rebuild;
     - per-block feedback and regeneration, which reload the world or clear and re-stream. Read
       `scene/generationControls.ts` and `scene/blockPanel.ts` to confirm.
   - Folding must not run while any rise is in flight, and must dispose the merged-away geometries.
   - Folding when the world is first loaded (`buildWorld`'s batched generated path) should build cell chunks directly.
     Per-block chunks exist only for streaming and reveal.
2. **Shadows from high up (`scene/atmosphere.ts`, `scene/shadowFit.ts`).**
   - The shadow box grows with camera distance up to `MAX_HALF_SIZE`. Past the distance where the box reaches
     `MAX_HALF_SIZE`, shadow texels get coarse.
   - Add a threshold, `SHADOW_OFF_DISTANCE`, a named constant derived from where texels pass about 1 m. Beyond it, turn
     the sun's `castShadow` and `renderer.shadowMap.enabled` off, and turn them back on below it, with a hysteresis
     band. The lights stay on.
   - Keep the decision pure and tested in `shadowFit.ts`.
   - `atmosphere.shadowRedraws()` and the `?fps` readout should show the shadows as off.

## Docs (do these too)

- `openspec/specs/showcase-client/spec.md` around line 83 says "each building SHALL carry a translucent pale
  edge-line child". Check whether the active change `openspec/changes/add-scene-themes-and-time-of-day/specs/` already
  modifies that requirement. Edit whichever text is current (the change's delta if it modifies the requirement,
  otherwise the living spec) to say:
  - buildings are drawn in merged chunks, each with one merged edge-line child;
  - edge lines and shadows are dropped at a distance, and far cells are drawn as boxes;
  - the glTF export still writes one node per feature without edge lines.

  Keep it as SHALL statements with a scenario. Don't run `openspec validate`; CI does.
- `docs/architecture.md`: if it describes how the scene builds meshes, add a short paragraph on chunks, detail levels
  and the export rebuild.

## Tests

vitest for:
- the fold: ids, triangle ranges and blocks are kept across a merge of two block chunks;
- the shadow-off decision, with hysteresis.

No WebGL. Do **not** run `npm test`, `npm run build` or any suite. `cd client && npx tsc --noEmit` is allowed.

## Deliverable

Commit on `work/perf-fold-shadows` (`perf(client): ...`), ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- per-file changes;
- how each reader is handled (file:line);
- the docs edits;
- tsc result;
- anything left out.
