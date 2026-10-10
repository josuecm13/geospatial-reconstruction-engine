import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export const GENERATOR = "geospatial-reconstruction-engine";
export const ATTRIBUTION = "© OpenStreetMap contributors";
export const AXES = "x east, y up, z south; meters";

/** The credit the file carries: OSM's, and the terrain source's when the world has terrain. */
function credit(world: THREE.Object3D): string {
  const { attribution, elevation } = world.userData;
  return [attribution ?? ATTRIBUTION, elevation?.attribution].filter(Boolean).join(" · ");
}

/** The root node's `extras`: where the world is, how to place it on the globe, and its credit. With terrain, the
 * grid's `version` and the road mode on show (the roads in the file are draped on that mode's heights) go along. */
function metadata(world: THREE.Object3D) {
  const { scope, projection, attribution, elevation, roadMode } = world.userData;
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
    ...(elevation ? { elevation: { source: elevation.source, version: elevation.version, attribution: elevation.attribution, road_mode: roadMode } } : {}),
  };
}

/**
 * Exports the world group (and nothing else: no lights, markers, or placeholder) as a binary glTF.
 * Hidden layers (the buildable-area blocks, unless shown) and the buildings' edge lines are left out. Node names stay
 * `<layer>:<id>`. The exporter writes `userData` into `extras`, so for the export the world carries
 * the metadata above and each mesh only `layer` and `id`; the originals (footprints, road outlines,
 * the API properties) are put back afterwards, and so is the visibility of the edge lines.
 */
export async function exportWorld(world: THREE.Group): Promise<ArrayBuffer> {
  const original = new Map<THREE.Object3D, Record<string, unknown>>();
  const meta = metadata(world);
  const hidden: THREE.Object3D[] = [];
  // No material uses a texture, so the UVs are dead weight in the file: taken off for the export.
  const uvs: [THREE.BufferGeometry, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][] = [];
  world.traverse((object) => {
    // Building edges are a viewer effect: left out, since `onlyVisible` skips what is hidden.
    if ((object as THREE.LineSegments).isLineSegments && object.visible) {
      object.visible = false;
      hidden.push(object);
    }
    const geometry = (object as THREE.Mesh).isMesh ? (object as THREE.Mesh).geometry : undefined;
    const uv = geometry?.getAttribute("uv");
    if (geometry && uv && !uvs.some(([g]) => g === geometry)) {
      uvs.push([geometry, uv]);
      geometry.deleteAttribute("uv");
    }
    original.set(object, object.userData);
    if (object === world) object.userData = meta;
    else if ((object as THREE.Mesh).isMesh) {
      const { layer, id } = object.userData;
      object.userData = { layer, id };
    }
  });
  try {
    // `copyright` sets asset.copyright (GLTFExporter's own option in this three.js version).
    const result = await new GLTFExporter().parseAsync(world, { binary: true, onlyVisible: true, copyright: credit(world) });
    return result as ArrayBuffer;
  } finally {
    original.forEach((userData, object) => (object.userData = userData));
    hidden.forEach((object) => (object.visible = true));
    uvs.forEach(([geometry, uv]) => geometry.setAttribute("uv", uv));
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
