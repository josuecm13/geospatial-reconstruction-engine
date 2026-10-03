## ADDED Requirements

### Requirement: The client SHALL reach the API through configuration and report errors by code
The client SHALL call the API through a configurable base URL. In development, that SHALL be a dev-server path forwarded to the API's configured port, so no port is hardcoded. Every failed call SHALL surface the API's error `code` and `details`, and every view SHALL display a failure through one error reporter that shows a sentence chosen by that code. The server's own message and links to the OpenStreetMap elements it names SHALL appear only when the client's debug flag is on, and only for the codes that carry them (`ingestion_failed`, `payload_outside_bounding_box`, `source_incomplete`). A failure that isn't the API's error envelope SHALL surface as `http_error`, and an unreachable API as `network_error`.

#### Scenario: A live import the source can't serve
- **WHEN** the API answers an import with a 503 `upstream_unavailable` error
- **THEN** the client reports the code `upstream_unavailable` with its details, not the raw message or status alone

#### Scenario: The API isn't running
- **WHEN** the dev server can't reach the API
- **THEN** the client reports `http_error`, and the header shows the API as unreachable

#### Scenario: An import failure with the debug flag off
- **WHEN** the API answers an import with a 422 `ingestion_failed` error whose message is "way 123 must be a closed polygon", and the debug flag is off
- **THEN** the client shows only its sentence for `ingestion_failed`, without the message or any link

#### Scenario: An import failure with the debug flag on
- **WHEN** the same error arrives and the debug flag is on
- **THEN** the client shows its sentence, the server's message, and a link to `https://www.openstreetmap.org/way/123` that opens in a new tab

### Requirement: The client SHALL offer a 2D map view and a 3D scene view
The client SHALL switch between a 2D map view and a 3D scene view of the open area, and the 3D scene SHALL be built only when the scene view is first shown, so a map-only visit never downloads Three.js or creates a WebGL context. The view is part of the URL (see "The client SHALL keep each view's state in its URL"). The map view SHALL always show the OpenStreetMap attribution, uncollapsed.

#### Scenario: A map-only visit
- **WHEN** a user opens an explore URL without `view=scene` and never switches to the scene
- **THEN** no 3D scene is built

### Requirement: The client SHALL select a rectangle of up to 1 km² and import it live
The map view SHALL let a user draw a rectangle by dragging and adjust it by dragging (inside to move it without changing its size, an edge to resize along one axis, a corner to resize both, by pointer events so touch works, with the cursor naming each part), SHALL show its area in km² while drawing or dragging using the same rule as the server together with its width and height, SHALL show the over-limit style before the drag is released, SHALL restore the previous rectangle when Escape cancels a drag, and SHALL disable import while the rectangle exceeds 1 km². Importing SHALL call the API without a payload, show elapsed progress, and then draw the area's map data: roads at their generated width, buildings distinguishing known from unknown heights, blocks, area features, and points of interest, each describable by clicking. Errors SHALL be shown by a sentence chosen by their code; the server's message and OpenStreetMap links appear only when the client's debug flag is on. Importing a rectangle already imported SHALL first warn that re-import reconciles and may delete data.

#### Scenario: A rectangle over the limit
- **WHEN** a user draws a rectangle the server would measure at over 1 km²
- **THEN** the area readout marks it too large and import is disabled

#### Scenario: Moving the rectangle
- **WHEN** a user drags inside the rectangle
- **THEN** the rectangle moves with its width and height unchanged, a label shows its size and area while dragging, and Escape before release puts it back where it was

#### Scenario: Re-importing the same rectangle
- **WHEN** a user imports a rectangle equal to one they imported before
- **THEN** the client asks for confirmation, warning that data OpenStreetMap no longer has will be deleted

