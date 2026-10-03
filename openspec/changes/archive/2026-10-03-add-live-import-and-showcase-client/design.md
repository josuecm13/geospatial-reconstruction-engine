## Context

`OSMIngestionService.import_fixture` gets or creates the import area, marks it importing, parses
the payload with `OSMFixtureAdapter`, and reconciles: whatever the payload doesn't produce is
deleted. It was written against fixtures modeled on Overpass's JSON shape. Two live Berlin samples
(Alexanderplatz and Rosenthaler Platz, September 2026) and one provoked timeout show where real
responses differ:

- A timeout is **HTTP 200 with valid JSON**: an empty `elements` array and
  `"remark": "runtime error: Query timed out in \"query\" at line 1 after 3 seconds."`. With
  reconcile, that deletes every entity of the area.
- A busy server returns **HTTP 504 with an HTML body** ("Dispatcher_Client::request_read_and_idx::
  timeout … too busy").
- `nwr(bbox); out geom;` omits node elements outside the box (73 of 182 ways had missing nodes), and
  returns the full geometry of every route relation touching the box. The Alexanderplatz response
  was 21 MB, mostly bus and tram routes.
- A POI mapped as an area that straddles the box edge has its center outside, which fails the
  whole import (#74).

## Goals / Non-Goals

**Goals:** import a real ≤ 1 km² box by selecting it, without a partial or failed response ever
destroying stored data; a browser client to pick, import, and see it.

**Non-Goals:** batching or parallel Overpass queries; caching responses; generated content; server
side meshes.

## Decisions

- **Completeness (#15).** A payload that carries a `remark` is rejected before anything is
  touched: before the import area is created, marked importing, or reconciled. The area's
  previous state and status stay exactly as they were. Every `remark` counts, not only ones that
  start with `runtime error`, because a remark means the server didn't return everything it was
  asked for, and reconcile can't tell partial from complete. The check applies to posted payloads
  too: a posted payload with a remark is the same truncated Overpass output. The API reports it
  as 422 `source_incomplete` for a posted payload. #61 decides the status for a live fetch.
- **Missing way nodes (#14).** Ways keep `out geom`. A normalizer adds a node element for each
  referenced node that has no element, taking its coordinates from the way's inline `geometry`
  (index-aligned with `nodes`). It runs ahead of `OSMFixtureAdapter`, which stays unchanged. This
  is preferred over `(nwr(bbox);>;);`, which recurses into relation members and grows the payload.
- **Query shape (#61).** Only the relations the adapter reads are requested (`restriction`,
  `multipolygon`), so route relations don't bloat the response.
- **Fast block derivation (#91).** Derivation on a 1 km² city area went from 208 s to about 11 s. The
  planner was inlining single-reference CTEs (the candidate faces' buffered road unions, and the
  buildable-area `cut`) and recomputing them per face and per column, so both are `AS MATERIALIZED`.
  The per-face segment lookup is one set-based query. Output is unchanged except the order of
  segments whose `ST_LineLocatePoint` is equal, which now breaks ties by segment id. Block ids
  hash the set of segment ids, so they don't depend on it.
- **Background imports (#90).** `POST /import-areas` with `background: true` creates the area, starts
  a job in an in-process registry (a pool of two, results kept ten minutes), and answers 202 with
  `events_url`. `GET /import-areas/{id}/events` is server-sent events that replay everything the job
  has published, or what follows `Last-Event-ID`, and then follow it live; subscribers never affect
  the job. A second import of an area that is running answers 409 `import_in_progress`. The registry
  is in memory, so a restart forgets running jobs (`import_job_not_found`).
- **One transaction, stages announced after the flush.** The whole import is one all-or-nothing
  transaction, so a failure leaves the area as it was. Stages are announced once their rows are
  flushed, in the order `fetched`, `ground`, `roads`, `blocks`, `buildings`, then `completed` or
  `failed`; `generated` is reserved for Milestone 11. The service emits through a callback and
  doesn't know JSON; the API layer maps stages to payloads with the `map-data` mappers. The cost is
  that the stages arrive in a burst after persisting, so the client paces the animation.
- **Buildings stream in rings.** Buildings are batched by distance from the centre of the area, and
  `ring` is the index of the non-empty ring, so empty rings leave no gap. The client reveals blocks
  after the last ring, because buildings link to blocks and the server finishes blocks first.
- **Nested areas (#100), option A.** The road network stays whole, so routing and blocks work across
  the rectangle. Buildings, POIs, area features and interior blocks of completed areas fully
  covered by the new rectangle are skipped, not stored twice, and the sweep removes earlier copies
  on re-import. A block is dropped when an inner box covers its boundary, not by its representative
  point, so a block straddling an inner edge is kept. Block ids are assigned over all faces before
  covered ones are dropped, so a survivor is never renumbered. `map-data` of the outer area composes
  the inner areas' features (deduplicated by source id) and their unclipped blocks that no outer
  block covers, and `scope.composed_area_ids` says which. Partly overlapping areas import in full.
- **The World contract.** The client builds the scene from `map-data` in local meters (x east, z
  south, y up) in the response's projection. One `world` group holds `ground`, `area_features`,
  `roads`, `blocks`, `buildings` and `generated`, and meshes are named `<layer>:<entity id>`. Fly,
  walk, route and glTF export all build on it, and the export strips per-mesh properties down to
  `layer` and `id`.
- **The strategy probe.** There is no endpoint that lists routing strategies, so the client sends one
  route request with a bogus strategy and reads `registered_strategies` from the 422 details. Any
  other failure leaves only the server default.
- **Pages and URL state.** The client is vanilla TypeScript with a small history router: `/`,
  `/locations`, and `/explore/:areaId?view=&scope=&at=`. The URL is the source of truth for the open
  area, scope and view, so a pasted link restores them. Three.js and MapLibre load only on the
  pages that need them.
- **Errors show the server's reason behind one flag.** `DEBUG_ERRORS` in the client is off by
  default and the same in every build; with it on, the server's message and OSM references appear.
