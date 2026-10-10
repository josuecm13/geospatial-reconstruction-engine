## ADDED Requirements

### Requirement: The client SHALL draw the scene on terrain
The client SHALL build the 3D scene's ground as a mesh from the map-data elevation grid, and SHALL place road segments, blocks, and buildings on it, using each building's base elevation and each road's heights in the selected mode. Where the area has no elevation, the client SHALL draw the scene flat at its current behaviour.

#### Scenario: An analysed area
- **WHEN** a user opens the 3D scene of an area with a grid
- **THEN** the ground is a mesh that rises and falls with the grid, and buildings and roads rest on it

#### Scenario: An area without elevation
- **WHEN** a user opens the 3D scene of an area with `elevation: null`
- **THEN** the scene is drawn flat

### Requirement: The client SHALL toggle roads between exact and smoothed heights
The client SHALL offer a control that switches roads between the exact and the smoothed heights, and SHALL default to smoothed.

#### Scenario: Default mode
- **WHEN** a user opens the scene without having chosen a mode
- **THEN** roads use the smoothed heights

#### Scenario: Switching mode
- **WHEN** a user switches the road mode to exact
- **THEN** each road's vertices move to its exact heights

### Requirement: Walk mode SHALL follow the ground
In walk mode, the viewer's height SHALL follow the ground under the viewer, so that walking up a slope climbs it.

#### Scenario: Walking up a slope
- **WHEN** a user walks onto ground that rises by 5 metres
- **THEN** the viewer's eye rises with the ground rather than staying at its previous height

### Requirement: The client SHALL export the terrain and the current road mode to glTF
The glTF export SHALL include the ground mesh and the scene's roads, blocks, and buildings on it, with roads at the currently selected mode. An area without elevation SHALL export flat.

#### Scenario: Exporting in smoothed mode
- **WHEN** a user exports an analysed area's scene while roads are in smoothed mode
- **THEN** the exported file contains the ground mesh and roads at their smoothed heights

### Requirement: The client SHALL show the terrain attribution
The client SHALL show the terrain attribution from the map-data `elevation` object wherever it shows the OpenStreetMap attribution for the 3D scene.

#### Scenario: Scene with terrain
- **WHEN** a user views the 3D scene of an area with a grid
- **THEN** the terrain attribution string is visible alongside the OpenStreetMap attribution

#### Scenario: Scene without terrain
- **WHEN** a user views the 3D scene of an area with `elevation: null`
- **THEN** only the OpenStreetMap attribution is shown

## RENAMED Requirements

- FROM: `### Requirement: The client SHALL select a rectangle of up to 1 km² and import it live`
- TO: `### Requirement: The client SHALL select a rectangle of up to 10 km² and import it live`

## MODIFIED Requirements

### Requirement: The client SHALL select a rectangle of up to 10 km² and import it live
The map view SHALL let a user draw a rectangle by dragging and adjust it by dragging (inside to move it without changing its size, an edge to resize along one axis, a corner to resize both, by pointer events so touch works, with the cursor naming each part), SHALL show its area in km² while drawing or dragging using the same rule as the server together with its width and height, SHALL show the over-limit style before the drag is released, SHALL restore the previous rectangle when Escape cancels a drag, and SHALL disable import while the rectangle exceeds 10 km². Importing SHALL call the API without a payload, show elapsed progress, and then draw the area's map data: roads at their generated width, buildings distinguishing known from unknown heights, blocks, area features, and points of interest, each describable by clicking. Errors SHALL be shown by a sentence chosen by their code; the server's message and OpenStreetMap links appear only when the client's debug flag is on. Importing a rectangle already imported SHALL first warn that re-import reconciles and may delete data.

#### Scenario: A rectangle over the limit
- **WHEN** a user draws a rectangle the server would measure at over 10 km²
- **THEN** the area readout marks it too large and import is disabled

#### Scenario: Moving the rectangle
- **WHEN** a user drags inside the rectangle
- **THEN** the rectangle moves with its width and height unchanged, a label shows its size and area while dragging, and Escape before release puts it back where it was

#### Scenario: Re-importing the same rectangle
- **WHEN** a user imports a rectangle equal to one they imported before
- **THEN** the client asks for confirmation, warning that data OpenStreetMap no longer has will be deleted

### Requirement: The client SHALL open on a landing page that explains the engine
The client SHALL serve a landing page at `/` that says what the engine takes in (an OpenStreetMap rectangle of up to 10 km²), what it produces (streets with lanes and widths, buildable blocks, buildings at their source heights where the source has them, and a routable graph), and what it is for. It SHALL draw the pipeline (Overpass, ingestion, PostGIS domain, derivation, HTTP API, this client) as an interactive diagram in which hovering, focusing, or activating a stage shows what the stage produces and links to its documentation, and every stage SHALL be reachable by keyboard. It SHALL show the most recent completed import areas from `GET /import-areas` as cards that open the area, a link to the full locations page, and a primary action to import a new place. The explanation and the diagram SHALL render when the API is unreachable, and the locations block SHALL then show the error reporter's sentence. The layout SHALL fit down to a phone width.

#### Scenario: Reading a stage
- **WHEN** a user tabs to the "Derivation" stage of the diagram
- **THEN** the side card shows what derivation produces and a link to its documentation

#### Scenario: The API is down
- **WHEN** a user opens `/` while the API is unreachable
- **THEN** the explanation and the diagram are shown, and the locations block shows the sentence for `network_error` or `http_error`

#### Scenario: Opening a recent location
- **WHEN** a user selects a recent location's card
- **THEN** the client navigates, with no page load, to `/explore/<that area>`
