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

- `client/src/importing/rectangleDrag.ts` (pure): `hitTest`, `applyDrag`, `describeSize`, plus `sizeLabel`,
  `cursorFor` and `metersPerPixel`. Works in local meters around the rectangle's centre. Hit priority is
  corner, then edge, then inside, nearest wins on tiny rectangles. A side dragged past its opposite flips;
  an axis never goes under 10 m (a drag landing exactly on the opposite side grows in the direction the
  side was dragged from).
- `geo/bbox.ts`: new `bboxSizeMeters`, which `areaSquareMeters` now uses, so the label's width and height
  are measured the way the server measures them.
- `rectangleTool.ts` now uses pointer events on the map canvas with `setPointerCapture`, and
  `touch-action: none` on the canvas so a touch drag is not cancelled as a browser pan. The 12 px handle
  radius becomes meters with `metersPerPixel` (512 px tiles). `dragPan`/`boxZoom` are disabled only while a
  drag is active. Public API (`bbox`, `startDrawing`, `show`) is unchanged; `importPanel.ts` is untouched.
- The DOM corner `Marker`s are gone: corners (large) and edge midpoints (small) are a `circle` layer, which
  shows what is draggable and takes the over-limit colour. The `.corner-handle` CSS became `.selection-label`.
- Drawing a first rectangle also goes through pointer events; Escape during that drag removes the
  half-drawn rectangle and leaves drawing armed.
- Tests: `rectangleDrag.test.ts`, expected values computed by hand at the equator (1 degree = 111194.93 m).
  Type check passes; the suites were not run locally (CI is the gate), so the tests are not mutation-checked.
  Nothing was exercised in a browser: the pointer wiring in `rectangleTool.ts` is untested by design (needs a map).
- Docs: spec delta (modified requirement plus "Moving the rectangle" scenario), `client-features.md` row, task 1.18d ticked.

## Tangents found
