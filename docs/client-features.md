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
| Import a bounded area (≤ 10 km²) from an OSM payload. Re-import reconciles and deletes what the payload omits | `POST /import-areas` | shipped | done | Draw the rectangle, then drag inside to move it, an edge or corner to resize it (pointer events, so touch works; `client/src/importing/rectangleTool.ts`, drag math in `rectangleDrag.ts`). The cursor names each part, a label shows size and area while dragging, the rectangle turns red past 10 km², and Escape restores it. The area readout shows the 10 km² limit; re-importing warns that it is destructive |
| List import areas, most recently imported first, with an optional `status` filter and `limit` | `GET /import-areas` | shipped | done | `/locations` (`client/src/pages/locations.ts`, `client/src/locations/`): a card per area (any status) with a footprint preview, filter by text, sort by recent or size, up to 200 areas. The panel links to it and shows only the open area |
| Delete an import area and its imported data: 204, 404 `import_area_not_found`, 409 `import_in_progress`, or 409 `import_area_in_use` (`details.covering_areas`: `{ id, name }`, name may be null; nothing deleted) | `DELETE /import-areas/{id}` | shipped | done | A quiet "Delete" button on each `/locations` card (`client/src/locations/card.ts`, `pages/locations.ts`; the landing page's cards stay read-only). It confirms first, then removes the card without a reload. A refusal names the larger places to delete first (`locations/deleteMessage.ts`); a 404 drops the card |
| Read and choose the import area the landing page features: `{ "import_area_id": uuid \| null }`. PUT: 404 `import_area_not_found`, 409 `import_area_not_ready` (only a completed area can be featured), null clears. Deleting the featured area clears it | `GET /settings/featured-area`, `PUT /settings/featured-area` | shipped (#23) | done | A completed `/locations` card shows "Show on landing"; the featured one shows a "Featured" badge and "Remove from landing", and the gallery updates without a reload (`client/src/locations/card.ts`, `pages/locations.ts`). The landing page reads the setting first, then `VITE_FEATURED_AREA_ID`, then the most recent completed area (`landing/featured.ts`); a failed settings request falls through to the next source |
| Import status and entity counts (roads, nodes, buildings, POIs, area features, blocks, linked buildings) | `GET /import-areas/{id}` | shipped | partial | Counts after an import (roads, buildings, blocks, POIs, area features) and on location cards (buildings, roads, blocks); cards show `pending` / `importing` / `failed`. Node and linked-building counts aren't shown. `map-data` returns 409 `import_area_not_ready` until the import completes |
| Created / updated / removed counts on import | `POST /import-areas` | planned (#6) | — | Show a diff summary after a re-import |
| Skipped turn restrictions on import (`skipped_restriction_count`: malformed or unresolvable in OSM) | `POST /import-areas` | shipped | — | Mention it in the import summary when it isn't zero |
| Skipped building and area ways on import (`skipped_feature_count`: not a closed ring in OSM) | `POST /import-areas` | shipped | — | Mention it in the import summary when it isn't zero |
| Live Overpass import: omit `payload` and the box is fetched live | `POST /import-areas` | shipped | done | The main entry point. Takes seconds, so show progress. `upstream_unavailable` (503) means retry later |
| Background import: `background: true` answers 202 with an `events_url`, runs the import in the server, and refuses a second import of the same area (409 `import_in_progress`) | `POST /import-areas` | shipped | done | The staged build animation starts every import this way (`client/src/importing/stagedImport.ts`) |
| Import progress as server-sent events, one per stage (`fetched`, `ground`, `roads`, `blocks`, `buildings` by ring, `elevation`, then `completed` or `failed`), resumable with `Last-Event-ID` | `GET /import-areas/{id}/events` | shipped | done | Draw each stage as it arrives. A `failed` event leaves the area as it was. 404 `import_job_not_found` once a job is gone (kept ten minutes). `fetched` names the completed `inner_area_ids` the import skips: they're already built, so show them at once (their roads come from the `roads` stage); no `buildings` event carries their buildings. The `elevation` stage (`{projection, elevation, error}`) draws nothing: the finished world is loaded from map-data, on terrain (`scene/stagedBuild.ts`) |
| Elevation stage of an import: after `buildings` and before `completed`, `elevation` carries `projection`, the map-data `elevation` object (or null), and `error` (`elevation_unavailable` when the terrain source failed, `elevation_failed` on any other error; the import still completes, flat) | `GET /import-areas/{id}/events` | shipped | done | Draw the terrain when it arrives; flat until then. `IMPORT_STAGES` gains `elevation` |
| Re-analyse an area's terrain in the background (no OSM fetch, no id or geometry changes, idempotent): 202 with an `events_url` that streams one `elevation` event, then `completed` or `failed` (`elevation_unavailable`); 404 `import_area_not_found`, 409 `import_area_not_ready`, 409 `import_in_progress` | `POST /import-areas/{id}/elevation` | shipped | done | A quiet "Add terrain" button in the scene's corner, shown when a loaded area has `elevation: null`. It follows the events, shows progress, reloads map-data and rebuilds the world on `completed`, and shows a sentence per error code on `failed` (`scene/terrainControls.ts`, `terrainJob.ts`, `terrainMessages.ts`) |
| Generate an area's buildings in the background: optional body `{"seed": int}` (default: the current run's seed, else 1); 202 with an `events_url` that streams one `generation` event (`{block_count}`, the eligible blocks), then zero or more `generated` events (`{projection, ring, blocks_done, block_count, buildings}`: one per 150 m ring of blocks around the area's centre, nearest first, with `buildings` a FeatureCollection shaped like map-data's `generated_buildings` and carrying the ids they will keep; a ring of more than 500 buildings is split over several events with the same `ring`; `blocks_done` counts eligible blocks processed), then `completed` (`{run}`) or `failed` (streamed buildings are provisional: on `failed` the previous run stays and the client discards them); 404 `import_area_not_found`, 409 `import_area_not_ready`, 409 `import_in_progress`. Replaces the area's run in one transaction and changes no observed entity | `POST /import-areas/{id}/generation` | shipped (#23) | done | A **Generate** button in the scene's corner (**Regenerate** once the area has a run, in the warning colour when the run is stale, with a tooltip listing why). Generate lets the server pick the seed; Regenerate sends `Math.floor(Math.random() * 2**31)`. It follows the events with a progress line (`Generating… n of N blocks`), and **the buildings stream in as they are generated**: each `generated` event (a ring of blocks, nearest the area's centre first, at most 500 buildings per event) adds its buildings to the `generated` group and to the 2D generated layer, rising block by block on an accelerating schedule like the import's staged build: block *i* of *N* starts at `(5 s - rise) * sqrt(i/N)` from the `generation` event, so a couple of blocks appear in the first second, about ten more in the next, then more and more, the last building landing at about 5 s; all of a block's buildings rise together, and a block whose buildings arrive after its slot rises on arrival (`scene/revealQueue.ts`, `revealSchedule.ts`). A **Skip animation** button shows while the reveal plays and finishes it at once. Everything is instant under reduced motion; "Show generated" is ticked as soon as the first arrives, a Regenerate clears the previous run's buildings on its `generation` event, and a duplicate id is skipped. Streamed buildings are provisional: on `completed` map-data is reloaded and the world rebuilt from the stored run, after the reveal has finished (or been skipped) so the reload never cuts it short (at once under reduced motion); on `failed` they are removed, the stored run is loaded again, and a sentence per error code is shown (`scene/generationControls.ts`, `generationJob.ts`, `generationStream.ts`, `generationMessages.ts`) |
| Read the area's current run: `run_id`, `seed`, `algorithm_version`, `created_at`, `building_count`, `block_count`, `eligible_block_count`, `stale`, `stale_reasons` (`roads_changed` / `terrain_changed`), `feedback_shortfall_block_ids`, `calibration_ratio`; 404 `generation_not_found` | `GET /import-areas/{id}/generation` | shipped (#23) | partial | The run arrives inside map-data (`generation`), so the client doesn't call `GET`; `ApiClient.generation` and `deleteGeneration` exist and are tested but no control uses them. `feedback_shortfall_block_ids` and `calibration_ratio` aren't shown |
| Delete the area's run and its generated buildings and zones: 204, 404 `generation_not_found`, 409 `import_in_progress` while a job of the area runs | `DELETE /import-areas/{id}/generation` | shipped (#23) | — | Not surfaced yet: a run is replaced by Regenerate |
| Say how many buildings a block really has (`{"building_count": n >= 0}`) or that it has none (`{"no_buildings": true}`); exactly one, else 422 `invalid_request`; 404 `block_not_found`. Applies on the next generation | `PUT /blocks/{block_id}/feedback` | shipped (#23) | partial | Selecting a block (2D click, or 3D click with "Show blocks" on) opens a panel with **Actual number of buildings** (a number and Save), **No buildings here** and **Clear feedback**; it updates from the response and says "Applies on the next Generate" (`scene/blockPanel.ts`, `blockInfo.ts`). The client doesn't list an area's feedback (`ApiClient.areaFeedback` exists, unused), so orphaned feedback isn't surfaced |
| Clear a block's feedback: 204, or 404 `feedback_not_found` | `DELETE /blocks/{block_id}/feedback` | shipped (#23) | partial | "Clear feedback" in the block panel |
| List the area's feedback as `{"feedback": [...]}`, each entry `block_id`, `import_area_id`, `building_count`, `no_buildings`, `updated_at` and `orphaned` (its block no longer exists) | `GET /import-areas/{id}/feedback` | shipped (#23) | — | Not surfaced yet: orphaned feedback isn't shown |

### Map data (`GET /import-areas/{id}/map-data`)

| Layer / property | API status | Client | Client notes |
|---|---|---|---|
| Road segments: geometry, `from_node_id` / `to_node_id`, `distance_meters`, `is_vehicle_accessible` | shipped | partial | 2D: lines at the generated width, described on click with length. 3D: flat strips at `width_meters`, drawn once per two-way road. `from_node_id` / `to_node_id` and `is_vehicle_accessible` aren't shown. |
| Road cross-section: `lane_count`, `lane_count_provenance` (`tagged` / `defaulted`), `source_lane_count`, `lane_type` (`narrow` / `normal` / `wide`), `width_meters` | shipped | partial | 2D: width and `lane_type` color; the popup shows `lane_count` with its provenance and the lane type. 3D: strip width and `lane_type` color. `source_lane_count` isn't shown. |
| Street: `name`, `classification` | shipped | partial | Name and class in the 2D road popup; no labels, no styling by class. |
| Logical street id on segments (`street.id`), stable across unchanged re-imports | shipped | partial | Used to draw a two-way road once in 3D (`buildWorld.ts`); a whole street can't be selected yet. |
| Navigable nodes | shipped | — | Usually hidden. Useful in a debug layer |
| Blocks: boundary polygon, `area_square_meters` | shipped | done | 2D: filled from the boundary (eligible blocks only; median blocks darker), with a dashed outline 1.5 m inside it. 3D: the same inset dashed outline, draped on the terrain (`scene/blockOutline.ts`, `buildWorld.ts`), shown with "Show blocks". |
| Blocks: `buildable_area` (MultiPolygon or null), `buildable_area_square_meters`, `is_median`, `is_clipped` | shipped | done | 2D popup: buildable m², median, clipped. 3D: the translucent buildable-area fill, for eligible blocks only (the others keep just their faint outline, and stay selectable by point-in-polygon), kept under the outlines (faint) and shown with "Show blocks" (it replaces "Show buildable area") |
| Buildings: footprint, `category`, `block_id`, `height_meters`, `levels` | shipped | done | 2D: solid when `height_meters` is known, paler when null; the popup shows height, levels, category and whether it's in a block. 3D: extruded to `height_meters`, else `levels` x 3.2 m, else a per-category default drawn paler (`scene/buildingHeight.ts`). |
| POIs: point, `category`, `name` | shipped | partial | 2D circles described by name and category; not drawn in 3D. |
| Area features: polygon, `kind` (`water`, `park`, `forest`, `farmland`, `cemetery`, `railway`, `industrial`) | shipped | done | 2D fill and 3D flat shapes: water blue, park green, forest a deeper green, farmland olive, cemetery a muted green-grey, railway and industrial neutral greys; an unknown kind draws as park green. Described by kind in 2D |
| Elevation: `elevation` is null (no grid yet) or `{source, attribution, version, smoothing_meters, grid}`; `grid` is the area's whole ground (origin at the SW corner, `lat_step` / `lon_step`, `rows` x `cols` heights in metres, row-major south to north, west to east) | shipped | done | 3D: `scene/terrain.ts` samples it bilinearly. The ground is a mesh on the grid, flat layers (area features, buildable areas, roads, the route ribbon) are cut along the grid's own lines (`scene/gridCut.ts`) and draped on it, and every y is relative to the grid's lowest point so the world stays near y = 0. Null draws flat (`flatTerrain`). The 2D map doesn't use it. The glTF root extras carry `elevation.version` and the road mode |
| Buildings: `base_elevation_meters` (the lowest ground under the footprint, or null) | shipped | done | 3D: the building stands on it (its height and extrusion unchanged); when null, on the lowest ground under the footprint from the grid |
| Block generation fields: `eligibility` (`eligible` / `clipped` / `median` / `no_buildable_area`), `real_building_count`, `generated_building_count`, `is_reference`, `reference_block_id`, `style` (null without a run), `feedback` | shipped (#23) | done | Outlines: crisp dashes for `eligible`, a longer dash and its own colour for a reference block, faint dots for the other three, solid and highlighted when selected. The block panel reads `Block · real: N · generated: M · reference: <short id or defaults> · style: …` and, for a block that isn't eligible, why |
| `generated_buildings`: a FeatureCollection of footprints (`block_id`, `style`, `levels`, `height_meters`, `base_elevation_meters`, `reference_block_id`, `count_source`: `reference` / `default` / `feedback`, `generated: true`), composed from the owner areas like `buildings` and following the scope | shipped (#23) | done | 3D: extruded to `height_meters` in the `generated` world group, in a cool blue apart from measured and defaulted buildings, standing on `base_elevation_meters` like real ones; toggled by "Show generated" (on by default when a run exists; ticking it makes the buildings rise block by block from the area's centre outward on the same accelerating schedule over about 5 s (with Skip animation), `scene/revealSchedule.ts`, and unticking hides them at once, cancelling a reveal in progress; both are instant under reduced motion, and a job in progress takes precedence over the toggle's animation). 2D: a layer in the same colour, with a popup saying "Generated · from block <id>", "· defaults" or "· from your count". The 3D scene has no building popup yet, so the origin line is 2D only |
| `generation_zones`: a FeatureCollection of where the run kept buildings off (`block_id`, `reason`: `water` / `steep` / `landuse` / `setback`), from the area's own run | shipped (#23) | done | Shaded by reason at low opacity with "Show blocks" on (draped like the area features in 3D, filled in 2D), with a small legend listing the reasons present (`scene/zoneLegend.ts`) |
| `generation`: the area's current run, or null | shipped (#23) | done | Decides Generate or Regenerate, and whether Regenerate is emphasised (`stale`, `stale_reasons`) |
| Road segments: `elevation_exact` and `elevation_smoothed`, one height per vertex of the geometry (or null) | shipped | done | 3D: the road outline is draped on the mode's heights, each outline vertex taking the height at its nearest point on the centreline. A "Smooth roads" checkbox (on by default, shown only with terrain) switches the modes in place without a rebuild (`setRoadMode`) |
| Generation: `generation` is the area's current run object (as above, with `stale` computed) or null | shipped (#23) | — | Planned |
| Generated buildings: `generated_buildings`, a FeatureCollection of polygons with `block_id`, `style`, `levels`, `height_meters`, `base_elevation_meters`, `reference_block_id`, `count_source` (`reference` / `default` / `feedback`), `generated: true` and `import_area_id`. Composed from the area's own run and its inner areas', scoped and clipped like buildings; empty without a run | shipped (#23) | — | Planned: drawn in their own colour, toggled by "Show generated" |
| Generation zones: `generation_zones`, a FeatureCollection of the area's own run with `block_id` and `reason` (`water` / `steep` / `landuse` / `setback`), scoped and clipped like the other layers; empty without a run | shipped (#23) | — | Planned: shaded by reason with "Show blocks" |
| Block generation properties: `eligibility` (`eligible` / `clipped` / `median` / `no_buildable_area`), `real_building_count`, `generated_building_count` (0 without a run), `is_reference`, `reference_block_id`, `style` (null without a run), `feedback` (`{building_count, no_buildings, updated_at}` or null) | shipped (#23) | — | Planned: the dashed block outline and the block panel |
| Composition of nested areas: the completed import areas inside the rectangle (`scope.composed_area_ids`) add their buildings, POIs, area features, and whole blocks; every feature of those layers names its owner in `properties.import_area_id`, no source id appears twice, and no block appears twice | shipped | done | Both views draw the composed response as one place; a staged import shows the inner areas built at once. A feature's owning area isn't displayed. |
| `attribution` ("© OpenStreetMap contributors") | shipped | partial | 2D: always visible, uncollapsed. glTF: the asset copyright and root extras. **The 3D scene shows none on screen**, which is the gap. |

### Spatial queries (whole import area)

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Within a radius: node / POI / building / area feature. POIs, buildings and area features compose inner areas like `map-data` | `GET …/nearby` | shipped | — | Click and drag a circle |
| Inside a bbox, `intersects` or `contains`: node / building / area feature (no POIs). Buildings and area features compose inner areas like `map-data` | `GET …/within-bbox` | shipped | — | Box select. The query box has the same 10 km² limit |
| Nearest node / segment to a coordinate | `GET …/nearest` | shipped | — | Snap to the network on hover |
| Nearest segment with its full cross-section | `GET …/nearest` | planned (#36) | — | Today `lane_count` can differ from what `map-data` returns for the same segment |
| Building footprint area (m²), for every building id `map-data` returns, inner areas' included | `GET …/buildings/{id}/footprint-area` | shipped | — | Building inspector |

### Routing

| Capability | Endpoint | API status | Client | Client notes |
|---|---|---|---|---|
| Route A → B: nodes, segments, geometry, total distance | `POST …/routes` | shipped | done | Scene tab, Route toggle and two clicks (`client/src/scene/routePanel.ts`, `routeLayer.ts`) |
| Named strategy (today only `distance`, the default). An unknown name returns the registered list | `POST …/routes` | shipped | done | The picker is read from `GET /routing-strategies` |
| List registered strategies and the default | `GET /routing-strategies` | shipped | done | The route picker |
| Snap info: origin and destination node, and snap distance | `POST …/routes` | shipped | shipped: snap distances shown, warning over 25 m (`routePicking.ts`) | Show the snap offset. Warn when it's large |
| Turn restrictions honored | shipped (implicit) | — | Explain a detour ("no left turn here") |

### Traced boundaries and export (Milestone 8, #21, complete)

| Capability | API status | Client | Client notes |
|---|---|---|---|
| Create / list / fetch / delete named traced boundaries within the import rectangle: `POST`/`GET …/boundaries`, `GET`/`DELETE …/boundaries/{id}`. Returned as GeoJSON `Feature`s (list as a `FeatureCollection`) with `name`, `import_area_id`, `created_at` | shipped | done | The panel's Boundaries section (`client/src/boundaries/`): trace by vertices or freehand, name and save, list, select, delete. A shape traced before an import is saved when the import succeeds. On 422 `invalid_boundary` the sentence for `details.rule` is shown. A single ring, no holes. Feature popups pause while tracing |
| Scope `nearby` / `within-bbox` / `nearest` to a boundary: optional `boundary_id` query parameter; entities that intersect the boundary. `footprint-area` stays unscoped | shipped | done | The panel's scope selector ("Whole area" or one boundary), kept in `SelectionStore` and remembered per area. The map layers reload for the scope; the 3D scene loads the same scope (`SceneLoader`). A deleted boundary (404 `boundary_not_found`) falls back to the whole area |
| Export a scope in filter mode: `map-data?boundary_id=…` (whole entities intersecting it, plus every endpoint node of its segments, so still routable). The response states `scope` (`{type: import_area|boundary, id}`) and `mode` | shipped | partial | Both views load `map-data?boundary_id=…` for the selected boundary, and the glTF file is named by `scope`; there's no GeoJSON download. |
| Export a scope in clip mode: `map-data?mode=clip` (with or without `boundary_id`). Geometry and blocks' `buildable_area` are cut at the scope; multi-part cuts are `Multi*` geometries; entities only touching the edge are omitted; no extra end nodes; distances and areas describe the whole entity | shipped | — | Label clip mode as "not routable". Handle `MultiLineString`/`MultiPolygon` |
| Local projection metadata on every `map-data` response: `projection.origin` (the scope's centroid) and `meters_per_degree_latitude` / `_longitude`, on the same sphere as `distance_meters` | shipped | done | The 3D scene builds in local meters from `projection` (`scene/projection.ts`), and the glTF root extras carry it. |

### The client's pages and URLs (Milestone 9, #101)

| Capability | API status | Client | Client notes |
|---|---|---|---|
| Pages behind a history router: `/` landing, `/locations`, `/explore/:areaId`, `/explore` (the map with nothing open, for a first import), not found | n/a | done | `client/src/routing/` (`routes.ts` codec, `router.ts`, `store.ts`) and `client/src/pages/`. The landing page (#102, below) and `/locations` (#103) are built |
| Landing page at `/` as a journey around a featured place (the area chosen on the Locations page, else `VITE_FEATURED_AREA_ID` when set and completed, else the most recent completed area): a hero naming it (place name and context, else its centre) with "Explore this place" (its 3D scene) and "Rebuild your own"; a scroll story ("How a place is rebuilt": map, streets, blocks, buildings, generated context) beside a sticky 3D stage that builds up as each step crosses the middle of the viewport; the last step raises the generated buildings in their own colour on top of the finished place, and the hero shows them too, while a place with no generation run keeps the step but nothing rises, the step says "This place hasn't been generated yet: open it and press Generate." (linking to its explore route), and the hero shows the buildings step; three tiles on what to do in the scene (Walk, route, Download glTF); the six most recent areas as the gallery's cards with "See all locations"; a "Rebuild your own place" call to action; and "Under the hood" (the pipeline as an interactive SVG diagram, and what goes in, comes out and is for). With no completed area the hero is the invitation to import | shipped | done | `client/src/pages/landing.ts`, `client/src/landing/` (`storySteps.ts` is the step and layer logic, `featuredStage.ts` the one shared WebGL stage, loaded by dynamic `import()` after first paint and turning slowly; `architectureModel.ts` is the pipeline data, `architecture.ts` draws it). The stage and the story fall back to the 2D footprint preview when WebGL or the map data is unavailable; reduced motion turns off the turntable and the fades. The scene view has no URL parameter for walk or route, so the tiles name the control to press. Renders without the API: the hero then shows the error reporter's sentence. "Rebuild your own" opens the map on the last-opened (else most recent) area, or on `/explore` with nothing open when there is none |
| View state in the URL: `view`, `scope`, and the 2D map's `at=<lat>,<lon>,<zoom>`; Back and Forward restore area, scope and view; camera moves rewrite the entry. Old `#map` / `#scene` links redirect | n/a | done | `client/src/pages/explore.ts` keeps the `SelectionStore` and the route in step. The scene camera is not in the URL |
| Footprint previews of every import area, drawn from `map-data` on a 2D canvas (lazy, three at a time, cached by id and `imported_at`), and an animated fly-to when an area is opened from the gallery or switched to inside explore (reduced motion jumps) | `GET /import-areas/{id}/map-data` | done | `client/src/locations/` (`preview.ts`, `previewTransform.ts`, `flyTo.ts`, `cardModel.ts`, `card.ts` for the card the landing page can reuse). A page opened directly on an explore URL jumps, not flies |

### Later milestones (planned)

| Capability | Milestone | Client notes |
|---|---|---|
| Export layer selection: raw / generated / both | M11 | The glTF export includes the generated buildings only while "Show generated" is on (`onlyVisible`); there is no separate picker, and GeoJSON export isn't in the client |
| Asset identifiers for POIs and generated buildings, with a fallback chain | M12 | The client maps identifiers to models and materials |

### Error contract (every endpoint)

Every non-2xx response is `{"error": {"code", "message", "details"}}`. The client should switch on
`code`, not on the HTTP status: `invalid_request`, `invalid_bounding_box`, `invalid_coordinate`,
`payload_outside_bounding_box`, `ingestion_failed`, `source_incomplete` (the source response was
truncated and nothing was changed), `upstream_unavailable` (Overpass unreachable or busy), `import_area_not_found`, `import_area_not_ready`, `import_conflict`, `building_not_found`, `invalid_boundary` (with
`details.rule`), `boundary_name_conflict`, `boundary_not_found`, `invalid_spatial_query`,
`import_in_progress`, `import_job_not_found`, `generation_not_found`, `block_not_found`, `feedback_not_found`, `elevation_unavailable` (the terrain source is unreachable; the import itself still completes, flat), `no_navigable_node`, `no_route_found`, `unknown_routing_strategy`, `not_found`,
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
- **Real-width roads** (shipped with the rectangle picker, #63): draw road polygons from `width_meters` instead of 1 px lines, so the map
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
- **Shading** (#129): the scene has no lights. `scene/shading.ts` computes each face's shade from its
  normal and a fixed light direction (`AMBIENT + (1 - AMBIENT) * max(0, n . LIGHT_DIRECTION)`), bakes
  it into vertex colours, and the materials in `scene/palette.ts` (the only source of scene colours)
  are unlit, so the glTF export (`KHR_materials_unlit`, `COLOR_0`) looks the same as the viewer.
- **Dark theme** (#133): the interface, the 3D scene (night clay, pale edge lines on buildings that the glTF export leaves out) and the 2D map (OpenFreeMap's dark basemap) are dark; `style.css` takes every colour from its `:root` tokens (a test enforces it and 4.5:1 text contrast), and `views/mapColors.ts` holds the 2D overlay colours.
- **Look and motion** (#133): Inter for type, frosted-glass overlays and a header that frosts as the page scrolls.
  Landing and locations reveal their sections and cards as they scroll into view (CSS scroll-driven
  animations, no script), the primary button has a spinning accent ring, and cards follow the cursor with a
  soft spotlight (`ui/spotlight.ts`). Page changes run inside a View Transition (`pages/host.ts`): the page
  slides slightly forward or back by how the router got there, and a card's preview or the hero stage morphs
  into the explore view. Every animation and transition sits under `prefers-reduced-motion: no-preference`, so
  a user who asks for less motion gets none: pages swap directly and the effects do not run.
- **Fly and walk** (#66, shipped): the scene opens in fly mode (orbit, pan, zoom). A "Walk" button
  in its corner, or the `V` key, drops the camera to eye height (1.7 m) on the road nearest the
  centre, facing north; click the canvas to look around, WASD or the arrows to move (Shift runs),
  Esc releases the mouse. Building footprints stop the walker (`scene/collision.ts`, `scene/cameraModes.ts`).
  On terrain the camera's height is the ground there plus 1.7 m, so walking up a slope keeps you on it.
- **Set point** (#23, shipped): a "Set point" button (or `P`) arms the tool, and a click on the ground
  drops a pin; a double-click on the ground drops it at any time. A small marker with a ground ring sits
  on the terrain, outside the world group, so it is never picked and never exported. In fly mode the
  orbit target eases to the pin over about 400 ms (instantly under `prefers-reduced-motion`), keeping the
  camera's distance and angle, and zoom goes toward the cursor. Walk mode starts at the pin at eye
  height, facing the camera's horizontal direction; a pin inside a footprint moves to the nearest open
  ground. "Reset to centre" clears the pin and the target goes back to the area's centre
  (`scene/pinLayer.ts`, `scene/pinPoint.ts`).
- **Turntable rotation** (#119, shipped): in fly mode the scene turns slowly around the open area. It
  stops while the user drags or zooms, in walk mode and during a staged build, and resumes after five
  idle seconds. A "Rotate" button turns it on and off; it starts off under `prefers-reduced-motion`
  (`scene/autoRotate.ts`).
- **glTF export** (#69, shipped): a "Download glTF" button in the scene's corner saves the world as a
  binary `.glb` (`gre-<scope type>-<id>.glb`). Nodes are named `<layer>:<id>`; the root's extras carry
  the scope, projection origin, and axes, and the asset copyright is the OpenStreetMap attribution (plus the terrain's, when the world has terrain; the extras then also carry `elevation.version` and the road mode).
  Hidden layers (the blocks group, unless "Show blocks" is on; the generated buildings, unless "Show generated" is on) are left out, and so is every line (the buildings' edges, the block outlines) (`scene/exportGltf.ts`, `scene/exportButton.ts`).
- **Terrain** (#139, shipped): an area with `elevation` is built on its ground: a ground mesh from the grid,
  area features, buildable areas and roads draped on it, buildings standing on their stored base height, the
  route ribbon and markers lifted onto it, and the terrain's credit at the scene's bottom-left. The
  "Smooth roads" checkbox toggles the roads between the exact and smoothed heights. An area imported flat
  offers "Add terrain" (see Import areas). A staged import builds flat and gets its terrain when the finished
  world is loaded.
- **Generation playground** (M11): change the seed or density and watch the block repopulate.
  Pin a seed you like.
- **Export panel**: pick the scope, mode (filter / clip), and layers, and download GeoJSON with
  the projection metadata.

### General polish
- Shareable URL state: area, scope, view and the 2D camera are in the URL (#101); the selection and the 3D camera are not.
- Keyboard shortcuts and a command palette.
- Offline cache of the last loaded area.
