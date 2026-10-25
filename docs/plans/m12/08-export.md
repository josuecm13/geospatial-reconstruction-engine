# 1.8 The glTF export follows the theme (#141)

Read first: the export decision in `openspec/changes/add-scene-themes-and-time-of-day/design.md`, and the modified
"export the scene as glTF" and "shade the scene" requirements in its `specs/showcase-client/spec.md`. Then read:
- `client/src/scene/exportGltf.ts` and `exportGltf.test.ts`, which already run the Khronos validator in tests;
- `client/src/scene/exportButton.ts`;
- `client/src/scene/palette.ts` (`activeTheme`);
- `client/src/scene/wallGrid.ts` and `themes/textures.ts`;
- `client/src/scene/atmosphere.ts`, for the current time of day.

## Do
1. **The extras.** The root `extras` gain `theme` (the active theme's id) and `time_of_day`. Let `exportWorld`
   take them as an options argument: `exportWorld(world, { theme, timeOfDay })`. The export button passes them,
   so it needs a way to read the current time, which the scene view gives it.
2. **Night clay.** It exports as today: unlit, `COLOR_0`, no normals, no UVs, lines left out.
3. **Lit themes** (Light clay, Realistic):
   - three's exporter writes Lambert as metallic-roughness. Check what r186's `GLTFExporter` does with
     `MeshLambertMaterial`. If it's unsupported, swap in an equivalent `MeshStandardMaterial` (roughness 1,
     metalness 0, same colour, map, transparency) for the export only, and restore afterwards, as the existing code
     does with userData and attributes.
   - Keep normals.
   - Drop `COLOR_0`: lit materials don't use vertex colours, so remove the `color` attribute for the export and
     restore it.
4. **Realistic.**
   - The textured meshes get a `uv` attribute baked for the export, then removed: building walls from `wallCoords`
     over `FACADE_REPEAT_METRES`, and ground layers from `groundCoords`.
   - glTF has one UV set per material, and roofs use another texture. For roofs, either export them with the facade
     texture or split nothing and accept it. Simplest acceptable choice: walls and roofs both use the facade map in
     the file, and the doc comment says so.
   - The textures are `DataTexture`s. Check that r186's exporter writes them (it needs a canvas in the browser).
     If it can't in node tests, the validator test for Realistic can stub or skip the image, but the browser
     export must include it. Say what you found.
   - Night windows, the sky and shadows are not exported.
5. **Blueprint.**
   - Building edges, generated building edges and the road outlines are exported as line primitives (dashes
     become solid lines).
   - The block outlines stay out, as today.
   - Fills keep their transparency.
6. **Tests**, extending `exportGltf.test.ts` (it runs the validator):
   - for each theme, a small world exports with no validator errors;
   - extras have `theme` and `time_of_day`;
   - Night clay meshes have `COLOR_0` and `KHR_materials_unlit`;
   - Light clay has normals and no `COLOR_0`;
   - Realistic's building meshes have `TEXCOORD_0` and a texture;
   - Blueprint has line primitives (mode 1);
   - after the export, the world's attributes, materials and userData are restored.

## Don't
- Change how the scene looks.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-export` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report:
- the files changed;
- what the exporter does with Lambert and DataTexture in r186;
- anything you couldn't do as written.
