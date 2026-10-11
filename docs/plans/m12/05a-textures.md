# 1.5a Realistic's texture generator and the wall grid (#141)

Read first: `openspec/changes/add-scene-themes-and-time-of-day/design.md` (the night-window, Realistic and
export decisions) and `client/src/scene/themes/` as it is now. This task builds two **pure, unwired**
modules. Later tasks use them in the shader, in the Realistic theme and in the export. Don't touch
`palette.ts`, the views or any existing file except to add tests.

## Do
1. **`client/src/scene/wallGrid.ts`**: the wall coordinates, shared by the night-window shader (1.3), the
   textures and the export (1.8).
   - Constants: `CELL_WIDTH = 3.5` and `FLOOR_HEIGHT = 3.2` (metres).
   - `wallCoords(x, y, z, nx, ny, nz)` returns `{ u, v }` in metres, or null for a roof or floor (`|ny| > 0.5`).
     The tangent along the wall is the horizontal normal rotated 90° and normalised (`(-nz, nx)`), `u` is
     `(x, z)` dotted with that tangent, and `v` is `y`. A building mesh is only translated on y, so the
     geometry's local position is world x and z and the height above the base.
   - `groundCoords(x, z, tile)` returns `{ u: x / tile, v: z / tile }`.
   - A doc comment states that the GLSL in 1.3 must mirror this exactly.
   - Tests: walls facing north, east and diagonal give `u` that runs along the wall in metres; a roof gives
     null; two points one cell apart along a wall differ by `CELL_WIDTH` in `u`.
2. **`client/src/scene/themes/textures.ts`**: Realistic's textures, drawn into RGBA byte arrays from a seeded
   PRNG (write a small mulberry32 or similar in the module), wrapped as `THREE.DataTexture`. No canvas: jsdom has
   no 2D context, and byte arrays are testable.
   - **facade**: 64×64 covering 2 cells by 2 floors (7 m by 6.4 m). Each cell has a darker window with a sill
     line, on a wall colour with a little noise.
   - **roof**: 64×64, tar/gravel noise.
   - **asphalt**: 64×64, dark noise with sparse lighter flecks.
   - **grass**: 64×64, two greens dithered.
   - **forest**: 64×64, dark green blobs.
   - **water**: 64×64, blue with soft horizontal ripples.

   `createRealisticTextures(colors, seed = 1)` takes the base colours (one per texture, from the theme, as
   hex strings) and returns `{ facade, roof, asphalt, grass, forest, water }`. Each texture uses:
   - `magFilter = NearestFilter`;
   - `minFilter = NearestMipmapNearestFilter`;
   - `generateMipmaps = true`;
   - `RepeatWrapping` on both axes;
   - `colorSpace = SRGBColorSpace`;
   - `needsUpdate = true`.

   Also export `FACADE_REPEAT_METRES = { u: 2 * CELL_WIDTH, v: 2 * FLOOR_HEIGHT }` and `GROUND_TILE_METRES`
   (8 m for asphalt, 16 m for the others; pick and document). Then `textureBytes(set)` returns the GPU memory
   of the set including mipmaps (× 4/3 of the base level).
   - Tests:
     - the same seed gives identical bytes, and another seed differs;
     - every texture has the size and filters above;
     - `textureBytes` of the set is at most 1 MB (1,048,576);
     - the facade's window pixels are darker than its wall pixels on average.
   - The guard in `palette.test.ts` exempts `scene/themes/`, so hex strings are fine in this file. Keep the
     palette in the theme file when 1.5 adds it; here, take colours as arguments.

## Don't
- Wire anything into the scene, palette, themes index or export.
- Run `npm test`, `vitest` or `npm run build`. `npx tsc --noEmit` in `client/` is allowed.

## Done when
Committed on `work/m12-textures` (`feat(client): ...`, with a `Co-Authored-By:` trailer naming you), not pushed.
Report the files, the texture sizes and the byte total, and the exact `wallCoords` formula.
