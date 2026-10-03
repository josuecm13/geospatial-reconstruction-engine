# 05 — No popups while tracing (#114)

## Goal

While a boundary is being traced, clicking the map places a vertex and nothing else. No feature popup
opens, and one already open closes when tracing starts. When tracing ends or is cancelled, popups
work again.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 114`.

The claim holds, and also covers freehand. `MapDataLayers` opens a popup on any `click` on its
layers, with no notion of tracing. Freehand tracing is affected too: MapLibre fires `click` after a
press and release that barely moved.

## Code to read first

- `client/src/views/mapDataLayers.ts`
  - The constructor (15-61) adds the sources and layers. For each of `CLICKABLE` (10) it registers
    `map.on("click", id, (event) => this.describe(event))` and a pointer cursor on
    `mouseenter`/`mouseleave` (56-60).
  - `describe` (71-78) skips an event whose `originalEvent.defaultPrevented` (so only the top layer
    describes itself), then opens `this.popup` (13).
- `client/src/boundaries/boundaryTool.ts`
  - `start(mode)` (73) sets `tracing = true` and calls `onChange(null, true)`.
  - `cancel()` (87) and `finish()` (188) call `stop()` (195), then `onChange(..., false)`.
  - `isTracing` (68). The vertex handler is a plain `map.on("click", click)` (139).
- `client/src/boundaries/boundaryPanel.ts`: owns the tool (19, 72). Its `traceChanged()` (177-196) is
  the tool's `onChange`, and runs on every start, finish and cancel.
- `client/src/pages/explore.ts:102-120`: in the map's `load` handler, `new MapDataLayers(map)` is
  created first, then the `ImportPanel`, then `new BoundaryPanel(...)`.

Why `preventDefault` from the tool won't do: MapLibre calls listeners in registration order, and the
layer listeners are registered before the tool's. `describe` has already run by the time the tool
sees the click.

## Design

Push the tracing state into the layers, rather than have the layers ask for it.

- `MapDataLayers.setPopupsEnabled(enabled: boolean)`. When disabled, `describe` returns at once and
  any open popup is removed (`this.popup.remove()`). Also skip the pointer cursor on `mouseenter`
  while disabled, so the cursor doesn't fight the tool's crosshair (`boundaryTool.ts:78`).
- `BoundaryPanel` gets an optional last constructor parameter,
  `onTracingChange: (tracing: boolean) => void = () => {}`, called from `traceChanged()` with
  `this.tool.isTracing`.
- `explore.ts`: `new BoundaryPanel(..., (tracing) => layers.setPopupsEnabled(!tracing))`.

Why push: start, finish and cancel all already go through `traceChanged`, so one callback covers
them, and closing a popup that's open when tracing starts needs an event anyway.

The last click of a vertex trace (on the first vertex) runs `describe` while `tracing` is still
true, because the layer listener runs before the tool's `finish()`. So it's suppressed too, which is
right. A double-click to close is the same.

## Tests

`client/src/views/mapDataLayers.test.ts` (extend). `maplibre-gl`'s `Popup` constructs in Node
(checked), so a fake map is enough:

- The fake map records `on(type, layerId, handler)` and no-ops `addSource`, `addLayer` and
  `getCanvas` (returning `{ style: {} }`). Spy on `maplibregl.Popup.prototype.addTo` and `remove`.
- A click on `engine-buildings` with popups enabled → `addTo` is called once.
- After `setPopupsEnabled(false)` → the same click doesn't call `addTo`, and `remove` was called.
- After `setPopupsEnabled(true)` again → the click calls `addTo`.

Use a click event with `features: [{ layer: { id: "engine-buildings" }, properties: {} }]`, `lngLat`,
and `originalEvent: { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }`.

The `BoundaryPanel` wiring needs the full panel and a map: check it by hand. Trace by vertices over
buildings (no popup), cancel with Esc and click a building (popup), then trace freehand over a park
(no popup).

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, requirement "The client SHALL trace, save, and scope by
  boundaries": add that while a trace is active, clicking the map SHALL NOT open a feature's
  description. Add a scenario: **WHEN** a user places a vertex on a building while tracing, **THEN**
  the vertex is added and no description opens. And when tracing ends or is cancelled, clicking a
  building describes it again.
- `docs/client-features.md` → the traced-boundaries row: add "feature popups pause while tracing".

## Outcome

## Tangents found