### Requirement: The client SHALL trace, save, and scope by boundaries
The map view SHALL let a user trace a shape inside the rectangle by clicking vertices (closing it by clicking the first vertex or double-clicking, cancelling with Escape) or freehand (press, drag, release), drawn distinctly from the import rectangle. It SHALL save the shape as a named boundary of the open area, list the area's saved boundaries, select one, and delete one after confirmation. A shape traced before an import SHALL be saved to the new area right after the import succeeds; if the server rejects it, the import SHALL stand, the rejection SHALL be shown, and the shape SHALL be kept so it can be fixed and saved again. A rejection of kind `invalid_boundary` SHALL be shown as a plain-words sentence chosen by `details.rule`. A scope selector SHALL choose between the whole area and one boundary; the map layers SHALL show the map data of the chosen scope, and the chosen scope SHALL be remembered per area across a reload.

#### Scenario: A self-crossing shape
- **WHEN** a user saves a shape whose edges cross each other
- **THEN** the client shows "The shape crosses itself." and keeps the shape on the map so it can be redrawn

#### Scenario: The scope survives a reload
- **WHEN** a user selects a saved boundary as the scope and reloads the page
- **THEN** the open area comes back scoped to that boundary, and the map layers show only its map data

#### Scenario: Deleting the boundary in scope
- **WHEN** a user deletes the boundary that is the current scope
- **THEN** the scope returns to the whole area and the map layers show the whole area

### Requirement: The client SHALL build a low-poly 3D scene from map-data
The scene view SHALL show the open area, or its selected boundary, as a low-poly 3D world built from `GET /import-areas/{id}/map-data`, in meters from the response's projection origin. It SHALL draw area features and roads (once per two-way road, at `width_meters`) as flat shapes and buildings extruded to their height, and SHALL offer a toggle for the blocks' buildable area, hidden by default. A building's height SHALL be `height_meters` when known, else its levels at 3.2 m each, else a default by category; a height taken from the category default SHALL be visibly marked (a paler material). The scene SHALL reload when the selection changes while it is shown, and SHALL ignore a response that is no longer the latest request.

#### Scenario: A building with no height or levels
- **WHEN** map-data contains a building whose `height_meters` and `levels` are both null
- **THEN** the scene draws it with its category's default height, in the paler material, flagged as defaulted

#### Scenario: Switching boundary while the scene is shown
- **WHEN** the selection changes to another boundary while a previous request is still loading
- **THEN** only the response for the latest selection is drawn

### Requirement: The client SHALL let a user fly over and walk through the scene
The scene view SHALL offer two camera modes with one toggle (a corner button and the `V` key): fly, with orbit, pan, and zoom; and walk, a first-person view at 1.7 m above the ground, moving with WASD or the arrow keys at 1.4 m/s (4 m/s with Shift). Entering walk SHALL place the camera on the road nearest the centre facing north, and returning to fly SHALL restore the previous orbit view. While walking, the camera SHALL NOT pass through a building footprint; a blocked move SHALL slide along the wall where it can.

#### Scenario: Walking into a building
- **WHEN** a user walks toward a building's wall
- **THEN** the camera stops at the wall, and moving along the wall still works

#### Scenario: Switching modes
- **WHEN** a user presses `V` in fly mode and again in walk mode
- **THEN** the camera moves to the road start at eye height, then returns to the previous orbit view

### Requirement: The client SHALL show a route between two picked points
With the scene's "Route" toggle on, the first click on the ground or a road SHALL set the origin and the second the destination; the client SHALL then request a route for the open import area and draw it as a ribbon on the road surfaces, with a green marker at the origin and a red one at the destination. A third click SHALL start over with that click as the new origin, and Escape SHALL clear the route. The strategy picker SHALL list the strategies the server registered, read from the `unknown_routing_strategy` error's `details.registered_strategies`, and send no strategy when that list cannot be read. The result SHALL show the distance and both snap distances, and SHALL warn when a snap distance is over 25 m. Routing errors SHALL be shown by their code.

#### Scenario: A point far from any road
- **WHEN** the route comes back with an origin snap distance of 40 m
- **THEN** the panel shows "Your origin point is 40 m from the nearest road; the route starts there."

#### Scenario: No route between the points
- **WHEN** the server answers `no_route_found`
- **THEN** the panel shows "No route connects these points." and no ribbon is drawn

