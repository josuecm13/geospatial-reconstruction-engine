import * as THREE from "three";

/**
 * The scene's shading, computed here and baked into vertex colours, so the viewer and the glTF
 * export look the same: three.js lights aren't exported, and any glTF viewer would relight a lit
 * material its own way. Materials are unlit (`MeshBasicMaterial` with `vertexColors`).
 *
 *   shade(n) = AMBIENT + (1 - AMBIENT) * max(0, n . LIGHT_DIRECTION)
 *
 * `n` is a face's unit normal in world orientation. Each vertex of a face gets `shade` as a grey
 * colour, and the material multiplies it into its palette colour (three.js does that in linear
 * space), so a face pointing straight at the light shows exactly its palette colour.
 *
 * Meshes are only translated, and scaled on y by the build animation; walls stay vertical and roofs
 * flat, so the shade baked into the geometry stays right. A mesh must not be rotated: bake any
 * rotation into the geometry before calling `shadeGeometry`.
 */

/** Unit vector pointing toward the light. Mostly overhead, tilted west and slightly south, so walls
 * facing different ways read differently: west walls are lit, east walls fall near ambient. */
export const LIGHT_DIRECTION: Readonly<THREE.Vector3> = Object.freeze(new THREE.Vector3(-0.4, 1, 0.3).normalize());

/** The shade of a face pointing away from the light. */
export const AMBIENT = 0.55;

/** The brightness (AMBIENT to 1) of a face with unit normal `normal`. */
export function shade(normal: THREE.Vector3): number {
  return AMBIENT + (1 - AMBIENT) * Math.max(0, normal.dot(LIGHT_DIRECTION));
}

/**
 * Makes the faces flat-shaded: converts to non-indexed (each face needs its own vertices), computes
 * every triangle's normal from its positions (any `normal` attribute is not trusted), and writes the
 * `color` attribute. Returns the geometry; call it once the orientation is final.
 */
export function shadeGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const [a, b, c, normal] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    normal.subVectors(b, a).cross(c.sub(a)).normalize(); // (b - a) x (c - a); a degenerate triangle gets zero, so AMBIENT
    colors.fill(shade(normal), i * 3, i * 3 + 9);
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}
