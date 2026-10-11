# 1.2 Lighting: sky, time of day, the sun, shadows, Light clay (#141)

Read first: `openspec/changes/add-scene-themes-and-time-of-day/design.md` and `specs/scene-themes/spec.md`
(the sky, time-of-day, shadow and four-themes requirements). Then read the theme model as it now is:
`client/src/scene/themes/`, `scene/palette.ts` (`materialsFor`, `setActiveTheme`, `restyle`, `activeTheme`)
and `scene/shading.ts`. **Night clay must still look exactly as it does now.**

## Do
1. **Time of day**, in `scene/themes/timeOfDay.ts`: one `Lighting` per preset (`dawn`, `midday`, `golden-hour`, `night`):
   the sun's unit direction (pointing toward the sun, scene axes x east, y up, z south), its colour and intensity, the
   hemisphere light's sky and ground colours and intensity, and `night` (0 or 1: 1 only at night). Choose them so the
   presets are clearly different:
   - dawn: low in the east, about 8°, pink-orange;
   - midday: high, about 65°, a little south, near-white;
   - golden hour: low in the west, about 12°, deep amber;
   - night: a cool, dim moonlight from about 35°.
   Add a pure `blendLighting(a, b, t)` that lerps colours and numbers and slerps the direction.
2. **Light clay**, in `scene/themes/lightClay.ts`, added to `THEMES`: `mode: "lit"`, `followsSun: true`, `windows: "night"`.
   Warm off-white buildings (defaulted a little greyer, generated a pale cool tint), a soft grey ground, muted water
   and green, and the other roles toned to match. Give it a sky per preset (zenith, horizon, below) and fog. The
   `Theme` type gains an optional per-preset sky for themes that follow the sun. It must pass the universal legibility
   guards in `palette.test.ts`.
3. **Lit materials**, in `palette.ts` `materialsFor`: for `mode: "lit"`, the building and ground-layer materials are
   `MeshLambertMaterial` with `flatShading: true` and `vertexColors: false`, keeping each one's transparency, depthWrite
   and side settings. Lines, the route, the markers, the pin and the waiting wireframe stay unlit. `"baked"` is today's code.
4. **The atmosphere**, in `scene/atmosphere.ts`: `createAtmosphere(scene, renderer)` owns:
   - the sky dome: an inverted sphere with a gradient `ShaderMaterial` (zenith, horizon, below the horizon), plus a sun disc and soft glow at the sun's direction by day and a smaller pale moon at night. The material is built in `scene/themes/sky.ts`, because the palette guard only allows materials there and in `palette.ts`. The dome follows the camera's position, with a radius of 0.9 of the camera's far plane, and writes no depth;
   - one `DirectionalLight` (the sun) with its target, and one `HemisphereLight`;
   - `scene.fog`, coloured as the sky's horizon.

   API:
   - `setTheme(theme)`;
   - `setTime(time, { animate })`, which blends over 1.5 s with an ease, or applies at once when `animate` is false. The caller passes `!prefersReducedMotion()`;
   - `update(deltaSeconds, camera, target, { buildAnimating })`;
   - `night()`, the current blended night value (1.3 uses it);
   - `dispose()`.

   In a theme that doesn't follow the sun, the lights are off (intensity 0), the dome shows the theme's fixed sky with no sun, and `setTime` changes nothing visible. Night clay keeps `fog: null`, and its sky colour is its background, so it looks as today.
5. **Shadows.**
   - In a theme that follows the sun, set `renderer.shadowMap.enabled` (`PCFShadowMap`) and let the sun cast shadows.
   - Building and generated meshes `castShadow` and `receiveShadow`. The ground, roads, area features and block fills `receiveShadow`. Set these flags where the meshes are built (`buildWorld.ts`, and the staged build path in `stagedScene.ts`/`stagedBuild.ts`) so they hold for every world. They are harmless in unlit themes.
   - Fit the orthographic shadow camera to the view. Centre it on the orbit target, with a half-size of the camera's distance to the target times about 0.8, clamped to 150–1500 m. Place it along the sun direction, and snap its centre to whole shadow texels in light space so edges don't shimmer.
   - Map size 2048. Set `shadow.autoUpdate = false`, and set `needsUpdate` only when the sun, the snapped centre or the size changed, or while a build animation runs.
   - Put the fit maths in a pure, tested function (`fitShadow(target, distance, sunDirection, mapSize)` → centre and half-size).
6. **Wiring in `views/sceneView.ts`:**
   - Create the atmosphere and call `update` in the frame loop. The orbit target is `controls.target`. Pass whether the animator is running.
   - Expose `setTheme(id)` and `setTimeOfDay(time)` on the `SceneView`. They apply `setActiveTheme`, `restyle(scene)` and the atmosphere. 1.6 adds the controls that call them, so there's no UI in this task.
   - Default to Night clay at midday.
   - `scene.background` becomes the active sky's horizon colour, so the frame before the dome draws matches it.
   - The landing stage is not part of this task.
7. **Tests (vitest, no WebGL):**
   - the presets are distinct, and their directions are unit vectors above the horizon;
   - `blendLighting` at 0, 1 and 0.5;
   - `fitShadow`'s clamping and texel snapping;
   - Light clay passes the legibility guards (it will, through `THEMES`);
   - `materialsFor(lightClay)` gives Lambert building materials with `vertexColors` false, and `materialsFor(nightClay)` is unchanged.

## Don't
- Add the theme picker UI, night windows, Blueprint, Realistic, export changes or landing changes. Those are later tasks.
- Change Night clay's colours, materials or look.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-lighting` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed. Report:
- the files changed;
- the preset values;
- the Light clay colours;
- how the dome, the fog and the far plane fit together;
- anything you couldn't do as written, and why.
