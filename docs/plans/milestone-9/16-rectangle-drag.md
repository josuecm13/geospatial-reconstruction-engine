# 16 — Move and resize the selection rectangle (#104)

## Goal

Adjusting the selection rectangle feels direct: drag inside to move, drag edges or corners to
resize, with live size and the 1 km² limit shown while dragging.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 104`.

## Depends on

Nothing. It touches only `client/src/importing/rectangleTool.ts`, a new pure module, and styles.

## Design

- `client/src/importing/rectangleDrag.ts` (pure, tested). It works in **local meters** around the
  rectangle's centre (use `client/src/geo/localMeters.ts`), so drags behave the same at any latitude.
  - `hitTest(rect, point, handleRadiusMeters) → "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null`.
  - `applyDrag(start: BoundingBox, part, deltaMeters: {dx, dy}) → BoundingBox`. Move keeps the size.
    Edges move one side. Corners move two. A side dragged past its opposite flips cleanly (normalize
    min/max). A minimum size of 10 m.
  - `describeSize(bbox) → { widthMeters, heightMeters, areaKm2, overLimit }` (reuse `geo/bbox.ts` if
    it already computes the area).
- `rectangleTool.ts`: switch to **pointer events** on the map canvas (`pointerdown/move/up` with
  `setPointerCapture`), so touch works. The handle radius is in screen pixels (12 px) converted to meters
  at the current zoom. While hovering, set the canvas cursor (`move`, `ns-resize`, `ew-resize`,
  `nesw-resize`, `nwse-resize`). Disable `dragPan` only while a drag is active.
- While dragging, a small label at the rectangle shows `W × H m · N km²`, and the fill switches to the
  over-limit style when `overLimit`. Escape during a drag restores the start rectangle.
- Keep `RectangleTool`'s public API, so `importPanel.ts` doesn't change.

## Tests

`rectangleDrag.test.ts`: hit test regions and their priority (corner beats edge beats inside),
move preserves size, each edge, each corner, flip past the opposite side, minimum size, over-limit
flag.

## Docs

Spec delta: modify "The client SHALL select a rectangle of up to 1 km² and import it live" with a
scenario "moving the rectangle". `client-features.md` note.

## Outcome

## Tangents found
