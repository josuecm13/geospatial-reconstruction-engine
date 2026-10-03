# 04 — Dispose listeners and the stream on leaving explore (#113)

## Goal

Leaving `/explore` should leave nothing behind: no `window` or `document` listener from the visit,
and no open import stream. Today each visit adds another set of global listeners, and a staged
import still streaming keeps its `EventSource` open after the page is gone.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 113`.

The issue is right, but its list is incomplete. Two more leaks are verified below: the
`OrbitControls` (never disposed), and `BoundaryTool`'s Escape listener when the page is left
mid-trace. Both are in scope, because the acceptance criterion is "no listener from a previous visit
remains".

## Code to read first: every global listener on the explore page

| Module | Listener | Added at | Removed today? |
|---|---|---|---|
| `scene/cameraModes.ts` | `window` `keydown` (V, WASD) | 81 | never |
| | `window` `keyup` | 91 | never |
| | `window` `blur` | 92 | never |
| | `document` `mousemove`, `pointerlockchange`, `pointerlockerror`, from `new PointerLockControls(camera, canvas)` (38) | three `PointerLockControls.js:124-126` (`connect`, called by the constructor) | only by `look.dispose()` (132-134), which is never called |
| `views/sceneView.ts` | `document` `keydown` (capture), from `new OrbitControls` (67) | three `OrbitControls.js:506` (`connect`); `keyup` capture at 1952 and `pointermove`/`pointerup` on the document at 1561-1562 while a drag is in progress | only by `controls.dispose()` (`disconnect`, 512; `dispose`, 540), which is never called |
| `scene/routePanel.ts` | `window` `keydown` (Escape clears) | 142 | never |
| `importing/rectangleTool.ts` | `document` `keydown` (Escape cancels a drag) | 71 | never |
| `boundaries/boundaryTool.ts` | `document` `keydown` (Escape cancels), while tracing | 142 (vertices), 179 (freehand) | by `stop()` when a trace ends. Leaving mid-trace leaks it |

Not leaks:

- The listeners on the renderer's canvas and the MapLibre canvas (`routePanel.ts:128,131`,
  `cameraModes.ts:78`, `rectangleTool.ts:67-70`, OrbitControls' own canvas listeners) go with their
  elements. `sceneView.dispose` removes the renderer's canvas (177) and `mapView.map.remove()`
  removes the map's.
- `SceneLoader` and `ImportPanel` subscribe to the per-mount `SelectionStore`, which goes away with
  the page.
- `routing/router.ts:46-47` is the app's router, mounted once on purpose.
- `importPanel.ts:126` clears its timer in `finally`.

**The stream.** `ImportPanel.importSelection` (`importing/importPanel.ts:116-143`) calls
`runStagedImport(this.api, this.staging, bbox)` (128). `runStagedImport`
(`importing/stagedImport.ts:34-87`) awaits `api.startImport`, then `target.begin(bbox)` (which
switches to the scene), then opens `api.importEvents(id)`, which is `new EventSource(...)`
(`api/client.ts:65-66`). The stream is closed only in `settle()` (42-47), on `completed`, `failed`,
or a stream that gave up. Nothing can close it from outside.

**The unmount.** `pages/explore.ts:237-249` unsubscribes the route and the selection, then
`sceneLoader.hidden()` and `scene.dispose()`, then `mapView.map.remove()`. It never touches
`importPanel` or the boundary panel. `boundaries` is a local inside the map's `load` handler
(107), so unmount can't reach it today.

## Design

Every module with a global listener gets a `dispose()` that removes exactly what it added. Use
named handlers, because the inline arrows today can't be removed.

- **`cameraModes.ts`**: add `dispose()` to `CameraModes`. It removes the three `window` listeners,
  calls `look.dispose()`, and clears `held`. It doesn't remove the button or help elements: the
  container goes with the page. Make the handlers named constants.
- **`routePanel.ts`**: add `dispose()` to `RoutePanel`. It removes the `window` `keydown`.
- **`sceneView.ts`**: `dispose()` additionally calls `modes.dispose()`, `routes?.dispose()`, and
  `controls.dispose()`, before `renderer.dispose()`.
- **`rectangleTool.ts`**: add `dispose()`. It ends any drag (`endDrag`), removes the `document`
  `keydown`, and removes its four canvas listeners (cheap, and correct if the map ever outlives the
  tool).
- **`boundaryTool.ts`** / **`boundaryPanel.ts`**: add `BoundaryTool.dispose()`, which calls
  `this.stop()`, and `BoundaryPanel.dispose()`, which calls it. `stop()` touches `map.dragPan`, so
  it must run before `map.remove()`.
- **The stream: an `AbortSignal`.** Change the signature to
  `runStagedImport(api, target, bbox, signal?: AbortSignal)`.
  - If the signal is already aborted, or aborts after `startImport` or after `target.begin` resolves,
    reject with `new DOMException("aborted", "AbortError")`. Don't open the stream.
  - Once the stream is open, `signal.addEventListener("abort", …, { once: true })` calls `settle()`,
    which closes it and rejects with the same `AbortError`.
  - **Decision:** on abort, don't call `handle.abandon()`. The page is going away and the scene is
    disposed with it. `abandon()` would resolve `finished` and trigger `sceneLoader.resume()` (a
    map-data load into a disposed view) and explore's `goTo("map")`. Closing the stream doesn't stop
    the server's import: it finishes in the background, and the area is listed next visit.
- **`ImportPanel`**: holds an `AbortController` per import and passes its signal. `dispose()` aborts
  it and calls `this.tool.dispose()`. In `importSelection`'s `catch`, an `AbortError` is not shown
  (return before `showError`). The existing `finally` still clears the timer.
- **`explore.ts`**: hoist `let boundaryPanel: BoundaryPanel | undefined` next to `importPanel`, and
  assign it in the `load` handler. Unmount then runs, in this order:
  `importPanel?.dispose(); boundaryPanel?.dispose();` (both before `mapView.map.remove()`), then the
  existing `sceneView` disposal (which now disposes modes, routes and controls), then `map.remove()`.

## Tests

The tests don't need WebGL: `OrbitControls` and `PointerLockControls` only need a DOM element. Use
`// @vitest-environment jsdom` (as `exportGltf.test.ts` does). Add a small helper in the tests, for
example `client/src/testing/listenerLedger.ts`, that spies on `addEventListener` and
`removeEventListener` of `window` and `document` and reports any (type, listener) added and not
removed.

