import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export const GENERATOR = "geospatial-reconstruction-engine";
export const ATTRIBUTION = "© OpenStreetMap contributors";
export const AXES = "x east, y up, z south; meters";

/** The root node's `extras`: where the world is, how to place it on the globe, and its credit. */
function metadata(world: THREE.Object3D) {
  const { scope, projection, attribution } = world.userData;
  return {
    generator: GENERATOR,
    scope,
    projection: {
      origin: projection?.origin,
      meters_per_degree_latitude: projection?.meters_per_degree_latitude,
      meters_per_degree_longitude: projection?.meters_per_degree_longitude,
    },
    attribution: attribution ?? ATTRIBUTION,
    axes: AXES,
  };
}

/**
 * Exports the world group (and nothing else: no lights, markers, or placeholder) as a binary glTF.
 * Hidden layers (the buildable-area blocks, unless shown) are left out. Node names stay
 * `<layer>:<id>`. The exporter writes `userData` into `extras`, so for the export the world carries
 * the metadata above and each mesh only `layer` and `id`; the originals (footprints, road outlines,
 * the API properties) are put back afterwards.
 */
export async function exportWorld(world: THREE.Group): Promise<ArrayBuffer> {
  const original = new Map<THREE.Object3D, Record<string, unknown>>();
  const meta = metadata(world);
  world.traverse((object) => {
    original.set(object, object.userData);
    if (object === world) object.userData = meta;
    else if ((object as THREE.Mesh).isMesh) {
      const { layer, id } = object.userData;
      object.userData = { layer, id };
    }
  });
  try {
    // `copyright` sets asset.copyright (GLTFExporter's own option in this three.js version).
    const result = await new GLTFExporter().parseAsync(world, { binary: true, onlyVisible: true, copyright: meta.attribution });
    return result as ArrayBuffer;
  } finally {
    original.forEach((userData, object) => (object.userData = userData));
  }
}

/** `gre-<scope type>-<first 8 of the scope id>.glb`. */
export function glbFileName(scope: { type: string; id: string } | undefined): string {
  return scope ? `gre-${scope.type}-${scope.id.slice(0, 8)}.glb` : "gre-scene.glb";
}

/** Saves the buffer through a temporary `<a download>`. */
export function downloadGlb(buffer: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
