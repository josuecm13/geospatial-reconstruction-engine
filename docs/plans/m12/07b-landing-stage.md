# 1.7b The landing stage uses the landing theme (#141)

Read first: the "landing stage SHALL use the landing theme" requirement in
`openspec/changes/add-scene-themes-and-time-of-day/specs/site-settings/spec.md`. Then read
`client/src/landing/featuredStage.ts`, `client/src/scene/atmosphere.ts`, how `views/sceneView.ts` creates and
updates the atmosphere, and `api/client.ts` `getLandingTheme()`. Also read how the landing page gets the featured
area, which is the same kind of site-setting read.

## Do
1. **The stage reads the landing theme.**
   - `createFeaturedStage` reads `api.getLandingTheme()` alongside the map data.
   - Null, an error or an unknown id gives Night clay at midday, and the stage then looks exactly as today.
   - A failed read must never stop the stage from showing.
2. **It applies the theme.**
   - `setActiveTheme(theme)` before `buildWorld`, then `restyle`.
   - Create an atmosphere for the stage's scene and renderer: `setTheme`, then `setTime(time, { animate: false })`.
   - Call `update` in the stage's loop, with the turntable's camera and its target (the overview's centre), and
     `buildAnimating` while the stage's animator runs.
   - Dispose it in `dispose()`.
3. **Hero and story slots.** The canvas moves between the hero and the story slots. The theme is the same in both.
4. **Night windows and shadows** come for free through the materials and the atmosphere, so there's nothing extra.
5. **Tests.** A test of a pure helper that turns the API's value (or null, or a throw) into `{ theme, time }`
   with the Night clay fallback. The stage itself needs WebGL and stays untested, as today.

## Don't
- Touch the scene view, the picker or the materials.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-landing-stage` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not
pushed. Report the files and anything you couldn't do as written.
