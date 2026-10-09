import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { extrudeFootprints, footprintShape } from "./extrude";
import { AMBIENT, LIGHT_DIRECTION, shade, shadeGeometry } from "./shading";

const box = (x: number, z: number, size = 10) =>
  extrudeFootprints(
    [
      footprintShape([
        { x, z },
        { x: x + size, z },
        { x: x + size, z: z - size },
        { x, z: z - size },
      ]),
    ],
    8,
  );

/** The grey of each triangle's vertices, grouped by the triangle's normal (from its positions, rounded). */
function colorsByNormal(geometry: THREE.BufferGeometry): Map<string, Set<number>> {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const out = new Map<string, Set<number>>();
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    const key = [n.x, n.y, n.z].map((v) => Math.round(v * 1000) / 1000 + 0).join(",");
    const values = out.get(key) ?? new Set<number>();
    for (let k = 0; k < 3; k++) values.add(color.getX(i + k));
    out.set(key, values);
  }
  return out;
}

describe("the light", () => {
  it("has length 1", () => {
    expect(LIGHT_DIRECTION.length()).toBeCloseTo(1, 12);
  });
});

describe("shade", () => {
  it("is 1 for a face pointing at the light, and AMBIENT for one pointing away", () => {
    expect(shade(LIGHT_DIRECTION as THREE.Vector3)).toBeCloseTo(1, 12);
    expect(shade(LIGHT_DIRECTION.clone().negate())).toBe(AMBIENT);
  });

  it("is AMBIENT for a face at 90 degrees to the light", () => {
    const perpendicular = new THREE.Vector3().crossVectors(LIGHT_DIRECTION, new THREE.Vector3(0, 0, 1)).normalize();
    expect(perpendicular.dot(LIGHT_DIRECTION)).toBeCloseTo(0, 12);
    expect(shade(perpendicular)).toBeCloseTo(AMBIENT, 12);
  });

  it("stays within AMBIENT and 1 for any normal", () => {
    for (let i = 0; i < 1000; i++) {
      const n = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const s = shade(n);
      expect(s).toBeGreaterThanOrEqual(AMBIENT);
      expect(s).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe("shadeGeometry", () => {
  it("makes the geometry non-indexed, with one grey per vertex, the same for all three vertices of a triangle", () => {
    const g = new THREE.BoxGeometry(1, 1, 1); // indexed
    expect(g.index).not.toBeNull();
    const shaded = shadeGeometry(g);
    const color = shaded.getAttribute("color");
    expect(shaded.index).toBeNull();
    expect(color.count).toBe(shaded.getAttribute("position").count);
    for (let i = 0; i < color.count; i += 3) {
      for (let k = 1; k < 3; k++) expect(color.getX(i + k)).toBe(color.getX(i));
      expect(color.getY(i)).toBe(color.getX(i));
      expect(color.getZ(i)).toBe(color.getX(i));
    }
  });

  it("shades faces of the same orientation the same, wherever they are", () => {
    const near = colorsByNormal(box(0, 0));
    const far = colorsByNormal(box(500, -300, 25));
    expect([...near.keys()].sort()).toEqual([...far.keys()].sort());
    expect(near.size).toBe(6); // four walls, a roof and a floor
    for (const [normal, values] of near) {
      expect(values.size, normal).toBe(1); // every vertex of every triangle of that face
      expect([...far.get(normal)!], normal).toEqual([...values]);
    }
    expect([...near.get("0,1,0")!][0]).toBeCloseTo(shade(new THREE.Vector3(0, 1, 0)), 6);
    expect(new Set([...near.values()].map((v) => [...v][0])).size).toBeGreaterThan(2); // the walls read differently
  });

  it("computes normals from positions, ignoring a wrong normal attribute", () => {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // faces up
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(12).map((_, i) => (i % 3 === 1 ? -1 : 0)), 3)); // claims down
    expect(shadeGeometry(g).getAttribute("color").getX(0)).toBeCloseTo(shade(new THREE.Vector3(0, 1, 0)), 6);
  });
});
