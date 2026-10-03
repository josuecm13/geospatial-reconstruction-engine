# 08 — Staged build animation on import (#67)

## Goal

When a user imports a place, it appears to be built in front of them, stage by stage, driven by the
server's event stream from brief 02: ground, then streets, then blocks, then buildings rising ring by
ring from the centre out. Reopening an already imported area shows the finished scene with no animation.

Read the issue **and its comment**: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 67 --comments`.
The comment changes the first criterion: with #90 in place, the client reveals each stage as its
event arrives, rather than playing a generic animation while one request runs.

## Depends on

- Brief 02: `POST /import-areas` with `background: true` → 202 `{import_area_id, events_url}`; the
  SSE stream at `GET /import-areas/{id}/events`. The stages and their `data` are in brief 02's table.
- Brief 06: the World contract (`ground`, `area_features`, `roads`, `blocks`, `buildings`, and
  `generated` groups; `<layer>:<id>` names; `toLocal`).
- If brief 03 landed: the `fetched` event carries `inner_area_ids`. Load those areas' map-data at
  once and show them fully built (they exist already). The ring then grows outside them.

## Design

- `client/src/api/client.ts`: add `startImport(bbox): Promise<{import_area_id: string; events_url: string}>`
  (sends `background: true`) and `importEvents(areaId): EventSource`. The URL goes through the same
  base URL as other calls (`/api` prefix in dev; Vite proxies SSE fine). Add the event payload types
  to `types.ts`.
- `client/src/scene/stagedBuild.ts` (pure state machine, tested):
  - Input: the stream of `{stage, data}` events. Output: an ordered list of **reveal steps**
    (`{layer, features, ring?}`) plus a `done | failed(code)` end state.
  - Order guaranteed to the view: `ground` (area features plus POIs) → `roads` → `blocks` →
    `buildings` (one step per ring) → `generated` (a reserved slot, skipped when absent) → done. The
    server already sends them in this order. The state machine still enforces it, and ignores an
    event that arrives out of order or twice (it can happen on an `EventSource` reconnect, since
    `Last-Event-ID` is automatic).
  - The issue lists the reveal order as "ground, streets, buildings, then blocks". The server streams
    blocks before buildings, because buildings link to blocks. **Keep the server's order, and reveal
    the blocks overlay last**: hold the `blocks` step and play it after the final buildings ring.
    Record this under Outcome.
- `client/src/scene/buildAnimation.ts` (Three.js; untested):
  - Ground and roads fade in over 0.6 s (material opacity per group, using a cloned material only
    during the animation).
  - Buildings in each ring **rise**: the mesh's `scale.y` goes from 0 to 1 over 0.8 s with an
    ease-out, staggered by 20 ms within a ring.
  - Before `fetched` arrives (the Overpass fetch can take 15–20 s), a generic "building the map"
    animation plays: a slowly rotating wireframe of the rectangle's ground with a pulsing label.
  - **Skip**: a "Skip animation" button jumps every pending step to its final state at once.
- **Wiring.** The import panel's import button calls `startImport`, then switches to the Scene tab
  and drives `stagedBuild` from `importEvents`. On `completed`, refresh the area list and the 2D
  layers as today. On `failed`, report `data.code` through brief 04's reporter (a `failed` event
  carries `code`, `message`, and `details`, the same as an `ApiError`; build one from it).
- **Reload or reopen**: opening an area from the list, or on page load, uses brief 06's normal
  `mapData` path, with no animation.
- Keep the synchronous import available in the API client (`importArea`) for tests and scripts. The
  UI uses the background path.

## Tests (`stagedBuild.test.ts`)

The full stage order; duplicate and out-of-order events ignored; blocks revealed after the last ring;
the `generated` slot skipped; `failed` mid-way ends with that code and plays no later steps.

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL build an imported place in stages as the
  server streams them"**, with scenarios for the reveal order, skip, and reopening without animation.
- `docs/client-features.md` → UI brainstorm / Import: the staged build.
- `tasks.md`: tick `1.16 #67`.

## Outcome

Built as briefed. `api/client.ts` gained `startImport` and `importEvents`; `api/types.ts` the stage payload
types (`StageData`, `StageEvent`, `IMPORT_STAGES`) and the codes `import_in_progress` / `import_job_not_found`
(with sentences in `importing/errorMessages.ts`). New modules:

