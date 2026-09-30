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
The client SHALL switch between a 2D map view and a 3D scene view, and the selected view SHALL survive a page reload. The map view SHALL always show the OpenStreetMap attribution, uncollapsed.

#### Scenario: Reloading on the scene
- **WHEN** a user reloads the page while the scene view is selected
- **THEN** the scene view is shown again
