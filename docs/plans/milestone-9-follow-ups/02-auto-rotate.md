# 02 — Rotate the scene automatically (#119)

## Goal

In fly mode, the scene slowly turns around the open area on its own, like a model on a turntable.
It stops while the user drags, zooms or walks, and resumes after a few idle seconds. A button turns
it on and off. It starts off for users who prefer reduced motion, and it never fights a staged build.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 119`.

## Code to read first

- `client/src/views/sceneView.ts`
  - Lines 65-69: the camera, `OrbitControls` (`maxPolarAngle = π/2.1`), and `createCameraModes(camera,
    controls, renderer.domElement, container)`.
  - Lines 87-95: the frame loop. It calls `controls.update()` (with no delta) only when
    `modes.mode === "fly"`, then `modes.update(delta)` and `staged.update(delta)`. The delta comes
    from a `THREE.Clock`.
  - `beginStaged` (121-144): starts a build. `build.handle.finished` resolves when the animation ends
    or the build is abandoned.
  - `setWorld` (100-120) and `showMessage` (145-154).
- `node_modules/three/examples/jsm/controls/OrbitControls.js` (three 0.186.1):
  - `autoRotate` (318) and `autoRotateSpeed` (329, default 2).
  - `update(deltaTime)` (697) rotates only while `state === NONE` (709). With a delta, the angle is
    `2π/60 · speed · delta` (936). Without one, it's a fixed angle per frame, so frame-rate dependent.
  - It fires `start` and `end` around a drag (1738, 1621), around each wheel step (1782, 1786), and
    around touch.
- `client/src/scene/cameraModes.ts`: the "Walk"/"Fly" button `.scene-mode` (39). It's appended to
  `container`, hidden until a world is loaded (`setWorld`, 125). In walk, `orbit.enabled = false`.
- `client/src/scene/exportButton.ts`: the "Download glTF" button `.scene-export` (15), appended to
  `container`.
- `client/src/style.css:105-139`: the overlays are placed with fixed pixel offsets. `.scene-toggle` is
  at top 12 / right 12, `.scene-mode` at top 48 / right 12, `.scene-export` at top 48 / right 84
  (a hand-measured gap left for the Walk button), and `.route-panel` at top 84 / right 12. A third
  button can't get a safe fixed offset, because the export label's width isn't fixed.
- `client/src/locations/flyTo.ts:91`: `prefersReducedMotion()` already exists. Reuse it.
- `client/src/scene/stagedScene.ts:213`: the waiting wireframe already spins on its own
  (`rotation.y += delta * 0.4`).

## Design

**Pure state, in `client/src/scene/autoRotate.ts`** (no three import, so it's testable):

```ts
export const IDLE_SECONDS = 5;
/** OrbitControls' autoRotateSpeed: 0.5 is one turn every two minutes when update() is given a delta. */
export const ROTATE_SPEED = 0.5;

