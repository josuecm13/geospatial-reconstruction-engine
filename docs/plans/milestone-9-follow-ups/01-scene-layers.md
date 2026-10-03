# 01 — Scene layers stop overlapping (#118)

## Goal

The flat layers of the 3D scene (ground, area features, roads, the buildable-area overlay) flicker
through each other, and yellow is what the user notices. Make them draw in a fixed order that does
not depend on the depth buffer, so nothing flickers at any distance in fly mode or at street level in
walk mode.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 118`.

What the issue gets right, and what it misses (checked against the code):

- Right: the layers sit 2 to 5 cm apart (`LAYER_Y` in `client/src/scene/buildWorld.ts:13`:
  `area_features: 0.02, blocks: 0.03, roads: 0.05`, ground at y = 0) with no depth offset.
- Missed: some overlaps are **exactly coplanar**, so no amount of depth precision fixes them:
  - Road junctions where a `wide` road (yellow, `COLORS.roadWide` `#e0a33a`) meets a `normal` or
    `narrow` one. Every road mesh is at `LAYER_Y.roads`, and the road polygons overlap at the node.
  - Area features that overlap each other (water inside a park). All are at `LAYER_Y.area_features`.
  - The placeholder ground and its grid (`client/src/views/sceneView.ts:41-43`): a `PlaneGeometry`
    and a `GridHelper`, both at y = 0.
- Probably wrong about which yellow: the buildable overlay is hidden unless "Show buildable area" is
  ticked. With it unticked, the yellow the user sees is the wide roads.
- A note from Milestone 9 said "blocks fade in even though the overlay group is hidden until the
  checkbox is ticked". **That's false.** `beginStaged` sets the staged world's `blocks` group to
  `buildable.checked` (`sceneView.ts:128`). `take()` in `stagedScene.ts:136-140` moves the block meshes
  into that group, and three.js doesn't render the children of an invisible group. `fadeIn`
  (`buildAnimation.ts:55-86`) only swaps materials and never touches `visible`. Blocks appear during
  a build only when the box is ticked.

## Code to read first

- `client/src/views/sceneView.ts`
  - Line 65: `new THREE.PerspectiveCamera(50, 1, 1, 5000)`, so near = 1 m. `setWorld` (115) and
    `beginStaged` (138) set `far = max(5000, size * 10)`. Far barely matters for precision. Near does.
  - Lines 112-118 and 136-141: the camera is framed at `(0, 0.6·size, 0.7·size)` from the centre, a
    distance of about 0.92·size. For a 1 km² rectangle, size = hypot(1000, 1000) ≈ 1414 m, so the
    camera starts about 1300 m away.
  - Lines 40-44: the placeholder ground plus `GridHelper`, both at y = 0.
- `client/src/scene/buildWorld.ts`: `LAYER_Y` (13). Area features (62-70), roads (72-83), blocks (85-93,
  group hidden at 93), buildings (95-110), ground plane at y = 0 (115-119). Meshes share the
  materials from `palette.ts`.
- `client/src/scene/palette.ts`: `MATERIALS`, all `MeshLambertMaterial` with `flatShading`.
  `buildable` is `transparent: true, opacity: 0.45, side: DoubleSide` (29). `depthWrite` is left at
  three's default (`true`), even on the transparent one.
- `client/src/scene/stagedScene.ts`: `groundFor` (61-71) builds its own ground mesh, a copy of
  `buildWorld`'s ground code. Steps move meshes out of partial `buildWorld` results with `take()`
  (136-140), so per-mesh properties set in `buildWorld` carry over.
- `client/src/scene/buildAnimation.ts`: `fadeIn` clones each material (`original.clone()`, which copies
  `depthWrite`), sets the clone `transparent = true`, and puts the original back at the end.
- `client/src/scene/routeLayer.ts`: `ROUTE_Y = 0.08` (8). The ribbon uses an opaque `MeshBasicMaterial`
  (15) with the default render order.

## Why it flickers

A 24-bit perspective depth buffer resolves about `d² / (near · 2²⁴)` meters at distance `d`. With
near = 1 m, that's about 1 cm at 410 m, 3 cm at 710 m, and 10 cm at 1300 m, the starting view of a
1 km² area. So blocks against area features (1 cm apart) fight from about 400 m, and roads against
area features (3 cm) from about 700 m. Coplanar overlaps (junctions of different lane types, water in
a park, the placeholder grid) fight at every distance, because their depths are equal.

## Design

Draw the ground-level layers in a fixed order, without writing depth. This is the usual way to
draw decals on a ground.

The invariant that makes it safe: everything in the scene is at or above the ground plane, and the
camera is always above it (fly is capped at `maxPolarAngle = π/2.1`; walk sits at 1.7 m). A ray from
such a camera that hits an object above the ground hits it **before** it reaches the ground. So a
flat layer at ground level is never in front of a building, the route ribbon, or the markers.
Ground layers therefore never need to write depth. They only need a fixed order among themselves.