- `client/src/importing/stagedImport.test.ts` (extend; it already has `FakeStream` with `closed`):
  - Aborting while streaming closes the stream, rejects with an `AbortError`, and doesn't call
    `handle.abandon`.
  - Aborting before `target.begin` resolves opens no stream at all.
  - Aborting after `completed` changes nothing.
- `client/src/scene/cameraModes.test.ts` (new, jsdom): create modes with a `PerspectiveCamera`, an
  `OrbitControls` on a `<canvas>`, and a container. Then `dispose()`. The ledger is empty for
  `window` and `document`.
- `client/src/scene/routePanel.test.ts` (new, jsdom): same. `createRouteLayer(camera, canvas)`
  (`routeLayer.ts:32`) needs only a camera and a canvas, so no renderer. Pass `RoutingDeps` with stub
  `route` and `routingStrategies`.
- `client/src/importing/rectangleTool.test.ts` (new): a fake map with `addSource`, `addLayer`,
  `getSource`, `getCanvas` (a jsdom canvas), `getCanvasContainer`, and `dragPan`/`boxZoom` stubs.
  `dispose()` leaves the `document` ledger empty.
- `BoundaryTool`: the same fake map. `start("vertices")`, then `dispose()`: the `document` ledger is
  empty.

These are guard tests and can't be mutation-checked without local runs. Say "not mutation-checked".
Check by hand too: visit `/explore`, go to `/`, come back three times, then press `V` once in the
scene. It toggles once, not four times.

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, requirement "The client SHALL keep each view's state in
  its URL" (or the staged-build one, whichever reads better): add that leaving the explore page
  SHALL release its listeners and close a running import's event stream, while the import itself
  continues on the server. Add a scenario: **WHEN** a user leaves `/explore` while a staged import is
  streaming, **THEN** the event stream is closed, and the area appears in the list once the server
  finishes it.
- `docs/client-features.md`: no row changes.

## Outcome

Done as designed. Added `dispose()` to `CameraModes` (named handlers; also `look.dispose()`),
`RoutePanel`, `RectangleTool`, `BoundaryTool`, `BoundaryPanel` and `ImportPanel` (aborts an
`AbortController` and disposes the tool). `sceneView.dispose` now disposes modes, routes and the
orbit controls. `runStagedImport` takes an optional `AbortSignal`: it rejects with `AbortError` if
aborted before or after `startImport` or `begin` (no stream is opened), and closes the stream
(without `abandon()`) when aborted later. `ImportPanel.importSelection` returns silently on an
`AbortError`. `explore.ts` hoists `boundaryPanel` and disposes both panels before `map.remove()`.

The brief's code references held. Unmount order is panels, then the scene's
async disposal (`sceneView.then`), then `map.remove()`; the scene still disposes after the map is gone,
as before.

Tests: abort cases in `stagedImport.test.ts`; jsdom listener-ledger tests for `cameraModes`,
`routePanel`, `RectangleTool` and `BoundaryTool` (vertices and freehand), with helpers
`src/testing/listenerLedger.ts` (self-tested) and `src/testing/fakeMap.ts`. Verified with
`npx tsc --noEmit -p client` only. Not run (CI is the gate) and not mutation-checked. The manual check
(visit, leave, return three times, then press `V` once) is not done. Spec requirement and scenario
added; no `docs/client-features.md` row changes, as the brief said.

## Tangents found

None.
