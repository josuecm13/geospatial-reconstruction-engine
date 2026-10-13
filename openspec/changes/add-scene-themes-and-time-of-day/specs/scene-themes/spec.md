## Purpose

Lets the 3D scene be shown in one of several looks and at one of several times of day, with every layer, the sky and the lighting following the choice, so the same reconstructed place can be presented as a clay model, a blueprint or a low-fi realistic city, by day or by night.

## ADDED Requirements

### Requirement: Every scene layer SHALL take its look from the active theme
A theme SHALL be one typed object that sets the colours of every scene role (measured, defaulted and generated buildings, building edges, roads by lane type, water, park and each land-use kind, ground, block outlines by kind, zones by reason, the route, the origin and destination markers, the pin, the waiting wireframe), the sky and fog, the lights, the material mode, the textures, whether it follows the sun, and its night windows. No scene source other than the palette and the theme files SHALL contain a colour literal or build a material. Switching the theme SHALL restyle every layer of a loaded world, the sky and the lighting without reloading the page or rebuilding the world.

#### Scenario: Switching themes on a loaded world
- **WHEN** a user switches from Night clay to Light clay with an area open
- **THEN** the buildings, edges, roads, area features, ground, block outlines, zones, route, pin, sky and lighting all change, and the world is not rebuilt

#### Scenario: A colour written outside the themes
- **WHEN** a scene source outside the palette and theme files contains a hex colour or builds a material
- **THEN** the palette guard test fails, naming the file

### Requirement: The client SHALL offer four themes
The client SHALL offer Night clay, Light clay, Blueprint and Realistic. Night clay SHALL look as the scene did before themes: baked shading, a dark ground, pale buildings and the existing palette. Light clay SHALL be a pale clay model with warm off-white buildings, a soft grey ground and muted water and green, lit by the sun. Blueprint SHALL be a navy ground with a fine grid, buildings drawn as cyan or white edges over faint translucent fills, generated buildings with dashed edges, and roads drawn as outlines, with no sun and no textures. Realistic SHALL show low-resolution textures with crisp, unfiltered pixels (facades with window grids, roofs, asphalt, grass, forest and water), generated in the browser with no downloaded files, and SHALL be lit by the sun.

#### Scenario: Night clay is the reference
- **WHEN** the scene is shown in Night clay
- **THEN** every face's colour is its Night clay palette colour times the fixed shade, as before themes

#### Scenario: Blueprint reads as line work
- **WHEN** the scene is shown in Blueprint
- **THEN** buildings show as edges over translucent fills, generated buildings' edges are dashed, roads show their outlines, and the ground shows a grid

#### Scenario: Realistic with no downloads
- **WHEN** the scene is shown in Realistic
- **THEN** buildings, roads, grass, forest and water are textured, and no texture file is requested over the network

### Requirement: Every theme SHALL meet the palette's legibility guards
For every theme, the pairs of scene colours the palette guards check SHALL meet the same contrast thresholds, so a block outline, a zone, the route or the pin stays visible over the ground in every theme. The total memory of a theme's textures SHALL be at most 1 MB.

#### Scenario: A theme colour that stops being legible
- **WHEN** a theme's route colour is changed so that it falls below the guarded contrast against that theme's ground
- **THEN** the palette guard test fails, naming the theme and the pair

### Requirement: The scene SHALL show a sky and a time of day
The scene SHALL draw a sky dome with a gradient from horizon to zenith, with a sun disc in daytime presets or a moon at night, and fog that matches the horizon. The time of day SHALL be one of four presets: dawn, midday, golden hour and night. In a theme that follows the sun, the preset SHALL set the sun light's direction, colour and intensity, the sky light and the sky's colours, so each preset is visibly distinct and lit faces follow the sun's direction. A change of preset SHALL animate over about a second and a half, and SHALL be instant when the user prefers reduced motion. In a theme that does not follow the sun, the lighting SHALL stay fixed and the time control SHALL show as not applicable.

#### Scenario: Lighting follows the sun
- **WHEN** a user in Light clay changes from dawn to golden hour
- **THEN** the sun moves in the sky and the walls facing it brighten while the others darken

#### Scenario: Reduced motion
- **WHEN** a user who prefers reduced motion changes the time of day
- **THEN** the new lighting appears at once, with no animation

### Requirement: Themes that follow the sun SHALL cast shadows from it
In a theme that follows the sun, buildings SHALL cast shadows from the sun onto the ground, roads and area features, using a shadow map that covers the camera's view and is redrawn only when the sun, the view or the buildings change. Themes that do not follow the sun SHALL draw no shadows. When the camera is far enough from its target that a shadow texel would pass about a metre, the sun SHALL stop casting shadows (the lights stay on), and SHALL cast them again once the camera is nearer by a margin, so a camera at the threshold does not flip them.

#### Scenario: Shadows move with the sun
- **WHEN** a user in Realistic changes the time from midday to golden hour
- **THEN** building shadows lengthen and turn with the sun

#### Scenario: Shadows from high up
- **WHEN** a user in Realistic zooms out until the camera is far from the orbit target
- **THEN** the shadows disappear while the sun and sky light still light the scene, and they return when the user zooms back in

### Requirement: Buildings SHALL show lit windows at night
At the night preset, in a theme with night windows, building walls SHALL show small lit windows: a grid of floors and columns at a realistic scale on each wall, with a share of the cells lit in a warm colour that shows even where no light falls, and none on roofs. Generated buildings SHALL use a different window colour and density from real ones. From a distance the windows SHALL blend into a soft glow rather than flicker. The windows SHALL cost no per-frame CPU work and no extra geometry. Night clay SHALL show its windows always, and Blueprint SHALL show none.

#### Scenario: Night falls
- **WHEN** a user in Light clay changes the time to night
- **THEN** building walls show scattered lit windows, and generated buildings' windows differ in colour from real ones

### Requirement: The scene SHALL offer a theme picker and a time control that persist
The scene view SHALL offer a theme picker listing the four themes and a time-of-day control with the four presets. The choice SHALL be kept in the browser and restored on the next visit. An unknown stored theme SHALL fall back to Night clay. The theme control SHALL offer **Use on landing**, which stores the current theme and time as the landing theme.

#### Scenario: Coming back
- **WHEN** a user picks Blueprint, leaves, and opens the scene again later in the same browser
- **THEN** the scene opens in Blueprint

### Requirement: A 10 km² area SHALL stay responsive in every theme
The scene SHALL stay smooth to orbit and walk with the 9.83 km² Midtown–Chelsea area loaded, in every theme and at every time of day. A `?fps` query parameter SHALL show a frame-time readout in the scene so the budget can be checked.

#### Scenario: Checking the budget
- **WHEN** the owner opens the scene with `?fps` on the Midtown–Chelsea area and switches through every theme
- **THEN** the readout shows the frame time of each, and orbiting stays smooth
