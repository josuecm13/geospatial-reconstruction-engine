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

## Tangents found
