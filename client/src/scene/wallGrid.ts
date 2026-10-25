/**
 * The wall grid: metric wall coordinates shared by the night-window shader, the Realistic
 * textures and the glTF export.
 *
 * The GLSL in the night-window shader (task 1.3) must mirror `wallCoords` and `groundCoords`
 * exactly: same tangent, same dot product, same roof/floor cut-off.
 */

/** Width of one facade cell, in metres. */
export const CELL_WIDTH = 3.5;
/** Height of one floor, in metres. */
export const FLOOR_HEIGHT = 3.2;

export interface WallUv {
  u: number;
  v: number;
}

/**
 * Wall coordinates in metres, or null for a roof or floor (`|ny| > 0.5`).
 *
 * The tangent along the wall is the horizontal normal rotated 90 degrees and normalised,
 * `(-nz, nx)`; `u = (x, z) . tangent` and `v = y`. A building mesh is only translated on y, so
 * the geometry's local position is world x and z, and the height above the base.
 */
export function wallCoords(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): WallUv | null {
  if (Math.abs(ny) > 0.5) return null;
  const len = Math.hypot(nx, nz);
  if (len === 0) return null;
  const tx = -nz / len;
  const tz = nx / len;
  return { u: x * tx + z * tz, v: y };
}

/** Ground coordinates, in texture repeats, for a tile of `tile` metres. */
export function groundCoords(x: number, z: number, tile: number): WallUv {
  return { u: x / tile, v: z / tile };
}
