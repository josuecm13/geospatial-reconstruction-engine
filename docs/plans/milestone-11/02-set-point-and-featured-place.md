# 02 — The Set point tool, and choosing the landing page's place (#23)

Model: sonnet. Branch: `work/m11-point-featured`, from the tip of
`origin/feat/23-generated-block-content`. **One commit per numbered part**, and don't push.
`python3 -m py_compile` and `cd client && npx tsc --noEmit` are fine (run `npm ci` first if
node_modules is missing). No suites: CI is the gate.

Read `docs/plans/milestone-11/00-decisions-and-contract.md` (the "contract"). The parts you own are
§8's `settings/featured-area` endpoints and §9's **Set point** and **Featured place** bullets. Nothing
in this brief touches generation. Keep the client's token rule (`styleTokens.test.ts`), keep motion
under `prefers-reduced-motion: no-preference`, and keep WebGL out of tests: pure logic goes next to
its `*.test.ts`.

## 1. The Set point tool (client)

Read `client/src/scene/cameraModes.ts`, `collision.ts` (`nearestRoadStart`, `resolveMove`),
`views/sceneView.ts`, `scene/routeLayer.ts` (how it raycasts the ground), and `scene/terrain.ts`
(`heightAtLocal`).

- **The tool:**
  - A **Set point** button in the scene toolbar, with the shortcut `P`.
  - With the tool active, a click on the ground sets the pin. Double-click on the ground sets it at any
    time.
  - A small marker with a ground ring sits at the terrain height. It's excluded from raycast picking,
    like the building edges, and from the glTF export: `exportGltf.ts` exports `onlyVisible`, so hide
    it during export, or keep it outside the world group, which is simpler.
- **Fly mode:**
  - Ease the OrbitControls target to the pin over about 400 ms, keeping the camera's offset (distance
    and angle). It's instant when the user prefers reduced motion.
  - Turn on `controls.zoomToCursor = true` (three.js OrbitControls supports it; check the installed
    version).
- **Walk mode:**
  - Starts at the pin, at eye height on the terrain, facing the camera's horizontal direction.
  - If the pin is inside a building footprint, it moves to the nearest open point.
  - Without a pin, walk mode behaves as today (`nearestRoadStart`).
- **Reset to centre** clears the pin, and the target goes back to the area's centre.
- **Pure helpers with tests:** easing (target interpolation), the walk start (heading from the camera
  direction, a pin inside a footprint moving to open ground), and pin placement on the terrain height
  (`terrain.heightAtLocal`).

## 2. The featured place (server and client)

- **Server:**
  - A migration creating `site_settings` (contract §8). A model, and a small
    `SiteSettingsRepository`.
  - `GET` and `PUT /settings/featured-area` in a new router (`api/routers/settings.py`), registered in
    `main.py`, with 404 `import_area_not_found` and 409 `import_area_not_ready` as in the contract.
  - **Deleting an area that's featured clears the setting.** Do it in `ImportAreaRepository.delete`
    (delete the key when its value equals the area id), and add a test.
  - API tests in `server/tests/api/test_settings.py`:
    - unset → null;
    - set a completed area → read back;
    - unknown → 404;
    - not completed → 409;
    - null clears it;
    - deleting the featured area clears it.
- **Client:**
  - `api/client.ts` gets `featuredArea()` and `setFeaturedArea(id | null)`, with tests in
    `client.test.ts`.
  - **`landing/featured.ts` and `pages/landing.ts`:** the order is the server setting, then
    `VITE_FEATURED_AREA_ID`, then the most recent completed import. A failed settings request falls
    through to the next source. Update `featured.test.ts`.
  - **`pages/locations.ts` and `locations/card.ts`:**
    - each completed card gets **Show on landing**, using the existing quiet-button style, like
      Delete;
    - the featured card shows a **Featured** badge instead, with **Remove from landing**;
    - the gallery reads the setting on load and updates without a reload.
  - Add a `card.test.ts` case.
- **Docs:**
  - `docs/client-features.md`: rows for the settings endpoints and the pin tool.
  - The `docs/runbook.md` and `client/.env.example` mentions of `VITE_FEATURED_AREA_ID` should say it's
    now a fallback.
  - Don't edit `openspec/`.

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(client): set a point for the camera to orbit and for walk mode to start (#23)`
2. `feat: choose the landing page's featured place from the Locations page (#23)`

Report:
- the SHAs, and `git show --stat` for each;
- how the marker is kept out of picking and export;
- the OrbitControls version and `zoomToCursor` support;
- anything in the contract that didn't fit.
