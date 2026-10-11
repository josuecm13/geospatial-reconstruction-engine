# 1.5 Realistic: the theme and its textures in the scene (#141)

Read first: the Realistic decision in `openspec/changes/add-scene-themes-and-time-of-day/design.md`, and the
"four themes" requirement in its `specs/scene-themes/spec.md`. Then read:
- `client/src/scene/themes/textures.ts` (`createRealisticTextures`, `FACADE_REPEAT_METRES`, `GROUND_TILE_METRES`, `textureBytes`);
- `client/src/scene/wallGrid.ts`;
- `client/src/scene/nightWindows.ts` (`patchWindows`: it sets `onBeforeCompile` and `customProgramCacheKey`);
- `client/src/scene/palette.ts` and `client/src/scene/themes/lightClay.ts`, a lit theme to model on.

## Do
1. **`client/src/scene/themes/realistic.ts`**, added to `THEMES` after Light clay: `mode: "lit"`, `followsSun: true`,
   `windows: "night"`, with `windowColors`.
   - Base colours: brick/stucco facade, a grey roof, asphalt, grass, forest and water.
   - The other roles (outlines, zones, route, pin) in colours that pass the legibility guards against its ground.
   - Skies per preset, and fog. A slightly hazy, PS2-era look is the goal.
   - A `textures` field on the theme: the base colours for `createRealisticTextures`. Add it to `Theme` as optional.
2. **Textured materials, in `palette.ts` `materialsFor`.** For a theme with `textures`, create the texture set once
   per theme, cached with the materials.
   - **Buildings** (measured, defaulted, generated) are Lambert, with colour white or a light tint per kind, so
     generated buildings still read as different (a cooler tint), and the facade texture.
     - A shader patch replaces the map's UV with wall coordinates: walls use `wallCoords` mirrored in GLSL, divided
       by `FACADE_REPEAT_METRES`.
     - Roofs (`abs(n.y) > 0.5`) sample a second sampler, `uRoof`, with `groundCoords` over the roof tile.
     - Choose between them without branching around texture lookups that need derivatives. Sample both and `mix`
       by the roof mask. Keep derivatives in uniform control flow.
   - **Ground layers:**
     - roads get asphalt;
     - park green gets grass;
     - forest gets forest;
     - water gets water;
     - the ground plane stays untextured (its colour), and so do farmland, cemetery, railway and industrial.
     A patch maps them by world x and z (`modelMatrix` times `position` in the vertex shader) over
     `GROUND_TILE_METRES`.
   - **Composing with night windows.** The building materials need both patches. Write a small
     `composePatches(material, ...patches)` that chains the `onBeforeCompile` functions and joins the cache keys, or
     refactor `patchWindows` to return a patch function `(shader) => void` plus its key, so palette composes them.
     Either way, one `onBeforeCompile` per material runs both. The windows must still show at night in Realistic.
   - **Crisp pixels.** The textures already use nearest filtering. Check that `colorSpace` is right, so colours
     aren't washed out.
3. **The memory cap.** A test asserts `textureBytes` of Realistic's set is at most 1 MB.
4. **Tests:**
   - Realistic passes the legibility guards (automatic through `THEMES`);
   - `materialsFor(realistic)` gives Lambert buildings with a `map`, and roads with a `map`;
   - the composed building material's `onBeforeCompile` applies both patches to a fake shader object (`{ vertexShader, fragmentShader, uniforms }` built from three's ShaderLib meshlambert source), and its cache key has both parts;
   - Night clay and Light clay materials have no `map`.

## Don't
- Change the export (1.8), Blueprint, the picker or the landing stage.
- Download or add any asset file.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-realistic` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report:
- the files changed;
- the Realistic colours;
- how the patches compose;
- anything you couldn't do as written.
