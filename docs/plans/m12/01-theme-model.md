# 1.1 Theme model (#141)

Read first: `openspec/changes/add-scene-themes-and-time-of-day/design.md` (all of it) and its
`specs/scene-themes/spec.md`. This task lays the foundation only: **Night clay must look exactly as today,
pixel for pixel.** No new themes, no lights, no UI.

## Do
1. `client/src/scene/themes/types.ts`: the `Theme` type. Fields: `id` (`"night-clay" | "light-clay" | "blueprint" | "realistic"`),
   `label`, `colors` (one entry per key of today's `COLORS` in `scene/palette.ts`, same names), `sky` (`zenith`, `horizon`, `below` colours),
   `fog` (`{ color, near, far } | null`), `mode` (`"baked" | "lit" | "line"`), `followsSun` (boolean),
   `windows` (`"always" | "night" | "never"`). Also export `TIMES_OF_DAY = ["dawn", "midday", "golden-hour", "night"]` and a `TimeOfDay` type.
   Keep it to these fields; later tasks add what they need.
2. `client/src/scene/themes/nightClay.ts`: Night clay, with `colors` exactly today's `COLORS` values (move them here),
   `mode: "baked"`, `followsSun: false`, `windows: "always"`, `fog: null`, a sky whose three colours are all today's `SCENE_BACKGROUND` value.
3. `client/src/scene/themes/index.ts`: `THEMES` (just Night clay for now), `DEFAULT_THEME`, and `themeById(id: string | null | undefined): Theme`, falling back to Night clay for an unknown id.
4. `scene/palette.ts`:
   - `COLORS` stays exported and equals Night clay's colours (the 2D map, the location previews and `--scene-background` read it; they are out of scope and must not change).
   - `materialsFor(theme)` builds the full material set (today's `MATERIALS` code, parameterised by `theme.colors`), **memoised per theme id**. Every material gets `material.userData.key = <its key>`.
   - `MATERIALS` stays a module-level object, so the existing import sites keep working. `setActiveTheme(theme)` replaces its entries in place (`Object.assign`) with that theme's set. Meshes built afterwards pick up the active theme.
   - `restyle(root: THREE.Object3D)` walks `root` and, for every mesh or line whose material has `userData.key`, assigns `MATERIALS[key]`. Material sets are cached, never disposed.
   - `activeTheme()` returns the active theme.
   - `roadMaterial`, `areaFeatureMaterial`, `outlineMaterial` and `zoneMaterial` keep reading `MATERIALS` at call time. `zoneColor` reads the active theme's colours.
5. `scene/shading.ts`: `shadeGeometry` also writes each face's flat normal as the `normal` attribute (it already computes it). Lit materials in 1.2 need it. Update the doc comment, and add a `shading.test.ts` case. `exportGltf.ts` already strips normals from unlit meshes, so the export doesn't change. Check that.
6. Guards, in `scene/palette.test.ts`:
   - The colour-literal guard scans `scene/` **recursively**, and exempts `palette.ts` and everything under `scene/themes/`. Update its "covers the scene sources" test, which asserts the file set.
   - Split the contrast tests into (a) **legibility guards that run over every theme in `THEMES`** (`it.each`): road tiers apart from the ground and each other, green and water apart from the ground and each other, the land-use kinds apart, generated apart from measured and defaulted, and the route, pin, block outline and selected outline apart from the ground (choose thresholds that Night clay passes today, and name the theme in the failure); and (b) the guards that are Night clay's character (roofs 7:1, the cool generated hue, `SCENE_BACKGROUND === "#1a1f23"`), which stay as Night clay only.
   - Add a test that `restyle` swaps a mesh's material by key after `setActiveTheme`, using a stub second theme built in the test. Three.js meshes and materials construct fine in node.
7. Every view that renders must call `setActiveTheme(...)` then `restyle(itsRoot)` when it is shown. Today that's always Night clay, so do it in `views/sceneView.ts`'s `shown()` and `landing/featuredStage.ts` at creation, using `DEFAULT_THEME`. Later tasks replace the default with the stored choice.

## Don't
- Change any colour value, material parameter, draw order or geometry.
- Run `npm test`, `vitest` or `npm run build` (CI does). `npx tsc --noEmit` in `client/` is allowed.
- Touch the server, the 2D map, `style.css` or the docs.

## Done when
Committed on `work/m12-theme-model` (Conventional Commit, `feat(client): ...`, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), not pushed. Report: the files changed, the
`Theme` type as written, the guard thresholds you chose and why, and anything in the design that didn't fit the code.
