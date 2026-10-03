# 14 — Landing page: what the engine is, and how it works (#102)

## Goal

`/` explains the project, shows its architecture as an interactive diagram, and leads to the
locations and to a new import.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 102`.

## Depends on

Brief 13 (router, `pages/landing.ts` placeholder, `data-link` anchors).

## Design

- Read `README.md`, `docs/architecture.md` and `MILESTONES.md` for the facts. The copy is short and
  plain: what goes in (an OpenStreetMap rectangle), what comes out (a generated city model: streets
  with lanes and widths, buildable blocks, buildings with heights, a routable graph), and what it's for
  (games, simulation, art). No marketing superlatives.
- **Architecture diagram**: hand-built inline SVG (no library) in `client/src/landing/architecture.ts`.
  Stages: Overpass → Ingestion (parse, reconcile) → PostGIS domain (segments, streets, blocks,
  buildings, boundaries) → Derivation (cross-sections, blocks, turn graph) → HTTP API (map-data, routes,
  SSE import events, exports) → This client (2D map, 3D scene). Hovering or focusing a stage
  highlights it and shows a side card with what it produces and a link to the doc section on GitHub.
  The stage data (id, title, produces, docHref, edges) is a pure module, `architectureModel.ts`.
- **Locations block**: the 6 most recent areas from `GET /import-areas` as simple cards (brief 15
  replaces them with its preview cards; keep the card rendering in one function so that swap is one line),
  a "See all locations" link, and a primary "Import a new place" button that navigates to explore in
  import mode (open the map with no area).
- With the API down, the copy and diagram still render. The locations block shows the error reporter's
  sentence.
- Layout: a CSS grid that collapses to one column under 720 px. Every interactive stage is a
  focusable `<g role="button" tabindex="0">`.

## Tests

`architectureModel.test.ts`: every edge references existing stages, the stages are connected in
pipeline order, and every stage has a doc link.

## Docs

Spec delta: "The client SHALL open on a landing page that explains the engine". `client-features.md` row.

## Outcome

Built as briefed. `client/src/pages/landing.ts` (hero with the two actions, three-fact explainer, diagram, recent locations),
`client/src/landing/architectureModel.ts` (pure stage and edge data, with its test), `architecture.ts` (hand-built SVG, side card,
`layout(columns)` with a test), `importTarget.ts` (with test). Styles are under `.landing` at the end of `style.css`. Tests were
written with hand-computed expectations, not run (CI is the gate); `tsc --noEmit -p client` is clean; guards not mutation-checked.
Nothing was seen in a browser.

**Decisions**

- Diagram layout: 3 columns (two rows, an elbow arrow between rows) from 720 px up, one column stacked on a phone, redrawn on a
  `matchMedia` change so the text never shrinks below readable. The side card sits beside the diagram from 1100 px and below it
  under that; the facts grid collapses to one column under 720 px. The card follows the last stage hovered, focused, clicked or
  Enter/Space'd and never clears, so its doc link stays reachable; with none chosen it shows a hint.
- "Import a new place": explore always names an area (no route opens the map with no area), so the button opens the area last
  opened in this browser (`CurrentArea`), else the most recent listed one, else goes to `/locations` (`importTarget`). This is not
  the "map with no area" the brief describes; see the tangent.
- Locations block asks for `status=completed`, `limit=6`, and renders every card through the local `renderLocationCard`, so brief 15's
  card renderer replaces it in one line. The cards show the centre coordinate, counts and date; the API has no place names.
- The brief lists "buildings with heights" among the outputs; heights from source are Milestone 8.1 and unbuilt, so the copy says
  "buildings".
- Doc links point at `docs/*.md` sections on `main` on GitHub, `_blank` with `noopener`.

## Tangents found

- There is no way into the import panel with no area open: `/explore/:areaId` requires an area, so a fresh database (no areas) has
  no route to the rectangle tool, and the landing's primary button can only lead to the (empty) locations page. Needs an explore
  route (or mode) with no area, e.g. `/explore` or `/explore/new`, in `routing/routes.ts` and `pages/explore.ts`.
