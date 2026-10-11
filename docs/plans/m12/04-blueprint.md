# 1.4 Blueprint (#141)

Read first: the Blueprint decision in `openspec/changes/add-scene-themes-and-time-of-day/design.md`, and the
"four themes" requirement in its `specs/scene-themes/spec.md`. Then read `client/src/scene/themes/`,
`scene/palette.ts`, `scene/buildWorld.ts` (how `withEdges` and the block outlines are built) and `scene/atmosphere.ts`.

## Do
1. **`client/src/scene/themes/blueprint.ts`**, added to `THEMES`, with `mode: "line"`, `followsSun: false` and
   `windows: "never"`.
   - A navy paper ground, with roads, water, green and the land-use kinds as slightly lighter or tinted navies.
   - Faint translucent building fills, about 0.12–0.2 opacity.
   - Cyan or white edges.
   - Generated buildings with dashed edges.
   - The route, the pin and the block outlines in bright inks (orange, yellow, cyan, violet) that pass the
     legibility guards in `palette.test.ts` against the navy ground.
   - A flat navy sky with no sun, and no fog.
2. **Line-mode materials, in `palette.ts` `materialsFor`.** For `mode: "line"`:
   - Building fills are unlit, transparent, low opacity, `depthWrite: true`, so the edges of buildings behind
     are hidden.
   - The edge material is a brighter, opaque `LineBasicMaterial`.
   - Add an `edgeGenerated` key: a `LineDashedMaterial` in Blueprint, and the same material as `edge` in the
     other themes, so the key exists everywhere.
   - Generated buildings' edge lines take `edgeGenerated`, set in `generatedMeshes` in `buildWorld.ts`.
     `computeLineDistances()` is needed for dashes; calling it once per edge object when the edges are built is
     fine.
3. **The ground grid.**
   - The ground material in Blueprint gets an `onBeforeCompile` patch: thin lines every 10 m and a stronger line
     every 100 m, from world x and z. Use the local position: the ground mesh is positioned, so compute the world
     position in the vertex shader with `modelMatrix`.
   - Antialias the lines with `fwidth`, and fade the 10 m lines out where they get denser than a few pixels.
   - Grid colours come from the theme: add `gridMinor` and `gridMajor`, optional, used only by Blueprint.
4. **Road outlines.**
   - When Blueprint is first applied to a world, build its road outlines once: one `LineSegments` per world,
     under the `roads` group, named `road_outlines`.
   - Build them from `world.userData.roadOutlines`, densified like the block outlines and lifted onto
     `terrain.heightAtLocal` plus `LAYER_Y.roads` plus a small lift.
   - They're visible only in Blueprint: toggle `visible` on theme change.
   - Not pickable (`raycast = () => {}`).
   - Their material key is `roadOutline`: a line in Blueprint, present but unused in the other themes.
   - Put the builder in `buildWorld.ts` as an exported `roadOutlineLines(world)`, and call it from the scene
     view's `setTheme` when the theme is Blueprint and the world has none yet.
5. **Tests.**
   - Blueprint passes the legibility guards (automatic through `THEMES`).
   - `materialsFor(blueprint)` has transparent building fills, a dashed `edgeGenerated` and a line `roadOutline`.
   - Generated meshes' edges take `edgeGenerated` with line distances computed.
   - `roadOutlineLines` builds one object from the outlines, at road height on a flat world.

## Don't
- Add a sun, shadows, textures or windows to Blueprint.
- Change Night clay's or Light clay's look.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-blueprint` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report:
- the files changed;
- the Blueprint colours;
- how the grid shader gets world position;
- anything you couldn't do as written.
