import * as THREE from "three";
import type { Local } from "./projection";

/** A shape from a ring in local meters. Shape coordinates are (x, -z): rotating the geometry by
 * -90 degrees about x then lands the ring back on (x, z) with the extrusion pointing up. A closing
 * point equal to the first is dropped; three.js handles either winding. */
export function footprintShape(ring: Local[]): THREE.Shape {
  const closed = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].z === ring[ring.length - 1].z;
  const points = closed ? ring.slice(0, -1) : ring;
  return new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
}

/** A shape with holes, from an outer ring and its inner rings. */
export function polygonShape(rings: Local[][]): THREE.Shape {
  const shape = footprintShape(rings[0]);
  shape.holes = rings.slice(1).map((ring) => new THREE.Path(footprintShape(ring).getPoints()));
  return shape;
}

/** Footprints extruded from y = 0 up to `height` meters. */
export function extrudeFootprints(shapes: THREE.Shape[], height: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Flat shapes lying on y = 0 (facing up); position the mesh to set the height. */
export function flatGeometry(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shapes);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
