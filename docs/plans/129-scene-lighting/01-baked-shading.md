# 01 — Baked, math-based shading for the 3D scene (#129)

Model: sonnet. Branch: `work/129-shading`, from `feat/129-consistent-scene-lighting`. Commit, don't push.
Don't run the test suites (`npm test`, `npm run build`); CI is the gate. `npx tsc --noEmit -p client`
and similar single-file checks are fine.

## Decision: bake the shade into vertex colours, render unlit

The issue requires the glTF export to carry the same colours and shading as the viewer. Real-time
three.js lights can't do that: the export leaves lights out, and any glTF viewer relights PBR
materials its own way. So the scene computes the shade itself, per face, and draws unlit:

- `shade(n) = AMBIENT + (1 − AMBIENT) · max(0, n · LIGHT_DIRECTION)`, with `n` the face's unit
  normal in world orientation, `LIGHT_DIRECTION` a fixed normalized vector pointing *toward* the
  light, `AMBIENT` a fixed constant in (0, 1).
- Each geometry gets a `color` attribute holding `shade` (grey, r = g = b) on every vertex of the
  face. Shared materials become `MeshBasicMaterial({ color: <palette colour>, vertexColors: true })`.
  The final colour is palette colour × shade, so a face pointing straight at the light is exactly
  its palette colour. (three.js multiplies in linear space; that's fine and worth one comment line.)
- GLTFExporter writes `MeshBasicMaterial` as `KHR_materials_unlit` with `COLOR_0`, so the file
  looks the same as the viewer. Verify that against the exporter source in node_modules rather than
  trusting this line.
- No lights remain in the scene view or the landing stage (`client/src/landing/featuredStage.ts`
  has a copy of the same sky + sun; remove it there too, it would be dead code).

## Work

1. `client/src/scene/shading.ts` (new): `LIGHT_DIRECTION` (a frozen, normalized `THREE.Vector3` —
   pick something like normalize(-0.4, 1, 0.3) so walls facing different ways read differently;
   say in a comment why that one), `AMBIENT` (≈ 0.55), `shade(normal)`, and
   `shadeGeometry(geometry)`: converts an indexed geometry to non-indexed (flat faces need their
   own vertices), computes each triangle's normal **from its positions** (don't trust existing
   normal attributes), and writes the `color` attribute. Returns the geometry. Document the formula
   in the module doc comment exactly as above.
2. Every scene geometry goes through `shadeGeometry` once its orientation is final (after the
   `rotateX` in `extrude.ts`; `PlaneGeometry`s in `buildWorld.ts`, the placeholder ground in
   `sceneView.ts`, the route ribbon and the marker cones in `routeLayer.ts`). Meshes must not carry
   a rotation the shade can't see: bake the placeholder ground's `rotation.x` into its geometry.
   Meshes are only translated and scaled on y (build animation, `scale.y` 0→1); walls stay vertical
   and roofs flat, so the baked shade stays right. Say so in a comment in `shading.ts`.
3. `palette.ts`: becomes the only source of scene colours. Add the scene background, the placeholder
   grid's two colours, the route ribbon, origin and destination markers, and the waiting wireframe
   (`stagedScene.ts:107`, currently `#6f5a8c` inline — reuse `buildingMeasured` or name it). Export
   materials for them from `MATERIALS` (one per kind). Switch `flat`/`decal` to `MeshBasicMaterial`
   with `vertexColors: true`; keep `depthWrite`, transparency, `side` as they are. The wireframe and
   grid lines are lines/wireframes, not faces: they take a palette colour and no shade.
4. `sceneView.ts`, `routeLayer.ts`, `stagedScene.ts`: no inline colours or `new …Material(` — import
   from the palette. Remove the `HemisphereLight` / `DirectionalLight`.
5. `buildAnimation.ts` `fadeIn` clones materials; make sure a clone keeps `vertexColors` (it does
   via `Material.clone`, just confirm).
6. Tests (vitest, no WebGL):
   - `shading.test.ts`: `LIGHT_DIRECTION` has length 1; `shade(LIGHT_DIRECTION) === 1`;
     `shade(-LIGHT_DIRECTION) === AMBIENT`; a face at 90° to the light is `AMBIENT`; shade stays in
     [AMBIENT, 1] over a sweep of random unit normals; `shadeGeometry` on an extruded box gives two
     faces with the same orientation the same colour regardless of position, and every vertex of a
     triangle the same colour.
   - `palette.test.ts`: reads (via `fs`) every non-test `.ts` under `client/src/scene` except
     `palette.ts`, plus `client/src/views/sceneView.ts`, and asserts none contains a hex colour
     literal (`#rgb`/`#rrggbb` in a string, or `0x` + 6 hex digits) or `new THREE.*Material(`.
     Name the offending file and match in the failure message.
   - Update existing tests that assert Lambert materials or lights (`exportGltf.test.ts`,
     `buildWorld.test.ts`, anything else `grep -rn Lambert client/src` finds). In
     `exportGltf.test.ts`, assert the exported materials are unlit (`KHR_materials_unlit` in
     `extensionsUsed`) and the mesh primitives carry `COLOR_0`.
7. Docs: one requirement in `openspec/specs/showcase-client/spec.md` stating the shading rule
   (formula, fixed light, palette-only colours, export matches the viewer), with a scenario; a short
   note in `docs/client-features.md` where the 3D scene is described.

Out of scope: the 2D map's colours in `client/src/views/mapDataLayers.ts` and the location card
previews in `client/src/locations/preview.ts` duplicate some palette values; leave them, note them
in your report.

## Report

Files changed, the light direction and ambient you picked and why, what you verified in the
GLTFExporter source, and anything that didn't fit this brief. One commit per logical step is fine;
Conventional Commits, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