### Requirement: The client SHALL export the scene as glTF
The scene view SHALL offer a "Download glTF" button, enabled once a world is loaded and while no build is running, that saves the visible world (and nothing else: no lights, route markers, or placeholder) as a binary `.glb` named `gre-<scope type>-<first 8 characters of the scope id>.glb`. The root node's `extras` SHALL carry the scope, the projection origin and meters-per-degree, the axes, and the OpenStreetMap attribution, and the asset's `copyright` SHALL be the attribution. Entity nodes SHALL be named `<layer>:<id>`. The file SHALL pass the Khronos glTF validator with no errors.

#### Scenario: Metadata in the file
- **WHEN** a user downloads the glTF of an open import area
- **THEN** the root node's extras hold the scope and the projection origin, and the asset copyright is "© OpenStreetMap contributors"

#### Scenario: Node names
- **WHEN** the file is opened in a glTF viewer
- **THEN** a building appears as a node named `building:<id>` and a road as `road:<id>`

### Requirement: The client SHALL build an imported place in stages as the server streams them
The client SHALL start an import with `background: true`, switch to the scene view, and reveal each stage as its server-sent event arrives: a waiting animation until `fetched`, then the ground (area features), roads, buildings rising ring by ring from the centre out, and the blocks overlay last. It SHALL ignore an event that repeats or arrives out of order. A completed area that `fetched` names in `inner_area_ids` SHALL be shown fully built at once. A "Skip animation" button SHALL jump every pending step to its final state. While a build plays, the glTF export SHALL be disabled, and the finished area SHALL be loaded from map-data once it ends. A `failed` event SHALL discard the build, return to the map view, and report the event's `code`. Opening an already imported area SHALL show it with no animation.

#### Scenario: Reveal order
- **WHEN** the events `fetched`, `ground`, `roads`, `blocks`, two `buildings` rings and `completed` arrive
- **THEN** the scene reveals the ground, then the roads, then the first ring of buildings, then the second, and finally the blocks overlay

#### Scenario: Skipping the animation
- **WHEN** a user presses "Skip animation" while the build is playing
- **THEN** every pending step, and every step that arrives afterwards, is shown in its final state at once

#### Scenario: Reopening an imported area
- **WHEN** a user opens an already imported area from the list, or loads the page with one open
- **THEN** the scene shows the finished world from map-data with no animation

#### Scenario: A failed import
- **WHEN** a `failed` event arrives mid-build
- **THEN** the partial build is removed, the map view is shown, and the import panel reports the event's `code`

