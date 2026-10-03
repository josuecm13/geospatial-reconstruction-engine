# 05 — Trace a boundary and manage saved boundaries (#64)

## Goal

On the 2D map, a user traces a shape inside the rectangle (by clicking vertices, or freehand), saves
it with the import, lists, selects, and deletes saved boundaries, and switches the whole client's
scope between the area and one boundary. The scope survives a reload.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 64`.

## Already in place

- **`client/src/state/selection.ts`**: `SelectionStore` holds `{areaId, scope}` and persists the
  scope per area (`gre.scope`). `setScope({type: "boundary", boundaryId})` / `setScope({type:
  "import_area"})` and `subscribe`. `mapDataQuery(scope)` builds the map-data query. **Use it. Don't
  add another store.** `main.ts` creates one instance and passes it to `ImportPanel`.
- `client/src/api/client.ts`: `createBoundary(areaId, name, geometry)`, `listBoundaries(areaId)`,
  `deleteBoundary(areaId, boundaryId)`, `mapData(areaId, {boundaryId})`.
- `client/src/importing/rectangleTool.ts`: how a MapLibre drawing tool is built (GeoJSON source,
  fill and line layers, map mouse events, `dragPan` toggling). Mirror it.
- Server rules (`server/app/domain/traced_boundary.py`, `validate_traced_boundary`): `invalid_boundary`
  comes with `details.rule`, one of `blank_name`, `too_few_vertices`, `not_closed`,
  `self_intersecting`, `degenerate`, `outside_import_area`, `invalid_geojson`, `holes_not_supported`.
  A duplicate name → 409 `boundary_name_conflict`.
- Brief 04's `useErrorReporter(messages)` / `renderReportedError`. Pass a boundary messages table.

## Design

New files under `client/src/boundaries/`:

- `boundaryGeometry.ts` (pure, tested):
  - `closeRing(points: Position[]): Position[]` appends the first point if it isn't already last.
  - `simplifyFreehand(points: Position[], toleranceMeters: number, latitude: number): Position[]`:
    Douglas–Peucker in local meters (use the meters-per-degree helpers in `client/src/geo/`, or add
    them there). Freehand input produces hundreds of points, and this keeps the ring to a sane size.
  - `ringProblem(ring, bbox): "too_few_vertices" | "self_intersecting" | "outside_import_area" | null`:
    a client-side precheck with the **same rule names as the server**, so one message table serves
    both. The server stays the authority: always show the server's 422 if it disagrees.
- `boundaryMessages.ts`: a plain-words sentence per `rule` (for example `self_intersecting` → "The
  shape crosses itself."), plus messages for `boundary_name_conflict` and `boundary_not_found`.
- `boundaryTool.ts`: the MapLibre drawing tool. Two modes: **vertices** (each click adds a point;
  clicking the first point or double-clicking closes the shape; Escape cancels) and **freehand**
  (mouse down, drag, mouse up closes the shape). It has its own source and layers, styled clearly
  differently from the rectangle: a solid orange line with a light fill, where the rectangle is
  dashed blue. Saved boundaries are drawn in a third style (thin solid purple outline), and the
  selected one is highlighted.
- `boundaryPanel.ts`: a section in the side panel (below the import controls) with "Trace boundary"
  (vertices / freehand toggle), a name input (default `Boundary <n>`), and a list of saved boundaries
  for the open area. Each entry has *select* (sets the scope) and *delete* (confirm first; if it's
  the current scope, the scope falls back to the whole area). Above the list is a scope selector,
  "Whole area" plus one entry per boundary, bound to `SelectionStore`.

**On import with a traced shape.** The issue says: "On import, the client creates the area, then
POST …/boundaries with the drawn shape." When a shape was traced before importing, call `createBoundary`
right after the import succeeds, then set the scope to it. If the boundary is rejected, the area
import still stands: show the boundary error, and keep the traced shape so the user can fix it and
save it with the panel's save button.

**Scope consumers.** `ImportPanel.open()` loads `mapData(areaId)`. Change it so map layers load
`mapData(areaId, mapDataQuery(scope))`, and reload when the scope changes (subscribe to the store).
The 3D scene (brief 06) subscribes on its own.

## Tests

- `boundaryGeometry.test.ts`: close, simplify (keeps the corners of a square, removes collinear
  points), and each precheck rule.
- `boundaryMessages.test.ts`: every server rule name has a sentence. Keep the rule list in one
  exported array in `boundaryMessages.ts`, and test against it.

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL trace, save, and scope by boundaries"**, with
  scenarios for a self-crossing shape showing its rule in plain words, and for a scope surviving a reload.
- `docs/client-features.md` → Traced boundaries and export: mark the client side done, with where it lives.
- `tasks.md`: tick `1.13 #64`.

## Out of scope

Editing a saved boundary's vertices (delete and redraw instead) and clip-mode export (that's the
glTF brief's concern).

## Outcome

Built `client/src/boundaries/` (`boundaryGeometry`, `boundaryMessages`, `boundaryTool`, `boundaryPanel`, with
tests for the first two) and `client/src/geo/localMeters.ts`. The panel has a Boundaries section under the import
controls (`index.html` now splits the aside into an import section and a boundary section). `ImportPanel` loads
`mapData(areaId, mapDataQuery(scope))`, reloads when the shared scope changes, takes an optional `afterImport`
callback (main wires it to `BoundaryPanel.saveTraced`), and exposes `bbox` for the client-side precheck.
Spec delta, `client-features.md` rows, and `tasks.md` 1.13 are updated. Tests were written but not run (CI is the gate);
only `tsc --noEmit` was run.

Decisions:
- `invalid_boundary` is explained by `details.rule` through `reportBoundaryError`, a thin wrapper over brief 04's
  reporter (the reporter itself only maps `code`, so the rule override lives in `boundaryMessages.ts`).
- Opening a different area always starts at its whole extent; only reopening the current area keeps its remembered
  scope. A remembered boundary that was deleted (404 `boundary_not_found`) falls back to the whole area.
- The panel's Save button saves to the open area; a shape traced before an import is saved to the new area by
  the import itself. If the drawn rectangle was redrawn over a different place, the server's `outside_import_area` is shown.
- The precheck runs against the rectangle on the map (`ImportPanel.bbox`), which equals the open area's box until redrawn.
- Not done: map clicks on engine features still open popups while tracing vertices (cosmetic), no mutation checks on
  the geometry tests (no local test runs).

## Tangents found

- `MapDataLayers` feature popups fire on clicks during boundary tracing; a tool-active guard would be a small follow-up.
