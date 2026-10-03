# 10 — Export the scene as glTF (#69)

## Goal

A "Download glTF" button in the Scene tab saves the current world as a binary `.glb` that passes the
Khronos glTF validator with no errors and opens in Blender. Its metadata records the scope, the
projection origin, and the OpenStreetMap attribution. Its nodes are named by layer and entity id.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 69`.
Milestone 8 decided that meshes are produced client-side (MILESTONES.md → Milestone 8). Don't add a
server endpoint.

## Depends on

Brief 06: the World contract. The `world` group already has `<layer>:<id>` mesh names and
`world.userData = {scope, projection, attribution}`.

## Design

- `client/src/scene/exportGltf.ts`:
  - `exportWorld(world: THREE.Group): Promise<ArrayBuffer>` uses `GLTFExporter`
    (`three/examples/jsm/exporters/GLTFExporter.js`) with `{binary: true, onlyVisible: true}`. Export
    **only the world group**, not lights, helpers, route markers, or the empty-state placeholder.
    Exporting a group puts its `userData` into the node's `extras`.
  - Metadata: set `world.userData` to
    `{ generator: "geospatial-reconstruction-engine", scope, projection: {origin, meters_per_degree_latitude, meters_per_degree_longitude}, attribution: "© OpenStreetMap contributors", axes: "x east, y up, z south; meters" }`.
    The exporter writes the root node's userData into its `extras`. Also set the asset copyright: in a
    `GLTFExporter` plugin's `afterParse(input)` hook, set `json.asset.copyright = attribution` on the
    writer's JSON (read the exporter source for the exact hook name in this three.js version, 0.186).
  - Meshes keep their `<layer>:<id>` names, which the exporter writes as node names. Shared materials
    export once.
  - Remove per-mesh `userData.properties` before exporting if it makes the file large. Keep `layer`
    and `id`. Decide by file size on a real area, and record it under Outcome.
  - `downloadGlb(buffer, fileName)`: a Blob, an object URL, and a temporary `<a download>`. The file
    name is `gre-<scope type>-<scope id first 8>.glb`.
- The button sits in the scene view's corner, next to the walk toggle (brief 07), and is disabled
  until a world is loaded and while a staged build is running (brief 08).

## Validation (acceptance criterion: "passes the Khronos validator with no errors")

- Add the dev dependency `gltf-validator` (the official Khronos npm package). Write
  `client/src/scene/exportGltf.test.ts`: build a world from a small hand-written `MapData` fixture
  with brief 06's `buildWorld`, export it, run `validateBytes(new Uint8Array(buffer))`, and expect
  `issues.numErrors === 0`. Also assert that the node names include `building:<fixture id>`, and that
  the root's extras carry the projection origin.
- `GLTFExporter` in binary mode uses `Blob` and `FileReader`. If the vitest `node` environment
  lacks them, set `// @vitest-environment jsdom` at the top of this test file (jsdom is already a dev
  dependency). If it still can't run headless, keep the test for the parts that can (names, extras via
  `binary: false` JSON output), and record that the validator check must be done by hand.
- "Opens in Blender" is checked by a human. Leave a checkbox for it in the PR description.

## Docs and specs

- Spec delta `showcase-client`: add **"The client SHALL export the scene as glTF"**, with scenarios
  for the metadata and the node naming.
- `docs/client-features.md` → 3D and export: glTF export done.
- `tasks.md`: tick `1.18 #69`.

## Outcome

## Tangents found
