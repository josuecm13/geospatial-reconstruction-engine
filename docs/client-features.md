# Client feature map

The list of what the API can do, so the client (Milestone 9 onward) covers all of it and doesn't
ship a weaker version of the backend. The second half is an open brainstorm of UI ideas that go
beyond parity.

## How to maintain this file

- When a PR adds or changes an API capability, add or update its row here in the same PR.
- **API status**: `shipped` (on `main`), `planned` (has an issue or a milestone), or `idea`.
- **Client**: `—` means not built yet, `partial`, or `done`. Update it when client work lands.
- A capability the API has and the client doesn't surface is a gap. It is either built or
  written down here as intentionally out of scope. It never just disappears.

## 1. API capabilities

### Import areas

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Import a bounded area (≤ 1 km × 1 km) from an OSM payload. Re-import reconciles and deletes what the payload omits | `POST /import-areas` | shipped | done | Draw or enter the rectangle, then drag inside to move it, an edge or corner to resize it (pointer events, so touch works; `client/src/importing/rectangleTool.ts`, drag math in `rectangleDrag.ts`). The cursor names each part, a label shows size and area while dragging, the rectangle turns red past 1 km², and Escape restores it. Show the 1 km² limit while drawing. Warn that re-import is destructive |
| List import areas, most recently imported first, with an optional `status` filter and `limit` | `GET /import-areas` | shipped | done | `/locations` (`client/src/pages/locations.ts`, `client/src/locations/`): a card per area (any status) with a footprint preview, filter by text, sort by recent or size, up to 200 areas. The panel links to it and shows only the open area |
| Import status and entity counts (roads, nodes, buildings, POIs, area features, blocks, linked buildings) | `GET /import-areas/{id}` | shipped | — | Handle `pending` / `importing` / `failed`. `map-data` returns 409 `import_area_not_ready` until the import completes |
| Created / updated / removed counts on import | `POST /import-areas` | planned (#6) | — | Show a diff summary after a re-import |
| Skipped turn restrictions on import (`skipped_restriction_count`: malformed or unresolvable in OSM) | `POST /import-areas` | shipped | — | Mention it in the import summary when it isn't zero |
| Live Overpass import: omit `payload` and the box is fetched live | `POST /import-areas` | shipped | done | The main entry point. Takes seconds, so show progress. `upstream_unavailable` (503) means retry later |
| Background import: `background: true` answers 202 with an `events_url`, runs the import in the server, and refuses a second import of the same area (409 `import_in_progress`) | `POST /import-areas` | shipped | done | The staged build animation starts every import this way (`client/src/importing/stagedImport.ts`) |
| Import progress as server-sent events, one per stage (`fetched`, `ground`, `roads`, `blocks`, `buildings` by ring, then `completed` or `failed`), resumable with `Last-Event-ID` | `GET /import-areas/{id}/events` | shipped | done | Draw each stage as it arrives. A `failed` event leaves the area as it was. 404 `import_job_not_found` once a job is gone (kept ten minutes). `fetched` names the completed `inner_area_ids` the import skips: they're already built, so show them at once (their roads come from the `roads` stage); no `buildings` event carries their buildings |

### Map data (`GET /import-areas/{id}/map-data`)

| Layer / property | API status | Client | Client notes |
|---|---|---|---|
| Road segments: geometry, `from_node_id` / `to_node_id`, `distance_meters`, `is_vehicle_accessible` | shipped | partial | 3D: flat strips at `width_meters`; a two-way road is drawn once (`client/src/scene/roadGeometry.ts`). |
| Road cross-section: `lane_count`, `lane_count_provenance` (`tagged` / `defaulted`), `source_lane_count`, `lane_type` (`narrow` / `normal` / `wide`), `width_meters` | shipped | partial | Draw roads at their real width. Show observed vs. defaulted values differently 3D: strip width is `width_meters`, colored by `lane_type`. |
| Street: `name`, `classification` | shipped | — | Labels, and styling by classification |
| Logical street id on segments (`street.id`), stable across unchanged re-imports | shipped | — | Needed to select or highlight a whole street |
| Navigable nodes | shipped | — | Usually hidden. Useful in a debug layer |
| Blocks: boundary polygon, `area_square_meters` | shipped | partial | 3D: not drawn (only the buildable area is). |
| Blocks: `buildable_area` (MultiPolygon or null), `buildable_area_square_meters`, `is_median`, `is_clipped` | shipped | partial | Computed and persisted since M7.2, but `block_feature` exposes only `area_square_meters` 3D: translucent overlay, hidden until "Show buildable area" is ticked. |
| Buildings: footprint, `category`, `block_id`, `height_meters`, `levels` | shipped | partial | `height_meters` / `levels` are as the source stated, null when unknown (M8.1) 3D: extruded to `height_meters`, else `levels` x 3.2 m, else a per-category default drawn paler (`scene/buildingHeight.ts`). |
| POIs: point, `category`, `name` | shipped | — | |
| Area features: polygon, `kind` | shipped | partial | 3D: flat shapes, water blue and the rest green. |
| Composition of nested areas: the completed import areas inside the rectangle (`scope.composed_area_ids`) add their buildings, POIs, area features, and whole blocks; every feature of those layers names its owner in `properties.import_area_id`, and no source id appears twice | shipped | — | Treat the response as one place. The area's counts cover only its own rows |
| `attribution` ("© OpenStreetMap contributors") | shipped | partial | **Required**: must always be visible |

### Spatial queries (whole import area)

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Within a radius: node / POI / building / area feature | `GET …/nearby` | shipped | — | Click and drag a circle |
| Inside a bbox, `intersects` or `contains`: node / building / area feature (no POIs) | `GET …/within-bbox` | shipped | — | Box select. The query box has the same 1 km² limit |
| Nearest node / segment to a coordinate | `GET …/nearest` | shipped | — | Snap to the network on hover |
| Nearest segment with its full cross-section | `GET …/nearest` | planned (#36) | — | Today `lane_count` can differ from what `map-data` returns for the same segment |
| Building footprint area (m²) | `GET …/buildings/{id}/footprint-area` | shipped | — | Building inspector |

### Routing

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Route A → B: nodes, segments, geometry, total distance | `POST …/routes` | shipped | shipped: Scene tab, Route toggle and two clicks (`client/src/scene/routePanel.ts`, `routeLayer.ts`) | |
| Named strategy (today only `distance`, the default). An unknown name returns the registered list | `POST …/routes` | shipped | shipped: picker read from `GET /routing-strategies` (`ApiClient.routingStrategies`) | |
| List registered strategies and the default | `GET /routing-strategies` | shipped | done | The route picker |
| Snap info: origin and destination node, and snap distance | `POST …/routes` | shipped | shipped: snap distances shown, warning over 25 m (`routePicking.ts`) | Show the snap offset. Warn when it's large |
| Turn restrictions honored | shipped (implicit) | — | Explain a detour ("no left turn here") |

### Traced boundaries and export (Milestone 8, #21, complete)

| Capability | API status | Client | Client notes |
|---|---|---|---|
| Create / list / fetch / delete named traced boundaries within the import rectangle: `POST`/`GET …/boundaries`, `GET`/`DELETE …/boundaries/{id}`. Returned as GeoJSON `Feature`s (list as a `FeatureCollection`) with `name`, `import_area_id`, `created_at` | shipped | done | The panel's Boundaries section (`client/src/boundaries/`): trace by vertices or freehand, name and save, list, select, delete. A shape traced before an import is saved when the import succeeds. On 422 `invalid_boundary` the sentence for `details.rule` is shown. A single ring, no holes. Feature popups pause while tracing |
| Scope `nearby` / `within-bbox` / `nearest` to a boundary: optional `boundary_id` query parameter; entities that intersect the boundary. `footprint-area` stays unscoped | shipped | done | The panel's scope selector ("Whole area" or one boundary), kept in `SelectionStore` and remembered per area. The map layers reload for the scope; the 3D scene follows in its own brief. A deleted boundary (404 `boundary_not_found`) falls back to the whole area |
| Export a scope in filter mode: `map-data?boundary_id=…` (whole entities intersecting it, plus every endpoint node of its segments, so still routable). The response states `scope` (`{type: import_area|boundary, id}`) and `mode` | shipped | — | |
| Export a scope in clip mode: `map-data?mode=clip` (with or without `boundary_id`). Geometry and blocks' `buildable_area` are cut at the scope; multi-part cuts are `Multi*` geometries; entities only touching the edge are omitted; no extra end nodes; distances and areas describe the whole entity | shipped | — | Label clip mode as "not routable". Handle `MultiLineString`/`MultiPolygon` |
| Local projection metadata on every `map-data` response: `projection.origin` (the scope's centroid) and `meters_per_degree_latitude` / `_longitude`, on the same sphere as `distance_meters` | shipped | — | For a Cartesian or 3D renderer (Three.js) |

### The client's pages and URLs (Milestone 9, #101)

| Capability | API status | Client | Client notes |
|---|---|---|---|
| Pages behind a history router: `/` landing, `/locations`, `/explore/:areaId`, `/explore` (the map with nothing open, for a first import), not found | n/a | done | `client/src/routing/` (`routes.ts` codec, `router.ts`, `store.ts`) and `client/src/pages/`. The landing page (#102, below) and `/locations` (#103) are built |
| Landing page at `/`: what the engine is, the pipeline as an interactive SVG diagram (hover, focus or tap a stage for what it produces and a doc link), the six most recent completed areas from `GET /import-areas`, "See all locations", and "Import a new place" | shipped | done | `client/src/pages/landing.ts`, `client/src/landing/` (`architectureModel.ts` is the stage data, `architecture.ts` draws it). Renders without the API: the locations block then shows the error reporter's sentence. "Import a new place" opens the map on the last-opened (else most recent) area, or on `/explore` with nothing open when there is none. The recent places use the gallery's cards (`locations/card.ts`) |
| View state in the URL: `view`, `scope`, and the 2D map's `at=<lat>,<lon>,<zoom>`; Back and Forward restore area, scope and view; camera moves rewrite the entry. Old `#map` / `#scene` links redirect | n/a | done | `client/src/pages/explore.ts` keeps the `SelectionStore` and the route in step. The scene camera is not in the URL |
| Footprint previews of every import area, drawn from `map-data` on a 2D canvas (lazy, three at a time, cached by id and `imported_at`), and an animated fly-to when an area is opened from the gallery or switched to inside explore (reduced motion jumps) | `GET /import-areas/{id}/map-data` | done | `client/src/locations/` (`preview.ts`, `previewTransform.ts`, `flyTo.ts`, `cardModel.ts`, `card.ts` for the card the landing page can reuse). A page opened directly on an explore URL jumps, not flies |

### Later milestones (planned)

| Capability | Milestone | Client notes |
|---|---|---|
| Generated block content: seeded, reproducible, with provenance | M11 | Toggle between raw, generated, and both. Seed control. Marker for stale runs |
| Export layer selection: raw / generated / both | M11 | |
| Asset identifiers for POIs and generated buildings, with a fallback chain | M12 | The client maps identifiers to models and materials |

### Error contract (every endpoint)

Every non-2xx response is `{"error": {"code", "message", "details"}}`. The client should switch on
`code`, not on the HTTP status: `invalid_request`, `invalid_bounding_box`, `invalid_coordinate`,
`payload_outside_bounding_box`, `ingestion_failed`, `source_incomplete` (the source response was
truncated and nothing was changed), `upstream_unavailable` (Overpass unreachable or busy), `import_area_not_found`, `import_area_not_ready`, `import_conflict`, `building_not_found`, `invalid_boundary` (with
`details.rule`), `boundary_name_conflict`, `boundary_not_found`, `invalid_spatial_query`,
`import_in_progress`, `import_job_not_found`, `no_navigable_node`, `no_route_found`, `unknown_routing_strategy`, `not_found`,
`method_not_allowed`, `database_unavailable`, `configuration_error`, `internal_error`.

Every view reports failures through `useErrorReporter` (`client/src/errors/errorReporter.ts`): a sentence
per code, never the raw message. Flip `DEBUG_ERRORS` in that file while debugging to also show the
server's message and links to the OSM elements it names, for `ingestion_failed`,
`payload_outside_bounding_box` (whose `details` carry `source_ids` and typed `source_refs` such as
`way/123`) and `source_incomplete`.

## 2. UI brainstorm

Ideas, not commitments. Once one is chosen, it becomes an issue in the milestone it belongs to.

### Exploring the reconstruction
- **Observed vs. generated lens**: one switch that colors every value by provenance (tagged,
  defaulted, inferred, generated). The project's core idea is "OSM is hints", and this makes it
  visible.
- **Road cross-section inspector**: click a segment to see a drawn cross-section (lanes, lane
  type, width) with the provenance of each value.
- **Block inspector**: boundary vs. buildable area, median and edge flags, the buildings it
  contains, and the streets that bound it.
- **Real-width roads**: draw road polygons from `width_meters` instead of 1 px lines, so the map
  reads like a floor plan.
- **Debug layers**: navigable nodes, turn movements at an intersection, and segment direction
  arrows.

### Scopes and boundaries
- **Side-by-side scopes**: split view comparing the full import area with a traced boundary, or
  two boundaries with each other.
- **Snap-to-street tracing**: vertices snap to road centerlines or block edges, so a neighborhood
  can be traced in a few clicks.
- **Boundary library**: named cuts per area, with thumbnails, per-scope counts, and rename or
  duplicate.

### Routing
- **Drag-to-reroute**: move the origin or destination and recalculate live.
- **Route explanation**: list the streets taken, and mark restrictions that forced a detour.
- **Strategy comparison**: overlay the routes from several strategies once more exist.

### Import and data lifecycle
- **Staged build** (#67, shipped): importing switches to the Scene tab and builds the place as the
  server streams it: a turning wireframe of the rectangle while Overpass answers, then the ground, the
  roads, buildings rising ring by ring from the centre out, and the blocks overlay last. Inner areas
  the server skipped are shown built at once. "Skip animation" jumps to the end, and the glTF button
  waits for the build. The finished area then replaces the build, loaded from map-data; a camera moved
  during the build is kept (#112), otherwise the overview is shown. Reopening an
  area shows no animation (`scene/stagedBuild.ts`, `scene/stagedScene.ts`, `scene/buildAnimation.ts`).
- **Re-import diff**: created / updated / removed shown in color on the map (depends on #6).
- **Import history** per area, with when it happened, the counts, and what changed.
- **Data health panel**: roads dropped for unmapped classes, failed restrictions, and the
  share of defaulted values.

### 3D and export
- **3D mode**: extruded footprints (M8.1 heights, with a clear placeholder when height is
  unknown), roads at real width, and blocks as terrain.
- **Fly and walk** (#66, shipped): the scene opens in fly mode (orbit, pan, zoom). A "Walk" button
  in its corner, or the `V` key, drops the camera to eye height (1.7 m) on the road nearest the
  centre, facing north; click the canvas to look around, WASD or the arrows to move (Shift runs),
  Esc releases the mouse. Building footprints stop the walker (`scene/collision.ts`, `scene/cameraModes.ts`).
- **Turntable rotation** (#119, shipped): in fly mode the scene turns slowly around the open area. It
  stops while the user drags or zooms, in walk mode and during a staged build, and resumes after five
  idle seconds. A "Rotate" button turns it on and off; it starts off under `prefers-reduced-motion`
  (`scene/autoRotate.ts`).
- **glTF export** (#69, shipped): a "Download glTF" button in the scene's corner saves the world as a
  binary `.glb` (`gre-<scope type>-<id>.glb`). Nodes are named `<layer>:<id>`; the root's extras carry
  the scope, projection origin, and axes, and the asset copyright is the OpenStreetMap attribution.
  Hidden layers (buildable area, unless shown) are left out (`scene/exportGltf.ts`, `scene/exportButton.ts`).
- **Generation playground** (M11): change the seed or density and watch the block repopulate.
  Pin a seed you like.
- **Export panel**: pick the scope, mode (filter / clip), and layers, and download GeoJSON with
  the projection metadata.

### General polish
- Shareable URL state: area, scope, view and the 2D camera are in the URL (#101); the selection and the 3D camera are not.
- Keyboard shortcuts and a command palette.
- Offline cache of the last loaded area.
