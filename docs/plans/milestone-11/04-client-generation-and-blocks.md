# 04 — The client: generate, show and hide, blocks, selection and feedback, zones (#23)

Model: sonnet. Branch: `work/m11-client`, from the tip of `origin/feat/23-generated-block-content`
(the coordinator gives the commit). **One commit per numbered part**, and don't push.
`cd client && npx tsc --noEmit` is fine (run `npm ci` first if needed). No vitest, `npm test` or
`npm run build`: CI is the gate. Client only.

The server is built in parallel. Code against the **API contract** in
`docs/plans/milestone-11/00-decisions-and-contract.md` §8 and §9, not against server code. Keep the
token rule (`styleTokens.test.ts`: no colour literals outside `:root`), the map-colour scan, motion
under `prefers-reduced-motion: no-preference`, and WebGL out of tests: pure logic goes next to its
`*.test.ts`.

The Set point tool and the featured place are brief 02, already on the branch or landing in
parallel. Don't touch them. If brief 02 already edited `sceneView.ts`, add your controls alongside its
toolbar.

## 1. Types and API client

- `api/types.ts`:
  - `MapData.generation: GenerationRun | null`;
  - `generated_buildings` and `generation_zones` FeatureCollections, with typed properties;
  - block properties gain `eligibility`, `real_building_count`, `generated_building_count`,
    `is_reference`, `reference_block_id`, `style` and `feedback`;
  - the new area kinds (forest, farmland, cemetery, railway, industrial), if brief 01 hasn't added
    them.
- `api/client.ts`:
  - `startGeneration(areaId, seed?)`, `generation(areaId)`, `deleteGeneration(areaId)`;
  - `putBlockFeedback(blockId, body)`, `deleteBlockFeedback(blockId)`, `areaFeedback(areaId)`.
  - Add `client.test.ts` cases, as for `analyseElevation`.
- Update every fixture and consumer `tsc` flags. The new fields are nullable or empty in old fixtures.

## 2. Palette and the new area kinds

- **`scene/palette.ts`:** a `buildingGenerated` material, clearly distinct from the measured and
  defaulted buildings (for example a cool tint on night clay), with edge lines like the other
  buildings. Greens for `forest` and `farmland` distinct from park, a muted green-grey for
  `cemetery`, and a neutral grey for `railway` and `industrial`. Colours come from the derived
  palette, not literals.
- **`views/mapColors.ts`:** the same in 2D, lifted for the dark basemap by its existing rule.
- Draw the new area kinds in `buildWorld.ts` (3D) and `views/mapDataLayers.ts` (2D).
- Update the palette and map-colour tests, and keep the contrast checks passing.

## 3. Generated buildings, and Generate / Show / Hide

- **`buildWorld.ts`:** fill the reserved `generated` group from `generated_buildings`.
  - Extrude to `height_meters` and place each at `base_elevation_meters - baseline`, the same as real
    buildings.
  - Use the `buildingGenerated` material.
  - Set `userData.generated = true` and `layer: "generated"`.
- **The 2D map** draws them as a layer in the generated colour.
- **Controls in `views/sceneView.ts`** (beside "Smooth roads"):
  - **Generate** when `generation` is null. **Regenerate** when it exists, emphasised when
    `generation.stale`, with a tooltip listing `stale_reasons`.
  - Regenerate sends a new random seed (contract §9).
  - Follow the events stream as "Add terrain" does (`scene/terrainJob.ts`; reuse or generalise it),
    show progress, and reload map-data on `completed`.
  - Map failures by code in a pure function with a test, like `terrainMessages.ts`.
  - **Show generated:** a checkbox, checked by default when a run exists, hidden when there's none.
    It toggles the `generated` group.
- **The building popup** (2D and 3D picking): generated buildings say "Generated · from block <short
  id>", or "· defaults" or "· from your count".
- **The glTF export** includes them only while shown (`onlyVisible`). Add an `exportGltf.test.ts`
  case.

## 4. Block outlines, selection, feedback and zones

- **Outlines:**
  - Each block gets an inset dashed outline, 1.5 m inside its boundary. Use a pure inset helper with
    a test, or shrink the boundary ring by offsetting.
  - **3D:** draped on terrain (sample `terrain.heightAtLocal` along the line, densified to the grid
    spacing), `LineDashedMaterial` with `computeLineDistances()`.
  - **2D:** a MapLibre line layer with `line-dasharray`.
  - Crisp for `eligible`, faint and dotted for `clipped`, `median` and `no_buildable_area`, solid and
    highlighted when selected. Reference blocks (`is_reference`) get a subtle marker (a different
    dash or a small badge).
  - **Show blocks** replaces "Show buildable area". It shows the outlines and the zones. The old
    buildable-area fill can stay under it, faint, or go: pick one and say which.
- **Selection:**
  - Clicking inside a block (3D raycast against the block fill, 2D click) selects it.
  - A panel shows `Block · real: N · generated: M · reference: <short id | defaults> · style: <style>`
    plus the eligibility reason when it isn't eligible.
  - Actions: **Actual number of buildings** (a number input and Save), **No buildings here**, and
    **Clear feedback**, calling the feedback endpoints.
  - After a change, it shows "Applies on the next Generate" and updates the panel from the response.
  - Escape or clicking outside deselects.
  - Pure helpers with tests: the panel text from the block properties, and validation of the
    feedback input (integer ≥ 0).
- **Zones:** with **Show blocks** on, draw `generation_zones` shaded by reason: `water`, `steep`,
  `landuse` and `setback`, each with its own token colour and low opacity. They're draped in 3D like
  the area features (grid-cut) and filled in 2D. Add a small legend entry.

## 5. Docs

- `docs/client-features.md`: fill the client column for generation, feedback, blocks and zones. Brief
  03 adds the API rows. If those aren't on your base yet, add them in the existing format, and the
  coordinator reconciles.
- Don't edit `openspec/`.

Commit messages, each ending with a blank line and `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`:
1. `feat(client): generation, feedback and settings types and API calls (#23)`
2. `feat(client): colours for generated buildings and the new land-use kinds (#23)`
3. `feat(client): generate, show and hide generated buildings (#23)`
4. `feat(client): dashed block outlines, block selection with feedback, and zone shading (#23)`

Report:
- the SHAs, and `git show --stat` for each;
- where each control lives;
- how the outline is inset and draped;
- what you did with the old buildable-area fill;
- anything in the contract that didn't fit the client.
