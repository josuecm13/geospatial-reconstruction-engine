# 13 — Pages and URL state (#101)

## Goal

Turn the single screen into real pages behind a small history router, with the state that defines
a view in the URL, still plain TypeScript (no framework). Every later UX brief (14, 15) builds on it.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 101`.

## Depends on

Briefs 05–10 landed (they wire into `main.ts`; this brief restructures it). Run it after them.

## Design

- `client/src/routing/store.ts` (pure, tested): `createStore<T>(initial)` → `{ get(), set(next | (prev) => next), subscribe(fn) → unsubscribe }`.
  Notifies only on a real change (`Object.is`, or a shallow compare for plain objects). This is the
  "hook" primitive: views call `subscribe` on mount and the returned function on unmount.
- `client/src/routing/routes.ts` (pure, tested): the route table and a URL codec.
  - `type Route = { page: "landing" } | { page: "locations" } | { page: "explore"; areaId: string; view: "map" | "scene"; scope: string | null; at: Camera | null } | { page: "not-found"; path: string }`.
  - `parseUrl(url: URL): Route` and `formatRoute(route): string`. `at=<lat>,<lon>,<zoom>`, 5 decimals for
    lat/lon, 2 for zoom; invalid params are dropped, not errors. `view` defaults to `map`.
  - Round-trip property: `parseUrl(new URL(formatRoute(r), base))` equals `r` for every case in the table.
  - `legacyRedirect(hash, rememberedAreaId)`: `#map`/`#scene` with a remembered area → the explore URL;
    without one → `/locations`.
- `client/src/routing/router.ts` (DOM, thin): owns a `createStore<Route>`, listens to `popstate`,
  intercepts same-origin `<a data-link>` clicks, exposes `navigate(route, { replace })`.
  View or scope change → `pushState`; camera change → `replaceState` (debounced ~300 ms).
- Pages: `client/src/pages/{landing,locations,explore,notFound}.ts`, each `mount(el, ctx) → unmount`.
  `explore.ts` hosts what `main.ts` does today (map, panels, lazy scene). Landing and locations are
  placeholders here (a heading and a link). Briefs 14 and 15 fill them in.
- `SelectionStore` stays the source for area and scope. The explore page syncs it **from** the route
  on navigation and **to** the route on change, with no loops (compare before writing). The
  `localStorage` memory of the current area remains, but only for the legacy redirect.
- `index.html`: the header nav becomes links (`/`, `/locations`, and the Map/Scene toggle on explore).
  Vite serves `index.html` for any path in dev and preview (`appType: "spa"` is the default). Check
  that and add a one-line note to `HOW_TO_RUN.md` about how a static host needs the same fallback.

## Tests

`store.test.ts` (notify, no-notify on equal, unsubscribe), `routes.test.ts` (table-driven parse/format,
round-trip, invalid params, legacy redirect). Router and pages are DOM, not tested.

## Docs

The spec delta gets a new requirement, "The client SHALL keep each view's state in its URL", with
scenarios for "paste the URL in a new tab" and "back restores the previous scope". Add a row in
`docs/client-features.md`. Tick its line in `tasks.md`.

## Outcome

Built as briefed. `client/src/routing/`: `store.ts` (`createStore(initial, equals = shallowEqual)`), `routes.ts`
(`Route`, `parseUrl`, `formatRoute`, `roundCamera`, `sameRoute`, `legacyRedirect`), `router.ts` (`createRouter`),
with `store.test.ts` and `routes.test.ts`. `client/src/pages/`: `types.ts`, `host.ts`, `explore.ts`, and placeholder
`landing.ts`, `locations.ts`, `notFound.ts`. `main.ts` is now a small shell; `views/viewState.ts` and its test are deleted.
Tests were written with hand-computed expectations but not run (CI is the gate); `tsc --noEmit -p client` is clean.
Guards are not mutation-checked.

**API for briefs 14 and 15**

- Page contract: `export const mount: Mount<R> = (el, ctx) => unmount` (`pages/types.ts`). `el` is the empty `<main id="page">`;
  `ctx = { api, router, route, tabs }` (`route` is the route when the page was requested: read `router.get()` for the latest;
  `tabs` is the header slot for page links, hidden and empty unless a page fills it). Unmount must undo everything; the shell then
  empties `el` and `tabs`. Pages are listed in the `switch` in `pages/host.ts` (dynamic imports, so landing and locations
  never load MapLibre); a page is remounted only when `route.page` changes. For a full-width scrolling page, put a
  `<div class="page">` in `el` (styled in `style.css`). Replace `landing.ts` / `locations.ts` bodies; keep the export.
- Router: `router.get()`, `router.subscribe(fn)` (not called immediately, returns unsubscribe), `router.navigate(route, { replace? })`
  (pushState by default, no-op when the URL is already current), `router.setCamera(camera)` (debounced 300 ms replaceState of `at`).
  Links: any `<a data-link href="/explore/<id>">` navigates without a page load; build hrefs with `formatRoute(route)`.
  To open an area from the locations gallery: `router.navigate({ page: "explore", areaId, view: "map", scope: null, at: null })`.
  `at` is the 2D map camera; explore applies it with `jumpTo` when the page opens on that URL.
- Routes (`routes.ts`): `/`, `/locations`, `/explore/:areaId?view=scene&scope=<boundaryId>&at=lat,lon,zoom`, anything else `not-found`.

**Decisions**

- Explore creates its own `SelectionStore` per mount and sets area and scope from the URL before building the panels. Route to
  selection and selection to route both compare before writing, plus an `applying` flag, so there is no loop. Selection changes
  the user makes (open an area, pick a scope, finish an import) push an entry; the fallback when a remembered boundary was deleted
  rewrites the entry. `localStorage` keeps only the current area (read by the legacy redirect in `main.ts`) and the scope memory
  `SelectionStore` already had.
- `ImportPanel` no longer opens the remembered area in its constructor: explore opens the URL's area through `open(areaId, { area,
  instant, camera })`, so a URL naming a missing area (404 `import_area_not_found`) becomes the not-found page. It also gained
  `mapShown()`: a camera move requested while the map is hidden (the page opened on `view=scene`, so the map has no size) waits for
  the map to be shown.
- Brief 08's two `location.hash` writes are now `router.navigate` with view `scene` / `map` (push, as before).
- A pasted scene URL opens the scene directly. The old rule "every page load opens on the map" is gone (the spec requirement is
  modified); Three.js still loads only when the scene view is first shown.
- `SceneView.dispose()` (stop, `renderer.dispose()`, `forceContextLoss()`) and `map.remove()` run on unmount.
- The scene's camera is not in the URL; `at` is the 2D map only.
- Vite serves `index.html` for any path in dev and preview (`appType` defaults to `spa`; not changed in `vite.config.ts`);
  `HOW_TO_RUN.md` notes the fallback a static host needs. Not verified in a browser.

Not done: nothing seen running (no local run); a staged import still in flight when the user leaves explore keeps its
EventSource until the stream ends.

## Tangents found

- Leaving `/explore` leaves a few inert `window`/`document` listeners behind (`cameraModes` keydown/keyup/blur, `routePanel`
  Escape, `rectangleTool` Escape), since those modules have no `dispose`. They do nothing once the page is unmounted (their
  `active`/`enabled` guards are off), but each visit to explore adds a set. A `dispose` on each, or an `AbortSignal`, would fix it.
