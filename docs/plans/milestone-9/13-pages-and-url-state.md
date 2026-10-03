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

## Tangents found
