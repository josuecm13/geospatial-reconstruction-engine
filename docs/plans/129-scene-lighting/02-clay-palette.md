# 02 — Clay-model palette, and a hero that blends into the scene (#131)

Model: sonnet. Branch: `work/131-clay`, from the tip of `feat/129-consistent-scene-lighting`. Commit,
don't push. Don't run `npm test` / `npm run build` / vitest; `cd client && npx tsc --noEmit` is fine.
Builds on brief 01 (baked shading, `scene/shading.ts`, `scene/palette.ts` as the only scene colours).

## Palette (`client/src/scene/palette.ts`)

| key | value |
|---|---|
| ground | `#e6e1d8` |
| buildingMeasured | `#f6f3ee` (warm white clay) |
| buildingDefaulted | `#d5d6d8` (cool grey: the height was assumed) — keep the comment, reworded |
| roadWide / roadNormal / roadNarrow | `#bfb8ab` / `#cdc7bc` / `#d8d3ca` |
| green | `#bccaa8` |
| water | `#a7c0cc` |
| buildable | `#5f9e98`, keep `transparent`, opacity 0.35 |
| route, destination | `#e4572e` |
| origin | `#2e3a40` |
| waiting (wireframe) | `#2e3a40` |
| gridCenter / gridLine | `#cfc9be` / `#d9d4ca` |

**Background is derived, not chosen.** Replace `COLORS.sky` with an exported `SCENE_BACKGROUND`
(a `#rrggbb` string): the ground colour multiplied by `shade(UP)` the same way the renderer does it
(`new THREE.Color(COLORS.ground).multiplyScalar(shade(new THREE.Vector3(0, 1, 0))).getHexStyle()` —
`THREE.Color` holds linear values under ColorManagement, so this matches the vertex-colour multiply;
confirm in node_modules that `set(hex)` converts sRGB → linear and `getHex*` converts back). With
the constants from brief 01 it should come out `#e1dcd3`; a test pins that. Doc comment: the ground
plane renders exactly this colour, so the scene's edge is invisible against the background.

Use `SCENE_BACKGROUND` for `scene.background` in `views/sceneView.ts` and
`landing/featuredStage.ts` (delete its `BACKGROUND` constant). Add `landing/featuredStage.ts` to the
files `scene/palette.test.ts` scans.

## Landing hero (`client/src/style.css`)

- Add `--scene-background: #e1dcd3;` to `:root`, with a comment that it must equal
  `SCENE_BACKGROUND` (a test enforces it).
- `.landing .landing-hero`, `.landing .landing-stage` (both slots), `.landing .landing-skeleton`
  (keep its pulse; a slightly darker clay for the pulse is fine) and `.location-preview` use
  `var(--scene-background)`.
- The hero's stage has no frame: no `border-radius` on `.landing-stage-hero` (the story stage, which
  sits on the lighter `#f4f1ea` page, keeps its rounded frame).
- Hero text becomes dark on light: text `#2e3a40`; the eyebrow (`#8fc1f5` now), the hero note, its
  error colour (`#f1948a` now), and `.landing-button` border/hover (white overlays now) all need
  light-background versions. Every text colour on `#e1dcd3` must reach 4.5:1 — compute it with a
  quick script and put the ratios in your report. Keep the primary button blue if it passes.
- New test (e.g. `client/src/landing/heroBackground.test.ts`): reads `style.css` via `fs`, asserts
  `--scene-background` equals `SCENE_BACKGROUND`, and that the hero, stage, skeleton and
  `.location-preview` rules use `var(--scene-background)`.

## Location previews (`client/src/locations/preview.ts`)

These 2D canvas previews are the hero's fallback before the 3D loads, and the location cards. Move
them to the clay look, matching what the 3D scene shows: background and ground = `SCENE_BACKGROUND`
(no gradient, so the fallback blends too); roofs, walls and flat layers = the palette colour times
the matching shade (roof: up; wall: pick the south-facing shade, `shade((0,0,1))`); edges a darker
clay. Derive from `scene/palette.ts` + `scene/shading.ts` rather than writing new hex values; if a
canvas needs an `rgba()` (transparency), build it from the palette colour. Update
`preview.test.ts` (or whatever asserts these colours) accordingly.

## Out of scope

`views/mapDataLayers.ts` (2D map) keeps its colours. Building edge outlines in 3D are a possible
follow-up, not this brief.

## Report

Commits and files; the computed `SCENE_BACKGROUND` and how you confirmed the colour-space handling;
the contrast table for hero text; anything that didn't fit. Conventional Commits referencing #131,
ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
