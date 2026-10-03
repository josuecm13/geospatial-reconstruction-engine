# 07 — Explore the scene by flying and walking (#66)

## Goal

Two camera modes in the Scene tab, with one control to switch between them: **fly**
(orbit/pan/zoom, as today) and **walk** (first person at eye height, on the ground, unable to pass
through buildings, starting on a road near the centre).

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 66`.

## Depends on

Brief 06: its World contract (`world` group; `buildings` and `roads` children; mesh names
`<layer>:<id>`; local meters with x east, z south, y up) and `sceneView.setWorld`.

## Design

- `client/src/scene/collision.ts` (pure, tested; no Three.js import):
  - `buildFootprintIndex(footprints: {id: string; ring: {x,z}[]}[], cellSize = 25)`: a uniform grid
    keyed by cell, each cell listing the footprints whose bounding box overlaps it.
  - `resolveMove(index, from: {x,z}, to: {x,z}, radius = 0.3): {x,z}`. If the circle of `radius` at
    `to` overlaps no footprint, return `to`. Otherwise **slide**: try moving along x alone, then along
    z alone, and return the first that's free. Otherwise stay at `from`. Overlap test: inside the
    polygon (ray casting), or within `radius` of any edge (point–segment distance).
  - `nearestRoadStart(roadOutlines: {x,z}[][], center = {x: 0, z: 0}): {x,z}`: the centroid of the
    road outline closest to `center`, falling back to `center` itself when there are no roads.
- The footprints come from map-data (the same local rings brief 06 extrudes). Have `buildWorld`
  also return, or attach to `world.userData`, the list of `{id, ring}` building footprints and the
  road outlines, so walking doesn't re-parse meshes. If brief 06 didn't expose them, add
  `world.userData.footprints` / `world.userData.roadOutlines` there. That small extension to
  `buildWorld` is in scope.
- `client/src/scene/cameraModes.ts`:
  - **Fly**: the existing `OrbitControls`.
  - **Walk**: `PointerLockControls` (`three/examples/jsm/controls/PointerLockControls.js`). Click
    the canvas to lock, Escape to release. WASD or the arrow keys move at 1.4 m/s, Shift runs at
    4 m/s. Each frame: compute the desired next position, pass it through `resolveMove`, and keep the
    camera at y = **1.7 m**.
  - Entering walk puts the camera at `nearestRoadStart`, facing north (`-z`). Returning to fly
    restores the previous orbit view.
  - A small help overlay while walking: "WASD to move · Shift to run · Esc to release the mouse".
- **One toggle** in the scene view's corner: a button reading "Walk" in fly mode and "Fly" in walk mode.
  The `V` key does the same.
- The render loop (`sceneView.ts`) passes a frame delta (`THREE.Clock`) to the active mode.

## Tests (`collision.test.ts`)

A square building at (0..10, 0..10): moving from outside into it is blocked, sliding along the
x-axis wall works, a move that clips a corner within the radius is blocked, and a far-away move is
untouched. `nearestRoadStart` picks the closest outline. The grid index returns the same answer as a
brute-force check over a few random points (seeded).

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL let a user fly over and walk through the
  scene"**, with a scenario that walking into a building stops at its wall.
- `docs/client-features.md` → 3D and export: flying and walking.
- `tasks.md`: tick `1.15 #66`.

## Outcome

## Tangents found