### Requirement: The client SHALL keep each view's state in its URL
The client SHALL be a set of pages behind a history router, with no page load between them: `/` (landing), `/locations`, and `/explore/:areaId`, and a not-found page for any other path. The explore URL SHALL carry the state that defines the view: the area in the path, and in the query `view` (`map`, the default, or `scene`), `scope` (the id of a traced boundary; absent for the whole area), and `at` (`<lat>,<lon>,<zoom>`, five decimals for latitude and longitude and two for zoom, the 2D map's camera). A query parameter that is invalid SHALL be ignored, not reported as an error. A change of area, scope, or view SHALL add a history entry, and a camera move SHALL only rewrite the current entry (debounced), so Back never steps through pans. The browser's Back and Forward SHALL restore the area, scope, and view of the entry. An old `#map` or `#scene` link on `/` SHALL lead to the explore URL of the area last opened in this browser, or to `/locations` when there is none. An explore URL for an area that does not exist SHALL show the not-found page.

#### Scenario: Pasting the URL in a new tab
- **WHEN** a user copies `/explore/<id>?view=scene&scope=<boundary>&at=52.52970,13.40100,15.00` into a new tab
- **THEN** the client opens that area scoped to that boundary on the scene view, and the 2D map, when shown, is centred there at that zoom

#### Scenario: Back restores the previous scope
- **WHEN** a user opens a boundary as the scope and then presses Back
- **THEN** the scope returns to the whole area, on the map and in the scene, and the URL has no `scope`

#### Scenario: Panning does not add history
- **WHEN** a user pans and zooms the 2D map several times
- **THEN** the URL's `at` follows the map and the number of history entries is unchanged

#### Scenario: A legacy hash link
- **WHEN** a user opens `/#scene` with an area remembered from an earlier visit
- **THEN** the client replaces the URL with `/explore/<that area>?view=scene`

### Requirement: The client SHALL open on a landing page that explains the engine
The client SHALL serve a landing page at `/` that says what the engine takes in (an OpenStreetMap rectangle of up to 1 km²), what it produces (streets with lanes and widths, buildable blocks, buildings, and a routable graph), and what it is for. It SHALL draw the pipeline (Overpass, ingestion, PostGIS domain, derivation, HTTP API, this client) as an interactive diagram in which hovering, focusing, or activating a stage shows what the stage produces and links to its documentation, and every stage SHALL be reachable by keyboard. It SHALL show the most recent completed import areas from `GET /import-areas` as cards that open the area, a link to the full locations page, and a primary action to import a new place. The explanation and the diagram SHALL render when the API is unreachable, and the locations block SHALL then show the error reporter's sentence. The layout SHALL fit down to a phone width.

#### Scenario: Reading a stage
- **WHEN** a user tabs to the "Derivation" stage of the diagram
- **THEN** the side card shows what derivation produces and a link to its documentation

#### Scenario: The API is down
- **WHEN** a user opens `/` while the API is unreachable
- **THEN** the explanation and the diagram are shown, and the locations block shows the sentence for `network_error` or `http_error`

#### Scenario: Opening a recent location
- **WHEN** a user selects a recent location's card
- **THEN** the client navigates, with no page load, to `/explore/<that area>`

### Requirement: The client SHALL list import areas with previews and fly to the one opened
The client SHALL show every import area on `/locations` as a card: a preview of its footprint drawn from its map-data (buildings filled, roads stroked at their generated width, area features tinted) on a 2D canvas, its place (the rounded centre of its rectangle), its size, when it was imported, and its counts of buildings, roads, and blocks. Previews SHALL load only when their card nears the viewport, at most three at a time, and SHALL be cached in memory by area id and `imported_at`. Cards SHALL be filterable by text and sortable by most recent or largest. An area whose import did not complete SHALL be shown with its status and no counts, and SHALL NOT be openable. Opening a card SHALL navigate to `/explore/:areaId` and the map SHALL animate there in a zoom-out, pan, zoom-in arc that frames the rectangle, lasting between 1.2 and 3.5 seconds by distance; switching to another area inside the explore page SHALL animate the same way. For a user who prefers reduced motion the map SHALL jump instead. A page that opens directly on an explore URL SHALL jump rather than fly. The gallery's scroll position, filter, and sort SHALL be kept in the browser's history entry, so Back returns to the same spot. The import panel SHALL link to the gallery and show only the open area, rather than listing every area.

#### Scenario: Previews load as cards scroll into view
- **WHEN** the gallery opens with many import areas
- **THEN** only the cards near the viewport request their map-data, three at a time, and a card revisited later draws its cached preview without a request

#### Scenario: Filtering and sorting
- **WHEN** a user types part of a place or a status into the filter, and chooses to sort by size
- **THEN** only the matching cards are shown, largest rectangle first

#### Scenario: An import that did not complete
- **WHEN** an import area is `failed`, `pending`, or `importing`
- **THEN** its card shows that status over an empty footprint, with no counts and no link to the map

#### Scenario: Opening a location
- **WHEN** a user opens a completed area's card
- **THEN** the URL becomes `/explore/<id>` and the map flies there, framing the rectangle, instead of jumping

#### Scenario: Reduced motion
- **WHEN** a user who prefers reduced motion opens a card or switches areas in the explore page
- **THEN** the map jumps to the area with no animation

#### Scenario: Back returns to the same spot
- **WHEN** a user scrolls the gallery, opens a card, and presses Back
- **THEN** the gallery shows the same scroll position, filter, and sort
