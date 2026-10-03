# 03 — Keep the camera when a staged build ends (#112)

## Goal

When a staged build finishes, the finished area is loaded and drawn by `setWorld`, which always
moves the camera back to the overview. A user who flew somewhere during the build loses that view.
Keep the view of a user who moved the camera during the build. Give the overview to one who didn't.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 112`.

The claim holds. `setWorld` (`client/src/views/sceneView.ts:111-119`) always sets
`controls.target` and `camera.position` from the new world's bounding box.

## Depends on

Brief 02 (soft, same file). It adds auto-rotation, which moves the camera without the user. That's
why "moved" below means an OrbitControls `start` event, not a changed camera position.

## Code to read first

- `client/src/views/sceneView.ts`
  - `setWorld` (100-120): replaces the world. It then frames it: box centre as the target, the camera
    at `(cx, cy + 0.6·size, cz + 0.7·size)`, and `far = max(5000, 10·size)`.
  - `beginStaged` (121-144): frames the rectangle the same way around the origin and returns
    `build.handle`.
  - `showMessage` (145-154): shown for errors and the empty hint.
- `client/src/pages/explore.ts:203-219` (`stagedTarget.begin`): suspends the `SceneLoader`, calls
  `beginStaged`, and calls `sceneLoader.resume()` once `handle.finished` resolves. Its `abandon`
  wrapper also navigates back to the map.
- `client/src/scene/sceneLoader.ts`: `resume()` (56-60) clears `loadedKey` and loads the selection.
  That `setWorld` is the one that re-frames, both after a completed build and after an abandoned one
  (it then reloads the previous area).
- `client/src/scene/stagedScene.ts`: `StagedHandle` (21-32). `abandon()` resolves `finished` too, so
  `finished` alone can't tell success from failure.
- During a build, walking is impossible: `beginStaged` calls `modes.setWorld(undefined)`, which hides
  the Walk button, and `enterWalk` returns early without a world (`cameraModes.ts:51`). So the only
  way to move the camera during a build is the orbit controls.

## Design

**Pure policy, in `client/src/scene/framing.ts`** (no WebGL; three's math classes are fine):

```ts
/** Whether the next world gets the overview camera, or keeps the user's view after a staged build they moved in. */
export interface FramingPolicy {
  stagedStarted(): void;      // beginStaged
  userMoved(): void;          // OrbitControls "start"; ignored unless a staged build is pending
  reset(): void;              // abandon, showMessage: the next world is framed
  /** Called by setWorld: true to frame. Consumes the staged state either way. */
  shouldFrame(): boolean;
}
export function createFramingPolicy(): FramingPolicy;

/** The overview of a box: what setWorld and beginStaged both compute today. */
export function overview(box: THREE.Box3): { target: THREE.Vector3; position: THREE.Vector3; far: number };
```

`shouldFrame()` returns false only for the first `setWorld` after `stagedStarted()`, and only if
`userMoved()` came in between.

**Wiring in `sceneView.ts`:**

- `controls.addEventListener("start", () => framing.userMoved())`.
- `beginStaged`: call `framing.stagedStarted()`, then frame the rectangle as today. Wrap the returned
  handle so that `abandon()` calls `framing.reset()` before the original. A failed build then reloads
  the previous area at its overview, which is right, because the view was of a rectangle that's gone.
  explore wraps `abandon` again on top of this, which is fine.
- `showMessage`: call `framing.reset()`.
- `setWorld`: always update `camera.far` (`max(far today, overview(box).far)`) and call
  `updateProjectionMatrix`, because the finished world can be bigger than the rectangle. Move
  `controls.target` and `camera.position` only when `framing.shouldFrame()`.
- `overview()` replaces the duplicated framing arithmetic in `setWorld` and `beginStaged`.
  `beginStaged` frames a size from `bboxMeters`, so give `overview` a `size` overload, or build a box
  from the rectangle. Pick one.

If the user moved and then went to walk mode after the build ended, nothing changes: walking only
starts after `setWorld`.

## Tests

`client/src/scene/framing.test.ts`:

- With no staged build, `shouldFrame()` is true, even after `userMoved()` (moving in an already loaded
  area doesn't stop a later area from being framed).
- `stagedStarted()` then `shouldFrame()` → true (an untouched build gets the overview).
- `stagedStarted()`, `userMoved()`, `shouldFrame()` → false, then the next `shouldFrame()` → true
  (it's consumed once).
- `stagedStarted()`, `userMoved()`, `reset()`, `shouldFrame()` → true (an abandoned build).
- `overview()` of a 100 × 100 m box at the origin gives target (0, 0, 0), a position of
  (0, 0.6·s, 0.7·s) with s = the box diagonal, and far ≥ 5000. This matches today's numbers.

The view really staying put needs a renderer: check by hand. Import a place, orbit away during the
build, and the view stays. Import again without touching, and it ends at the overview.

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, requirement "The client SHALL build an imported place in
  stages as the server streams them": add that loading the finished area SHALL keep the camera if the
  user moved it during the build, and otherwise show the overview. Add a scenario: **WHEN** a user
  orbits the camera during a staged build, **THEN** the finished area replaces the build without
  moving the camera.
- `docs/client-features.md` → the "Staged build" brainstorm bullet: add "a camera moved during the
  build is kept".

## Outcome

## Tangents found
