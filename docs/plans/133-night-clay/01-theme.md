# 01 — Night clay theme: palette, edges, tokens, dark 2D map (#133)

Model: sonnet. Branch: `work/133-theme`, from the tip of `feat/133-night-clay`. Commit (one commit
per numbered part below), don't push. Don't run `npm test` / `npm run build` / vitest /
`openspec validate`; `cd client && npx tsc --noEmit` is fine (run `npm ci` first if `node_modules`
is missing). Throwaway scripts for colour maths go outside the repo. Chrome is the only target
browser.

Read first: `client/src/scene/shading.ts` (formula, `LIGHT_DIRECTION`, `AMBIENT`),
`client/src/scene/palette.ts` (`COLORS`, `MATERIALS`, derived `SCENE_BACKGROUND`),
`client/src/locations/previewColors.ts`, `client/src/landing/heroBackground.test.ts`,
`client/src/scene/palette.test.ts`, `client/src/style.css`.

## 1. Night clay palette (`scene/palette.ts`)

Starting values. Tune them if a check below fails, and report the final values with their ratios.

| key | value |
|---|---|
| ground | `#1b2024` |
| buildingMeasured | `#ddd6c9` |
| buildingDefaulted | `#8e959c` (comment: dimmer and cool, the height was assumed) |
| roadWide / roadNormal / roadNarrow | `#4b535b` / `#3e454c` / `#343a40` |
| green | `#34503d` |
| water | `#22405a` |
| buildable | `#4fb3a9`, opacity 0.25 (update the `buildWorld.test.ts` expectation) |
| route, destination | `#ff6b3d` |
| origin | `#e8e4dc` |
| waiting | `#8e959c` |
| gridCenter / gridLine | `#3a4147` / `#2a3035` |
| edge (new) | `#f2eee6` |

Checks, computed on the rendered colours (palette × `shade(up)`, linear-space, as `SCENE_BACKGROUND`
is derived):
- every road tier is ≥ 1.3:1 against the ground and distinct from its neighbour tier;
- measured roofs are ≥ 7:1 against the ground;
- green and water are distinguishable from the ground and from each other.

`SCENE_BACKGROUND` stays derived. Update the pins in `palette.test.ts`, the
`--scene-background` value in `style.css`, and anything else that pins the old clay values
(`grep -rn "e6e1d8\|e1dcd3" client/src`).

**Building edges.**
- Add `MATERIALS.edge = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true,
  opacity: 0.35 })`, one shared material. Lines get no shade (comment it, as `waiting` does).
- In `buildWorld.ts`, give each extruded building a child `THREE.LineSegments(new
  THREE.EdgesGeometry(geometry, 1), MATERIALS.edge)`, named e.g. `edges`.
  - As a child it follows the build animation's `scale.y`.
  - Check what `buildAnimation.ts` `fadeIn` does with non-mesh children. Fading edges too is nicer,
    but whatever you choose, keep the shared material untouched.
  - Check `collision.ts`, `routeLayer.ts` picking and `framing.ts` aren't affected (they should
    only see meshes or named groups).
- **The glTF export must not include edges.** `exportWorld` in `scene/exportGltf.ts` exports
  `onlyVisible`, so hide `LineSegments` for the export and restore them in its `finally`, the same
  way userData is restored. The existing export tests (`COLOR_0` on every primitive, node names)
  must keep holding; add a test that the exported JSON has no primitive with `mode` 1 (LINES).
- The buildWorld test that asserts every mesh is unlit with vertex colours keeps passing:
  `LineSegments` aren't `isMesh`. Confirm it, and add a test that each building has exactly one
  edges child using `MATERIALS.edge`.

**Thumbnails.** `previewColors.ts` derives from the palette. Check that the building shadow
(`clay(ground, AMBIENT)`) is still distinguishable from the ground on dark (report the ratio). On a
near-black ground it probably isn't. In that case:
- make thumbnail buildings read by their pale roofs;
- draw the shadow as `clay(ground, AMBIENT)` mixed toward black, so it stays a visible darker tone.

