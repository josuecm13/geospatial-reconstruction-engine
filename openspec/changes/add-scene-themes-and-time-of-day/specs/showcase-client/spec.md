## MODIFIED Requirements

### Requirement: The client SHALL shade the scene by a fixed rule and draw it unlit
In a theme with baked shading (Night clay), the scene SHALL use no real-time lights for its faces. Each face SHALL be shaded as `shade(n) = AMBIENT + (1 - AMBIENT) * max(0, n . LIGHT_DIRECTION)`, with `n` the face's unit normal in world orientation, `LIGHT_DIRECTION` one fixed unit vector pointing toward the light, and `AMBIENT` one fixed constant (0.55). The shade SHALL be baked into a grey per-vertex `color` attribute on every vertex of the face, and every face material SHALL be unlit and multiply that shade into its colour, so a face pointing at the light shows exactly its palette colour. Themes that follow the sun SHALL light their faces with the sun and sky light instead (see the scene-themes capability), and SHALL not apply the baked shade. Every colour of the scene (faces, sky, grid, route, markers, the waiting wireframe, building edge lines) SHALL come from `scene/palette.ts` and the theme files under `scene/themes/`, and nowhere else. Night clay's palette SHALL be dark (a near-black ground with pale buildings). Each building SHALL carry an edge-line child drawn with one shared material per theme. The glTF export SHALL leave those lines out, except in a theme whose look is line work. In Night clay the glTF export SHALL carry the same colours and shade: unlit materials (`KHR_materials_unlit`) and `COLOR_0` on every mesh primitive.

#### Scenario: Two walls facing the same way
- **WHEN** two buildings in Night clay have walls with the same orientation, at different places in the scene
- **THEN** those walls have the same shade

#### Scenario: A wall facing away from the light
- **WHEN** a face's normal in Night clay points directly away from the light
- **THEN** its colour is its palette colour multiplied by `AMBIENT`

#### Scenario: The exported file
- **WHEN** a user downloads the glTF of an open area in Night clay and opens it in another viewer
- **THEN** the faces show the same colours and shading as the scene view, with no lighting of the viewer's own

### Requirement: The client SHALL export the scene as glTF
The scene view SHALL offer a "Download glTF" button, enabled once a world is loaded and while no build is running, that saves the visible world (and nothing else: no lights, sky, route markers, or placeholder) as a binary `.glb` named `gre-<scope type>-<first 8 characters of the scope id>.glb`. The file SHALL use the active theme's materials: unlit with vertex colours in Night clay, lit materials in themes that follow the sun, the small textures of Realistic with texture coordinates on the textured meshes, and the building and road lines of Blueprint. The root node's `extras` SHALL carry the scope, the projection origin and meters-per-degree, the axes, the OpenStreetMap attribution, the active `theme` and the `time_of_day`, and the asset's `copyright` SHALL be the attribution. Entity nodes SHALL be named `<layer>:<id>`. The file SHALL pass the Khronos glTF validator with no errors in every theme.

#### Scenario: Metadata in the file
- **WHEN** a user downloads the glTF of an open import area
- **THEN** the root node's extras hold the scope, the projection origin, the theme and the time of day, and the asset copyright is "© OpenStreetMap contributors"

#### Scenario: Node names
- **WHEN** the file is opened in a glTF viewer
- **THEN** a building appears as a node named `building:<id>` and a road as `road:<id>`

#### Scenario: A Realistic export
- **WHEN** a user downloads the glTF while the scene is in Realistic
- **THEN** the file carries the theme's textures, its textured meshes have texture coordinates, and it passes the validator
