# 04 — Detail levels for the zoomed-out view

Issue: #151. Once the camera is high enough to see the whole area, frustum culling saves nothing and every chunk is
drawn at full detail. This brief adds per-cell detail levels. Read `client/src/scene/batching.ts` and the batched
paths in `client/src/scene/buildWorld.ts` first.

## The change

1. **A detail policy (`client/src/scene/detail.ts`, pure, tested).**
   - For each 150 m cell, pick a level, `near`, `mid` or `far`, from the cell's projected size on screen: its bounding
     radius over the distance to the camera, scaled by the viewport height and FOV. That way a narrow FOV (the drone
     shot) gets more detail.
   - Use a hysteresis band at each threshold so a cell sitting on a boundary doesn't flicker.
   - Export the thresholds as named constants.
2. **What each level shows** (applied to the chunks of a cell: observed and generated buildings):
   - `near`: full footprints, edge lines, casts shadows.
   - `mid`: full footprints, **no edge lines** (`edges.visible = false`), casts shadows.
   - `far`: a **box level**: every building as its minimum-area rotated rectangle extruded to its height, 12
     triangles per building.
     - Merge box levels into **super-cells** of 4 × 4 cells (600 m), one mesh per (super-cell, material).
     - Box levels don't cast shadows and have no edges.
     - Build a super-cell's boxes **lazily**, the first time any of its cells goes `far`, and keep them.
     - Each box keeps `baseLift`, because night windows and facades read it.
     - Hide the full chunks of a `far` cell and show the super-cell's boxes. A super-cell's box mesh is shown only when
       **all** its cells are `far`; otherwise its far cells stay at `mid` (no edges, full footprints). That avoids
       per-building visibility inside a merged mesh.
   - Roads, area features and blocks: `mid` and `far` hide block outlines only; roads and areas stay as they are.
3. **Wiring:**
   - The scene view's render loop calls `applyDetail(world, camera, viewportHeight)`. Throttle it to about 5 Hz, or
     run it only when the camera moved, not every frame.
   - When the result changes which chunks cast shadows, call `atmosphere.invalidateShadows()`.
   - The landing stage (`landing/featuredStage.ts`) uses it too.
   - The staged import keeps full detail. Skip it there unless that's trivial.
   - The rise animations (`scale.y`) act on full chunks. A chunk that is rising stays `near` or `mid`; don't swap it to
     boxes mid-rise.
   - Generated chunks reveal per block. The policy needs a cell for each chunk, so record each chunk's cell, or its
     centre, in `userData`.
4. **Picking** is unaffected: buildings aren't picked. The glTF export is unaffected: it rebuilds unbatched.

## Tests

vitest for:
- the policy (levels and hysteresis);
- the rotated-rectangle box (a rectangle comes back as itself; an L shape gives its minimum-area rectangle);
- that super-cell keys group 4 × 4 cells.

No WebGL. Do **not** run `npm test`, `npm run build` or any suite: CI is the gate. `cd client && npx tsc --noEmit` is
allowed.

## Deliverable

Commit on `work/perf-detail` (`perf(client): ...`), ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- per-file changes;
- each item above with file:line;
- tsc result;
- anything left out.
