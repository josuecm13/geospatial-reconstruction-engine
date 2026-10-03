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

## Tangents found
