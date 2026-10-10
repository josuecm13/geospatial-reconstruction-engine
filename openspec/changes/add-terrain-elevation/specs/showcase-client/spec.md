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