- `scene/stagedBuild.ts` (pure, tested): the state machine. A stage is accepted only if it ranks after
  everything seen (`fetched, ground, roads, blocks, buildings, generated, completed`); `buildings` repeats
  while its `ring` rises. It also emits a `fetched` step (nothing to draw; it ends the waiting animation and
  carries `inner_area_ids`). The blocks step is held and released by `generated` or `completed`, so blocks
  are revealed after the last ring, as the brief decided (the issue lists buildings before blocks; the
  server streams blocks first because buildings link to them). `failed` drops the held blocks and plays nothing more.
- `scene/buildAnimation.ts`: `Animator` (fade over 0.6 s on cloned materials, rise over 0.8 s with ease-out,
  `skip`) plus pure timing helpers (tested). The 20 ms stagger is squeezed so a ring never takes more than 1.5 s
  to start its last building (a ring of 300 would otherwise take 6 s). That is a deviation from "20 ms within a ring".
- `scene/stagedScene.ts`: the live world for a build (same group layout as `buildWorld`), the waiting
  wireframe, the "Building the map" label and the Skip button, and a queue that plays steps one after another.
  The server emits all stages in a burst after persisting, so the pacing is the client's. Each step is
  built by calling `buildWorld` on a map-data holding only that layer and moving its meshes across.
  The ground plane is drawn from the rectangle (area features alone would give a 200 m square).
- `importing/stagedImport.ts` (tested with a fake stream): `runStagedImport` starts the job, opens the
  scene, feeds the events through the state machine, and resolves with the completed area or rejects with an
  `ApiError` built from the `failed` event (`network_error` if `EventSource` gives up reconnecting).
- `SceneLoader.suspend()` / `resume()` (tested): while a build plays the loader doesn't load, so the
  selection change from opening the new area doesn't replace the build mid-animation. When it ends, `resume`
  loads the selection from map-data (the finished area, or the previous one after a failure). So the final world
  is always the normal map-data one, and reopening an area takes the same path with no animation.

Wiring: `ImportPanel` takes an optional 7th constructor argument (`StagedTarget`), and `main.ts` provides it
(open the Scene tab, suspend the loader, `sceneView.beginStaged(bbox)`). `sceneView.ts` has one new method
(`beginStaged`), a `staged.update(delta)` call, and a `createStagedScene` line. `exporter.setBusy(true)`
when a build starts, `false` when it finishes. Without a target the panel still uses the synchronous `importArea`.

Decisions:
- Inner areas (`fetched.inner_area_ids`): each one's map-data is fetched and added at once, offset by the
  difference of the two projection origins (each area's projection is centred on its own rectangle). Its
  ground is left out. Its roads are kept, so the outer `roads` step draws the same roads again on top (same
  colour, same plane).
- A `failed` import (or a lost stream) discards the build and returns to the Map tab by setting
  `location.hash = "#map"`, where the panel's status shows the error sentence.
- When the build ends, the camera is re-framed by the normal `setWorld`, so a user who flew around during the
  build is moved back to the overview. Not fixed here.
- Not run locally (CI only): `tsc --noEmit -p client` is clean, tests included. Guards are not mutation-checked.
  `stagedScene.ts`/`buildAnimation.ts`'s drawing needs WebGL and was never seen running; a human should
  import a place once and watch it. Blocks fade in even though the overlay group is hidden until the checkbox is ticked.

## Tangents found

- `main.ts` sets `location.hash` directly to switch tabs (twice, in the `stagedTarget`). Brief 13 (pages and
  URL state) should replace those two lines with its navigation function.
- Server `ground`/`roads`/`blocks`/`buildings` events all arrive in a burst after the whole import is persisted
  (brief 02 emits late), so the only real wait the user sees is `fetched`, and the build is paced by the client.
  True progressive persistence would need the sweep reworked. Not worth a ticket unless the burst proves too abrupt.
- The outer area's `roads` stage re-sends roads that lie inside an inner area (only buildings, POIs and area
  features are skipped there), so with nested areas those roads are drawn twice during the build.
