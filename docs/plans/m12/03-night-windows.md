# 1.3 Night windows in the building shader (#141)

Read first: the night-window decision in `openspec/changes/add-scene-themes-and-time-of-day/design.md`, and the
"Buildings SHALL show lit windows at night" requirement in its `specs/scene-themes/spec.md`. Then read
`client/src/scene/wallGrid.ts` (the wall coordinates you must mirror in GLSL), `scene/palette.ts`,
`scene/themes/` and `scene/atmosphere.ts`.

## Do
1. **`client/src/scene/nightWindows.ts`.**
   - `WINDOW_UNIFORMS`: shared uniform objects, one set for all materials. `uNight` (0..1), `uWarm` (colour,
     real buildings) and `uCool` (colour, generated buildings).
   - `patchWindows(material, { generated })`: sets `material.onBeforeCompile` to inject the window pattern, and
     sets `material.customProgramCacheKey` so patched and unpatched materials don't share a program.
   - The vertex shader passes the local position and the local normal (`position`, `normal`, the flat normal
     that `shadeGeometry` writes) to the fragment shader as varyings.
   - The fragment shader mirrors `wallCoords` exactly:
     - a wall is `abs(n.y) <= 0.5`; tangent `normalize(vec2(-n.z, n.x))`; `u = dot(p.xz, tangent)`; `v = p.y`;
     - cell = `floor(vec2(u / CELL_WIDTH, v / FLOOR_HEIGHT))`, local = the `fract` part;
     - the wall's plane id = `floor(dot(p.xz, n.xz) * 2.0)`, so facing walls of different buildings hash apart;
     - `lit = hash(cell, plane) < density`, with density 0.25 for real buildings and 0.15 for generated;
     - a lit window is the rectangle local x in [0.3, 0.7], local y in [0.3, 0.75], antialiased with `fwidth`;
     - no windows on the ground floor's lowest 0.5 m or on roofs.
   - Distance: compute `fw = fwidth(vec2(u / CELL_WIDTH, v / FLOOR_HEIGHT))`. As `max(fw)` goes from about 0.3 to
     1.0, blend from the crisp rectangle to the cell's average glow: density times the rectangle's area times a
     brightness. A far city reads as a soft speckle instead of flickering.
   - Add the result to the outgoing light as emissive. Find the right chunk for both `MeshBasicMaterial` and
     `MeshLambertMaterial` in r186 (for example, just before `#include <opaque_fragment>`, add to
     `outgoingLight`), so it shows where no light falls.
   - Scale it by `uNight`.
   - Use the CELL_WIDTH and FLOOR_HEIGHT constants from `wallGrid.ts`, interpolated into the GLSL string, so
     there's one source.
2. **In `palette.ts` `materialsFor`:**
   - Patch `buildingMeasured` and `buildingDefaulted` (`generated: false`) and `buildingGenerated`
     (`generated: true`) when `theme.windows !== "never"`.
   - The window colours come from the theme: add `windowWarm` and `windowCool` to the theme type, as optional
     colours or as part of a `windowColors` field. Give Night clay and Light clay values: a warm sodium-yellow and
     a cooler pale blue.
   - Night clay's look in daytime terms doesn't exist; it shows windows always, so `uNight` is 1 whenever Night
     clay is active.
3. **Driving `uNight`.** Each frame, the atmosphere (or the scene view's frame loop) sets `WINDOW_UNIFORMS.uNight`:
   - 1 for a theme with `windows: "always"`;
   - `atmosphere.night()` for `"night"` (so it fades with the 1.5 s transition);
   - 0 for `"never"`.
   It also sets `uWarm` and `uCool` from the active theme.
4. **A guard against three.js drift.** A test reads `client/node_modules/three/src/renderers/shaders/ShaderLib/meshbasic.glsl.js`
   and `meshlambert.glsl.js` (or wherever the chunks you replace live in r186), and asserts that every
   `#include <…>` your patch searches for exists. A three.js upgrade that renames them then fails loudly instead
   of silently drawing no windows. Also add a pure test of a `windowLit(cellX, cellY, plane, density)` JS twin of
   the hash, if you write one: it should hit about the density over many cells.

## Don't
- Add textures, bloom, extra geometry or per-frame CPU loops over meshes.
- Change Night clay's daytime colours or the baked shading.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-windows` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report:
- the files changed;
- the chunk you inject at, and why it works for both Basic and Lambert;
- the window colours;
- anything you couldn't do as written.
