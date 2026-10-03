# 09 — Show a route between two points in the scene (#68)

## Goal

In the Scene tab, the user clicks an origin and a destination. The client calls
`POST /import-areas/{id}/routes` and draws the returned route on the road surfaces, with a strategy
picker built from the server's registered strategies, the snap distances, and errors shown by code.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 68`.

## Depends on

Brief 06 (World contract; `toLonLat`), and brief 04 (`useErrorReporter`).

## Facts from the server

- `server/app/api/routers/route_planning.py`: the body is
  `{origin: {latitude, longitude}, destination: {…}, strategy?}`. The response is the `Route` type in
  `client/src/api/types.ts` (`geometry` a LineString or null, `total_distance_meters`, `strategy`,
  `origin_snap_distance_meters`, `destination_snap_distance_meters`).
- **There's no endpoint listing strategies.** The only source is `details.registered_strategies` on a
  422 `unknown_routing_strategy`. The issue requires the picker to come from that, not a hardcoded
  list. So: `ApiClient.routingStrategies(areaId)` sends a route request with strategy
  `"__list_strategies__"` and two placeholder coordinates (the area's bbox centre twice), catches the
  `unknown_routing_strategy` error, and returns its `registered_strategies`. Cache the result per
  session. If the call fails some other way, fall back to "server default" only, meaning no
  `strategy` field is sent. Document this in a code comment, and note under Tangents that a
  `GET /routing-strategies` endpoint would be cleaner. **Don't build it here.**
- Errors: `no_route_found` and `no_navigable_node` (422), `invalid_coordinate`.

## Design

- `client/src/scene/routePicking.ts` (pure, tested): the state machine `idle → origin set → both set
  (requesting) → shown | error`. A third click starts over with that click as the new origin.
  Escape clears.
- `client/src/scene/routeLayer.ts` (Three.js): raycast the click against the `roads`, `ground`, and
  `area_features` groups (not buildings) to get `{x, z}`, then `toLonLat`. Mark the origin and
  destination with small cones (green and red). Draw the route as a flat ribbon 2 m wide at y = 0.08
  (just above the road surface), using `roadPolygon` from brief 06 with width 2, in a bright color.
- `client/src/scene/routePanel.ts`: a small overlay in the scene with mode on/off ("Route" toggle;
  while on, clicks pick points instead of orbiting), the strategy `<select>`, and the result: the
  distance in m or km, and both snap distances. **Warn when a snap distance is over 25 m** (the
  constant `LARGE_SNAP_METERS`): "Your point is 40 m from the nearest road; the route starts there."
- Errors: `no_route_found` → "No route connects these points." `no_navigable_node` → "There's no road
  near that point." Use the reporter with a routing messages table.

## Tests

`routePicking.test.ts` (transitions, a third click resetting, Escape), plus a test for the strategy
probe with a fake `fetch` returning the 422 envelope (`client/src/api/client.test.ts` shows how fakes
are built), and for the large-snap warning threshold.

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL show a route between two picked points"**,
  with scenarios for a large snap distance warning and for `no_route_found`.
- `docs/client-features.md` → Routing: the client column.
- `tasks.md`: tick `1.17 #68`.

## Outcome

## Tangents found