1. **`palette.ts`**: give every flat material `depthWrite: false`: `ground`, `green`, `water`,
   `roadNormal`, `roadWide`, `roadNarrow`, and `buildable`. Leave `depthTest` on, so the overlay
   (drawn in the transparent pass, after buildings) is still hidden behind buildings. Building
   materials keep `depthWrite: true`. `fadeIn`'s clones copy `depthWrite`, so builds keep it.
2. **`buildWorld.ts`**: export a render-order table and set `mesh.renderOrder` on every flat mesh.
   The values are negative, so everything at the default 0 (buildings, the route ribbon and markers,
   the staged waiting wireframe) draws after them with normal depth testing:
   ```ts
   /** Draw order of the ground-level layers, lowest first. They write no depth (palette.ts), so this order alone decides what shows on top. */
   export const LAYER_ORDER = { ground: -50, green: -40, water: -39, roadNarrow: -30, roadNormal: -29, roadWide: -28, blocks: -20 } as const;
   ```
   Water sits above green, so a pond in a park shows. Wide roads sit above normal ones, which sit
   above narrow ones, so a junction shows the bigger road whole. The buildable overlay is last.
   Within a layer, meshes that share a material can't flicker against each other, because they're
   the same color. Keep `LAYER_Y` as it is: glTF has no render order, so the export still needs the
   physical separation for other viewers. Update its comment to say so.
3. **One ground builder.** Export `groundPlane(minX, maxX, minZ, maxZ): THREE.Mesh` from
   `buildWorld.ts` (name, rotation, position, material, render order) and use it in both `buildWorld`
   and `stagedScene.ts`'s `groundFor`, so the two grounds can't drift apart. This small refactor is
   in scope because the render order has to be set in both places.
4. **Placeholder** (`sceneView.ts:41-43`): give `placeholderGround` its own material with
   `depthWrite: false` and `renderOrder = LAYER_ORDER.ground`. The `GridHelper` then draws over it.
5. **Not chosen:**
   - `logarithmicDepthBuffer`: it costs fragment-shader depth writes and early-z, and does nothing for
     the coplanar overlaps.
   - A larger near plane: it only helps fly mode, needs switching per mode, and also leaves the
     coplanar cases.
   - `polygonOffset` per layer: it is per material, with GPU-dependent units, and coplanar layers of
     different materials would still need an order. Render order alone is deterministic.
   - Changing the route ribbon: it is opaque at default order and still depth-tests against
     buildings. With the ground layers no longer writing depth, it always shows over the roads.

## What a human checks

Whether this is fixed can only be judged by looking. This is an acceptance step, not optional.
Run `./scripts/dev-up.sh`, then `npm run dev` in `client/`. A dev server is fine; the test suite
still runs only in CI. Open a real, dense area of about 1 km² with wide roads, a park with water,
and blocks:

- **Far:** the default overview, then zoom out to the maximum. Orbit slowly. Watch for flicker at
  junctions where yellow wide roads meet white ones, where roads cross parks or water, and at water
  inside parks.
- **Near:** zoom to about 50 m over a junction. Then press `V` and walk along a wide road at street
  level.
- Tick "Show buildable area": the yellow overlay sits over the ground and area features, translucent,
  with no shimmer, and hidden behind buildings.
- The placeholder (Scene tab with nothing open): the grid lines are steady.
- A staged import: layers fade in without flashing through each other.
- Draw a route: the pink ribbon shows over the roads, and is hidden behind buildings.

Record what you checked, at which area and distances, under `## Outcome`. If you couldn't run the
browser, say so plainly: the issue then stays open for the user to verify.

## Tests

`client/src/scene/buildWorld.test.ts`, extended. These pin the settings, not the pixels:

- Every flat material (`ground`, `green`, `water`, the three roads, `buildable`) has
  `depthWrite === false`. Both building materials have `depthWrite === true`. `buildable` is still
  `transparent` with opacity 0.45.
- In the fixture world, each mesh's `renderOrder` matches its layer. ground < area feature < road <
  block, all below 0, and buildings at 0. Add a green area feature and a wide road to the fixture, to
  assert green < water and normal road < wide road.
- `groundPlane` returns a mesh named `ground:plane` with `LAYER_ORDER.ground`. If `groundFor` stays
  private, a `stagedScene.test.ts` case isn't needed: the shared helper is the guarantee.

These are guard tests and can't be mutation-checked without local runs. Say "not mutation-checked" in
the commit body.

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, requirement "The client SHALL build a low-poly 3D scene
  from map-data": add a sentence saying the flat layers SHALL draw in a fixed order (ground, area
  features with water over green, roads with wider lane types over narrower, then the buildable
  overlay) that doesn't depend on camera distance. Add a scenario: **WHEN** the camera is zoomed out
  to its farthest over an area with a wide road crossing a normal one, **THEN** the junction shows the
  wide road whole, with no flicker.
- `docs/client-features.md`: no row changes (no capability changes).

## Outcome

## Tangents found
