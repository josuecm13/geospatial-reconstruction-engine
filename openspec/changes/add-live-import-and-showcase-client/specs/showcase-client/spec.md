## ADDED Requirements

### Requirement: The client SHALL reach the API through configuration and report errors by code
The client SHALL call the API through a configurable base URL. In development, that SHALL be a dev-server path forwarded to the API's configured port, so no port is hardcoded. Every failed call SHALL surface the API's error `code` and `details`. A failure that isn't the API's error envelope SHALL surface as `http_error`, and an unreachable API as `network_error`.

#### Scenario: A live import the source can't serve
- **WHEN** the API answers an import with a 503 `upstream_unavailable` error
- **THEN** the client reports the code `upstream_unavailable` with its details, not the raw message or status alone

#### Scenario: The API isn't running
- **WHEN** the dev server can't reach the API
- **THEN** the client reports `http_error`, and the header shows the API as unreachable

### Requirement: The client SHALL offer a 2D map view and a 3D scene view
The client SHALL switch between a 2D map view and a 3D scene view. Every page load SHALL open on the map view, whatever the URL says, and the 3D scene SHALL be built only when the user first opens the scene view. The map view SHALL always show the OpenStreetMap attribution, uncollapsed.

#### Scenario: Reloading on the scene
- **WHEN** a user reloads the page while the scene view is selected
- **THEN** the map view is shown, and no 3D scene is built until the user opens the scene view

### Requirement: The client SHALL select a rectangle of up to 1 km² and import it live
The map view SHALL let a user draw a rectangle by dragging and adjust it by its corners, SHALL show its area in km² while drawing using the same rule as the server, and SHALL disable import while the rectangle exceeds 1 km². Importing SHALL call the API without a payload, show elapsed progress, and then draw the area's map data: roads at their generated width, buildings distinguishing known from unknown heights, blocks, area features, and points of interest, each describable by clicking. Errors SHALL be shown by their code, never as the raw message. Importing a rectangle already imported SHALL first warn that re-import reconciles and may delete data.

#### Scenario: A rectangle over the limit
- **WHEN** a user draws a rectangle the server would measure at over 1 km²
- **THEN** the area readout marks it too large and import is disabled

#### Scenario: Re-importing the same rectangle
- **WHEN** a user imports a rectangle equal to one they imported before
- **THEN** the client asks for confirmation, warning that data OpenStreetMap no longer has will be deleted
