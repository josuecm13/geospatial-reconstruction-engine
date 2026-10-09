# 03 — Readable clay thumbnails, and one dark link blue on the landing page (#131, #132)

Model: sonnet. Branch: `work/131-thumbs`, from the tip of `feat/129-consistent-scene-lighting`.
Commit, don't push. No `npm test` / `npm run build` / vitest; `cd client && npx tsc --noEmit` is fine.
Builds on briefs 01–02 (deleted from the tree; read them with `git show 31f9f9b:docs/plans/129-scene-lighting/0{1,2}-*.md`).

## Problem

The location thumbnails (`client/src/locations/preview.ts`, flat top-down view) are drawn in the
clay palette from straight above. From that angle roofs (`#f1eee9`) barely differ from the ground
(`#e1dcd3`, 1.18:1), so every thumbnail reads as a near-blank beige card and places can't be told
apart. The 3D scene gets its form from shaded walls; a top-down picture has no walls.

**Main cause (seen in a screenshot of the running app):** the thumbnails fill every block with
`PREVIEW_COLORS.block` (the buildable teal at 0.35 alpha). Blocks cover nearly all land between
roads, so every thumbnail is one sage-teal wash, parks (`green`) blend into it, and the clay ground
never shows. In 3D the buildable layer is hidden unless toggled on, so the thumbnail shouldn't show
it either: **stop drawing blocks in the preview** (remove `block` from `PREVIEW_COLORS` and the
`fillPolygons(... blocks ...)` call, in both the flat and the raised view). The thumbnail should
then read as the 3D scene does: clay ground, sage parks, slate water, roads, white buildings.

## Then: cast shadows that follow the scene's light

In the **flat** (not raised) drawing only, before the buildings are filled, draw each building's
shadow on the ground:

- Direction and length come from `LIGHT_DIRECTION` (`scene/shading.ts`): a point at height `h`
  casts its shadow at ground offset `-(l.x, l.z) · h / l.y` metres (x east, z south). Convert to
  preview pixels with the same scale the preview already uses for road widths (metres → degrees
  latitude → `t.scale`; check `previewTransform` for the axis conventions, screen y grows
  southward). Height is `buildingHeight(f.properties).meters` (look at `scene/buildingHeight.ts`
  for the exact field).
- Shape: the footprint swept along that offset. Approximate by filling the footprint translated at
  ~8 evenly spaced steps from 0 to the full offset (one path per building, fill once), then the
  building's own footprint is drawn on top as today.
- Colour: the ground in shadow, i.e. lit only by ambient: add `shadow: clay(COLORS.ground, AMBIENT)`
  to `PREVIEW_COLORS`. No new hex values. Shadows land on roads and green too; that's fine (draw them
  after roads, before buildings).
- Building outlines: make `buildingEdge` stroke clearly visible on the roof (full alpha, and a
  `lineWidth` around 0.8). Keep it derived.

Put the pure geometry in a testable function (e.g. `shadowOffset(heightMeters, pxPerMetre): [dx, dy]`
in `previewColors.ts` or a small new module) and test it: zero height → [0, 0]; offset points away
from the light's horizontal direction (east-and-north for the current light); length scales linearly
with height. Leave the raised (hover) view as it is.

Report the WCAG ratio of `shadow` against `ground` (computed, not guessed).

## #132: landing link blue

In `client/src/style.css`, every **landing** text colour `#2f7dd1` becomes `#1f5fa8`:
`.landing .landing-fact h3`, `.landing .landing-heading-row a`, `.landing .arch-card a`,
`.landing .landing-step .landing-step-number`, `.landing .landing-tile a`. Compute each one's ratio
against its actual background (`#f4f1ea` page, `#fff` cards) and report them; all must reach 4.5:1.
Leave fills, strokes, outlines, and everything outside `.landing` (panel, locations page) alone and
list the `#2f7dd1` text uses outside the landing page with their ratios in your report.

Commits: one per issue, Conventional Commits referencing #131 / #132, ending with
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
