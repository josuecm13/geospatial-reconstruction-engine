import * as THREE from "three";
import type { Local } from "./projection";
import { shadeGeometry } from "./shading";
import { gridCutTriangles, type GridLines } from "./gridCut";
import { drape } from "./terrain";

/** Points closer than this (1 mm) are one point: float32 positions can't tell them apart a few km from the origin. */
const SAME_POINT = 1e-3;

/** A shape from a ring in local meters. Shape coordinates are (x, -z): rotating the geometry by
 * -90 degrees about x then lands the ring back on (x, z) with the extrusion pointing up. A closing
 * point equal to the first is dropped, and so is any point within a millimetre of the previous one:
 * once stored as float32 the two coincide, and the zero-area wall between them has a zero normal.
 * three.js handles either winding. */
export function footprintShape(ring: Local[]): THREE.Shape {
  const points: Local[] = [];
  for (const p of ring) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= SAME_POINT) points.push(p);
  }
  while (points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].z - points[points.length - 1].z) < SAME_POINT) points.pop();
  return new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
}

/** A shape with holes, from an outer ring and its inner rings. */
export function polygonShape(rings: Local[][]): THREE.Shape {
  const shape = footprintShape(rings[0]);
  shape.holes = rings.slice(1).map((ring) => new THREE.Path(footprintShape(ring).getPoints()));
  return shape;
}

/** Footprints extruded from y = 0 up to `height` meters, shaded (shading.ts). */
export function extrudeFootprints(shapes: THREE.Shape[], height: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return shadeGeometry(geometry);
}

/**
 * Flat polygons (outer ring first, then holes) laid over the terrain: cut along the grid's lines and triangulated
 * cell by cell (gridCut.ts), then each vertex's y is set to `height(x, z)`, and shaded. Position the mesh to add a
 * layer's offset on top.
 */
export function drapedGeometry(polygons: Local[][][], height: (x: number, z: number) => number, lines: GridLines): THREE.BufferGeometry {
  const flat = gridCutTriangles(polygons, lines);
  const positions = new Float32Array((flat.length / 2) * 3);
  for (let i = 0; i < flat.length / 2; i++) {
    positions[i * 3] = flat[i * 2];
    positions[i * 3 + 2] = flat[i * 2 + 1];
  }
  const geometry = new THREE.BufferGeometry();
  drape(positions, height);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return shadeGeometry(geometry);
}

/** Flat shapes lying on y = 0 (facing up), shaded; position the mesh to set the height. */
export function flatGeometry(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shapes);
  geometry.rotateX(-Math.PI / 2);
  return shadeGeometry(geometry);
}