Either way, report the numbers. Update `previewColors.test.ts` for any formula change.

## 2. CSS design tokens (`client/src/style.css`)

- `:root` gets `color-scheme: dark` and one token block. Values are hex, so a test can read them:
  - `--scene-background`, which keeps its name and test, and equals `SCENE_BACKGROUND`;
  - `--bg: var(--scene-background)`;
  - `--surface-1`, `--surface-2`, `--surface-3`: raised dark surfaces, each a step lighter;
  - `--border`;
  - `--text`, `--text-muted`;
  - `--accent: #ff6b3d`, matching the route;
  - `--link`: a light blue;
  - `--danger`, `--ok`, `--warning`.
- **Every other colour in `style.css` uses a token, or a `color-mix(in oklch, var(--x) N%,
  transparent|var(--y))` / relative colour of one.** No hex, `rgb()`, `rgba()`, `hsl()` or named
  colours (other than `transparent`/`currentColor`) outside the `:root` token block. The search icon's
  data-URI stroke colour is the one allowed exception; make it match `--text-muted` and leave a
  comment.
- Re-theme every section dark: header, explore panel, scene overlays, landing (hero,
  story, doing, recent, turn, hood, architecture SVG fills/strokes), location cards, locations
  page, skeletons, shimmer. Keep the hero, stage, skeleton and `.location-preview` rules flat and
  unindented, with `background: var(--scene-background)` (the hero test's regex needs that), and
  the hero stage borderless. Primary buttons become `--accent` fills with dark text if that passes
  4.5:1; otherwise use a light text that does.
- Don't add motion or new effects. That's brief 02. This part is colour only.
- New `client/src/styleTokens.test.ts`:
  - It reads `style.css` via `fs` and asserts there is no colour literal outside the `:root` block,
    using the same regex style as `palette.test.ts` and naming the offending line in the message.
  - For a table of pairs (`--text`, `--text-muted`, `--link`, `--danger`, the button text, each on
    `--bg`, `--surface-1` and `--surface-2` where they're used), it parses the hex values from
    `:root` and asserts WCAG contrast ≥ 4.5:1.
  - Implement the WCAG relative-luminance maths in the test file or a tiny helper module.
- After writing the guard, replay its regexes in a throwaway node script against copies of
  `style.css` mutated to (a) add a stray hex in a component rule and (b) lower `--text-muted` below
  4.5:1. Report that both trip the checks.

## 3. Dark 2D map

- `client/src/views/mapView.ts:10`: `BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark"`.
- New `client/src/views/mapColors.ts`: every paint colour of `views/mapDataLayers.ts`,
  `boundaries/boundaryTool.ts` and `importing/rectangleTool.ts`.
  - Derive them from `scene/palette.ts` `COLORS` where the roles match (water, green, road tiers,
    buildings measured/defaulted, buildable), so the 2D and 3D views agree.
  - Choose dark-map-legible values for the rest:
    - the boundary draft: keep it a warm orange, distinct from `--accent`;
    - saved boundaries: violet;
    - the selection rectangle: link blue, with danger red when too large;
    - feature points.
  - Export them as named constants.
- Those three files then contain no colour literals. Extend `scene/palette.test.ts`'s scan (or add
  a sibling test) to cover them.
- Note in your report anything on the dark basemap that is hard to read; don't restyle the basemap
  itself.

## 4. Docs

`openspec/specs/showcase-client/spec.md`: update the shading/palette requirement's wording if it
names light colours, and add a short requirement for the token rule and the 4.5:1 rule.
`docs/client-features.md`: one line on the dark theme.

## Report

Commits and files; the final palette with computed ratios; the token table with every contrast
pair; the mutation replay results; what you did for edges in the build animation and the export;
anything hard to read on the dark basemap; tsc result. End commits with
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
