## Context

Today `scene/palette.ts` holds every scene colour (`COLORS`) and one shared material per kind (`MATERIALS`),
all `MeshBasicMaterial` with the shade of one fixed light baked into vertex colours (`scene/shading.ts`).
Meshes take those materials directly when they are built. The 2D map (`views/mapColors.ts`), the location
previews and the page tokens (`--scene-background`) derive from the same `COLORS`. A world has one mesh per
building, each with an edge-line child, so a 10 km² area is about 7,000 meshes and 7,000 line objects.
The decisions below were settled with the owner on #141. See proposal.md, Why.

## Goals / Non-Goals

**Goals:**
- One typed `Theme` per look, and nothing in a scene layer that names a colour or builds a material itself.
- Switching the theme or the time of day restyles a loaded world in place, with no rebuild of its geometry.
- Night clay looks exactly as today, so it stays the reference and its guards keep their values.

**Non-Goals:**
- Theming the 2D map, the location previews or the page chrome. They keep reading Night clay's colours.
- The real sun position for a place and date, bloom or other post-processing passes, and downloaded assets.
- Asset identities for places of interest (Milestone 13, #24).

## Decisions

- **Themes are data, under `scene/themes/`.** `types.ts` defines `Theme`: an id and label, the colour of
  every role (today's `COLORS` keys, by the same names), the sky and fog, the material mode (`baked`, `lit`,
  `line`), the texture set (Realistic only), whether it follows the sun, and its night-window settings. One
  file per theme, and `index.ts` lists them. `palette.ts` stays the only place a material is built, now from
  a theme: `materialsFor(theme)` returns the full material set by key. `COLORS` stays exported as Night
  clay's colours, so the 2D map, the previews and `--scene-background` don't change.
- **Meshes carry a material key, not a fixed material.** Every scene mesh and line records its key in
  `userData.material` (`buildingMeasured`, `roadWide`, `edge`, …) when it is built. Applying a theme builds
  the new material set, walks the scene and reassigns each object by its key, then disposes the old set. A
  material can change class (basic, lit, line, textured) without rebuilding geometry. A rebuild per switch was
  rejected: a 10 km² world takes seconds to build and would lose the build animation's state.
- **Night clay keeps baked shading, and lit themes use real lights.** Night clay and Blueprint stay unlit
  (`MeshBasicMaterial`), so lights don't affect them. Light clay and Realistic use `MeshLambertMaterial`
  with `flatShading` and `vertexColors` off (the baked shade would darken twice), lit by one
  `DirectionalLight` (the sun), a `HemisphereLight` (the sky) and the theme's fog. `shadeGeometry` also writes
  each face's flat normal, which it already computes, so every geometry has normals a light can use.
- **Time of day is four presets defined once.** Each preset sets the sun's direction, colour and intensity,
  the sky light, and a `night` value from 0 to 1. A theme that follows the sun can tint the sky gradient and
  fog per preset. A theme that doesn't keeps its own fixed lighting, and the time control shows as fixed for
  it. Changing the time animates the lighting over about 1.5 s (colours lerped, the sun direction slerped),
  and is instant under reduced motion. Changing the theme is instant.
- **The sky is a dome that follows the camera.** It is a large inverted sphere with a gradient shader
  (zenith, horizon, below-horizon), with the sun drawn as a disc and glow at the sun's direction, or the moon
  at night. The fog colour is the horizon colour, so the far edge of the world dissolves into the sky. Its
  radius stays inside the camera's far plane. Night clay's sky is a near-flat gradient around today's
  background, with no sun.
- **Shadows are fitted to the view.** In themes that follow the sun, the sun casts shadows from buildings
  onto the ground layers. The orthographic shadow camera is centred on the orbit target, sized by the camera's
  distance (clamped), with its position snapped to whole shadow texels so edges don't shimmer. The map is
  2048² and redraws only when the sun, the target or the zoom has moved enough to matter, or while a build
  animation is running. A single map over the whole area was rejected: over 3 km it is several metres a texel.
- **Night windows are drawn in the building shader.** The building materials get a shader patch
  (`onBeforeCompile`) that works out a window grid on each wall. A building mesh is only translated on y
  (shading.ts), so its local x and z are world metres and its local y is the height above its base. Floors
  are `y / 3.2 m`, columns are the distance along the wall (from the wall's normal) over 3.5 m, and roofs get
  none. A hash of the cell and the wall's plane decides whether a window is lit (theme density, about 25%,
  lower for generated buildings). A lit window is an emissive rectangle inset in its cell, in the theme's
  warm colour (cooler for generated), scaled by a `night` uniform, so it shows even where no light falls. When
  a cell is smaller than about a pixel, the shader draws the cell's average glow instead of the rectangle, so
  a distant city reads as a soft speckled glow rather than flicker. No per-frame CPU work, geometry or
  textures. A bloom pass was rejected for its full-screen cost.
- **Realistic's textures are drawn in the browser.** Facade (a window grid), roof, asphalt, grass, forest and
  water are drawn once as 64×64 RGBA byte arrays wrapped as `DataTexture`s (no canvas, so they test in jsdom),
  from a seeded generator, so every run draws the same pixels. They use nearest filtering for crisp pixels (nearest mipmaps when minified, so distance doesn't
  shimmer). Total texture memory is capped at 1 MB, and a test asserts it. Walls are textured in the same
  wall coordinates as the night windows, and ground layers by world x and z over a tile size, so no geometry
  carries new UVs while viewing.
- **Blueprint is line work.** A navy ground with a fine grid, drawn in the ground shader (10 m lines, a
  stronger line every 100 m, antialiased by screen-space derivatives). Buildings have faint translucent fills
  with cyan or white edges, and generated buildings have dashed edges (`computeLineDistances` on their edge
  geometry, done once on first use). Roads are faint fills with their outlines drawn as lines, built once on
  first use from the stored road outlines at the road's height, like the block outlines. No sun, no textures,
  no shadows.
- **The export follows the active theme.** Night clay exports as today (unlit, `COLOR_0`). Lit themes export
  their lit materials (glTF metallic-roughness), with normals and without `COLOR_0`. Realistic writes its small
  textures, with a `uv` attribute baked at export time by a TypeScript twin of the shader's wall and ground
  coordinates, removed again afterwards. Blueprint writes its building and road lines as line primitives,
  since lines are its look (dashes become solid). Night windows, the sky and shadows are viewer effects and are
  left out, like the edges of the other themes. The root extras record `theme` and `time_of_day`.
- **The choice persists per browser, and the landing theme is a site setting.** The scene's theme and time are
  kept in `localStorage`, not in the URL, since they are a preference rather than view state. The landing
  stage uses the `landing_theme` site setting (theme and time), defaulting to Night clay, which is today's
  hero. The scene's theme control has **Use on landing**, which stores the current choice, mirroring the
  featured place's **Show on landing**. It sits on the existing key/value `site_settings` table, so no
  migration is needed.
- **Performance is measured, not assumed.** A `?fps` query parameter shows a frame-time readout in the scene,
  so the budget can be checked on Midtown–Chelsea in every theme. If a theme misses it, the first remedy is
  merging the finished buildings into one geometry per material once the build animation ends, keeping
  picking through a face-to-id map. That remedy is built only if the measurement asks for it.

## Risks / Trade-offs

- [7,000 meshes, now drawn a second time for the shadow map] → Shadows redraw only on change, and the shadow
  camera covers only the view. Merging (above) is the fallback.
- [Shader patches depend on three.js shader chunk names] → The patch is kept in one module with a test that
  the chunks it replaces exist in the installed three.js.
- [Lit themes no longer match the export exactly, since another viewer relights them] → Accepted. The export
  records the theme and time, and Night clay still matches exactly.
- [`localStorage` theme with a removed theme id] → An unknown id falls back to Night clay.