export interface AutoRotate {
  readonly enabled: boolean;          // the user's choice (the button)
  setEnabled(on: boolean): void;      // turning it on rotates at once: no idle wait
  interactionStart(): void;           // OrbitControls "start"
  interactionEnd(): void;             // OrbitControls "end": the idle clock starts here
  /** Whether the camera should rotate this frame. */
  update(delta: number, context: { fly: boolean; world: boolean; building: boolean }): boolean;
}
export function createAutoRotate(enabled: boolean): AutoRotate;
```

The rule: rotate only when `enabled` and `fly` and `world` and not `building`, no interaction is in
progress, and at least `IDLE_SECONDS` have passed since the last `interactionEnd`. Leaving walk mode
or a build ending also restarts the idle clock, so the camera doesn't start moving the instant
control comes back.

**Wiring in `sceneView.ts`:**

- `const rotate = createAutoRotate(!prefersReducedMotion())`. Set `controls.autoRotateSpeed =
  ROTATE_SPEED`, and listen to `controls` `start` and `end` with `rotate.interactionStart` and
  `rotate.interactionEnd`.
- In `frame`: `controls.autoRotate = rotate.update(delta, { fly: modes.mode === "fly", world: !!world,
  building })`, then `controls.update(delta)`. Passing the delta also makes
  rotation independent of frame rate. Walk already skips `controls.update`, and `fly: false` keeps it
  off anyway.
- `building`: true from `beginStaged` until `build.handle.finished` resolves. **Decision: no rotation
  during a staged build.** The waiting wireframe already spins (`stagedScene.ts:213`), and two
  rotations at once make the build hard to follow. The build then plays out from a still camera,
  which also meets the issue's "never hides the build" criterion trivially. Rotation resumes
  `IDLE_SECONDS` after the build ends.
- Don't rotate the placeholder (`world` false). There's nothing to show.

**The button.** It reads "Rotate", with `aria-pressed` true or false. It's shown whenever the Walk
button is (a world is loaded), and disabled in walk mode.

- Put the buttons in a row instead of adding a third fixed offset. `sceneView` creates
  `<div class="scene-actions">` (absolute, top 48 / right 12, `display: flex; flex-direction:
  row-reverse; gap: 8px`).
- Pass it to `createExportButton` as its container. Give `createCameraModes` an optional fifth
  parameter `toolbar: HTMLElement = container` for its button only; the help overlay stays in
  `container`.
- Append the rotate button last, so the row reads, left to right: Rotate | Download glTF | Walk.
  Walk stays where it is today.
- In `style.css`, drop `position/top/right` from `.scene-mode` and `.scene-export`, and add
  `.scene-actions`. Check that `.route-panel` (top 84) still clears the row.
- No keyboard shortcut. `V` already toggles walk, and none was asked for.

Brief 03 relies on this: user movement is detected from OrbitControls' `start` event, so camera
moves made by auto-rotation never count as the user's.

## Tests

`client/src/scene/autoRotate.test.ts`:

- `createAutoRotate(false)` never rotates. `createAutoRotate(true)` with `fly`, `world` and not
  `building` rotates on the first frame.
- After `interactionStart`, it doesn't rotate, however long it is held. After `interactionEnd`, it
  stays still until `IDLE_SECONDS` of deltas have passed, then rotates.
- `fly: false` → no rotation. Returning to `fly: true` waits `IDLE_SECONDS` again.
- `building: true` → no rotation. When it goes false, it waits `IDLE_SECONDS`.
- `setEnabled(false)` stops it at once, and an idle period doesn't bring it back. `setEnabled(true)`
  rotates at once.

The button, the controls wiring and the CSS need a renderer. They stay out of tests: check them by
hand (it turns, stops on drag and wheel, resumes after about 5 s, the toggle works, and with "reduce
motion" on in the OS it starts off).

## Docs and specs

- `openspec/specs/showcase-client/spec.md`: add a requirement **"The client SHALL rotate the scene
  slowly in fly mode"**. Rotation stops while the user drags or zooms, and in walk mode or during a
  staged build. It resumes after five idle seconds. A button turns it on and off. It starts off when
  the user prefers reduced motion. Scenarios:
  - **WHEN** a user drags the scene, **THEN** rotation stops, and resumes five seconds after the
    drag ends.
  - **WHEN** the browser reports `prefers-reduced-motion: reduce`, **THEN** the scene opens without
    rotating, and the button turns rotation on.
- `docs/client-features.md` → UI brainstorm, "3D and export": add a "Turntable rotation (#119,
  shipped)" bullet in the style of the "Fly and walk" one.

## Outcome

Done as designed. `scene/autoRotate.ts` holds the pure state (with `autoRotate.test.ts`); `sceneView.ts`
creates a `.scene-actions` row (Rotate | Download glTF | Walk), passes it to `createExportButton` and
as the new optional fifth `toolbar` parameter of `createCameraModes`, and drives
`controls.autoRotate` each frame, then `controls.update(delta)`. `.scene-mode` and `.scene-export` lost
their absolute offsets. The line references held (sceneView had shifted by a few lines after briefs 01,
08 and 05; nothing material).

Decisions the brief left open: the Rotate button is hidden whenever the Walk button is (no world, and
during a staged build), and disabled in walk mode (set each frame). `update` resets the idle clock on
any non-fly or building frame, so a missing world does not itself delay the first rotation. The route
panel at top 84 clears the row (top 48, about 28 px tall); not checked in a browser.

Verified: `npx tsc --noEmit -p client` is clean. Tests were written but not run (CI is the gate); the
guard tests are not mutation-checked. The button, wiring and CSS are not checked by hand (no renderer
here). Spec requirement and the `docs/client-features.md` bullet added.

## Tangents found

None.
