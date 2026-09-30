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
