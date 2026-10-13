import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CHUNK_CELL, cellKey, featureAtFace, footprintEdges, groupByKey, mergeChunks, ringsCentre, type BatchEntry } from "./batching";
import type { Local } from "./projection";

const box = (x: number, z: number, size = 10): Local[] => [
  { x, z },
  { x: x + size, z },
  { x: x + size, z: z + size },
  { x, z: z + size },
];

/** A building of a unit box's twelve triangles, standing `base` up, with the footprint ring `rings`. */
const entry = (id: string, key: string, base: number, rings: Local[][] = [box(0, 0)], height = 10): BatchEntry => ({
  id,
  key,
  material: new THREE.MeshBasicMaterial(),
  geometry: new THREE.BoxGeometry(1, height, 1).toNonIndexed(),
  base,
  height,
  rings,
});

const edgeMaterial = new THREE.LineBasicMaterial();

describe("cellKey", () => {
  it("names the grid cell of a point, flooring toward minus infinity", () => {
    expect(cellKey(0, 0)).toBe("0,0");
    expect(cellKey(CHUNK_CELL - 0.01, CHUNK_CELL)).toBe("0,1");
    expect(cellKey(-0.01, -CHUNK_CELL - 0.01)).toBe("-1,-2");
    expect(cellKey(25, 25, 10)).toBe("2,2");
  });

  it("puts points of one cell under one key and its neighbours under others", () => {
    expect(cellKey(10, 10)).toBe(cellKey(140, 140));
    expect(cellKey(10, 10)).not.toBe(cellKey(160, 10));
  });
});

describe("groupByKey", () => {
  it("groups in order of first appearance, keeping each group's own order", () => {
    const groups = groupByKey(["a1", "b1", "a2", "c1", "b2"], (item) => item[0]);
    expect([...groups.keys()]).toEqual(["a", "b", "c"]);
    expect(groups.get("a")).toEqual(["a1", "a2"]);
    expect(groups.get("b")).toEqual(["b1", "b2"]);
  });
});

describe("ringsCentre", () => {
  it("is the middle of the bounding box", () => {
    expect(ringsCentre([box(10, 20, 4)])).toEqual({ x: 12, z: 22 });
  });
});

describe("footprintEdges", () => {
  it("draws a box footprint as 12 segments: four bottom, four top, four vertical", () => {
    const positions = footprintEdges([box(0, 0)], 0, 5);
    expect(positions).toHaveLength(12 * 2 * 3);
    const ys = new Set(positions.filter((_, i) => i % 3 === 1));
    expect([...ys].sort()).toEqual([0, 5]);
    // Vertical segments are the ones whose two ends share x and z.
    let vertical = 0;
    for (let s = 0; s < 12; s++) {
      const [a, b] = [positions.slice(s * 6, s * 6 + 3), positions.slice(s * 6 + 3, s * 6 + 6)];
      if (a[0] === b[0] && a[2] === b[2] && a[1] !== b[1]) vertical++;
    }
    expect(vertical).toBe(4);
  });

  it("drops a closing point equal to the first, and counts three segments per corner", () => {
    const open = box(0, 0);
    const closed = [...open, open[0]];
    expect(footprintEdges([closed], 0, 1)).toEqual(footprintEdges([open], 0, 1));
    const triangle: Local[] = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 0, z: 4 }];
    expect(footprintEdges([triangle], 0, 1)).toHaveLength(3 * 3 * 2 * 3);
  });

  it("covers every ring of a footprint with several, and nothing for a degenerate one", () => {
    expect(footprintEdges([box(0, 0), box(20, 0)], 0, 1)).toHaveLength(2 * 12 * 6);
    expect(footprintEdges([[{ x: 0, z: 0 }]], 0, 1)).toEqual([]);
  });
});

describe("featureAtFace", () => {
  const index = { featureIds: ["a", "b", "c"], triangleStarts: [0, 12, 24, 36] };

  it("finds the feature that owns a triangle, at the edges of every range too", () => {
    expect(featureAtFace(index, 0)).toBe("a");
    expect(featureAtFace(index, 11)).toBe("a");
    expect(featureAtFace(index, 12)).toBe("b");
    expect(featureAtFace(index, 23)).toBe("b");
    expect(featureAtFace(index, 24)).toBe("c");
    expect(featureAtFace(index, 35)).toBe("c");
  });

  it("has no feature for a missing or out-of-range face", () => {
    expect(featureAtFace(index, undefined)).toBeUndefined();
    expect(featureAtFace(index, -1)).toBeUndefined();
    expect(featureAtFace(index, 36)).toBeUndefined();
    expect(featureAtFace({ featureIds: [], triangleStarts: [0] }, 0)).toBeUndefined();
  });

  it("copes with ranges of different sizes", () => {
    expect(featureAtFace({ featureIds: ["x", "y"], triangleStarts: [0, 3, 10] }, 2)).toBe("x");
    expect(featureAtFace({ featureIds: ["x", "y"], triangleStarts: [0, 3, 10] }, 3)).toBe("y");
  });
});

describe("mergeChunks", () => {
  const options = { layer: "building", prefix: "buildings", edgeMaterial, castShadow: true };

  it("records each building's lift above the chunk in a per-vertex baseLift, so shaders measure from its own base", () => {
    const [chunk] = mergeChunks([entry("a", "0,0:m", 2), entry("b", "0,0:m", 5), entry("c", "0,0:m", 2)], options);
    const lift = chunk.geometry.getAttribute("baseLift");
    const position = chunk.geometry.getAttribute("position");
    expect(lift.count).toBe(position.count);
    const perBuilding = position.count / 3;
    const values = (i: number) => new Set(Array.from({ length: perBuilding }, (_, k) => lift.getX(i * perBuilding + k)));
    expect([...values(0)]).toEqual([0]);
    expect([...values(1)]).toEqual([3]);
    expect([...values(2)]).toEqual([0]);
    // Local y minus the lift is the height above the building's own base: the box spans 0..10 for every building.
    for (let i = 0; i < position.count; i++) expect([0, 10]).toContain(Math.round(position.getY(i) - lift.getX(i) + 5));
  });

  it("keeps one baseLift of 0 on a lone building at the chunk's base", () => {
    const [chunk] = mergeChunks([entry("a", "0,0:m", 7)], options);
    expect(new Set(chunk.geometry.getAttribute("baseLift").array)).toEqual(new Set([0]));
  });

  it("makes one mesh per key, named for it, with the layer kept", () => {
    const chunks = mergeChunks([entry("a", "0,0:m", 0), entry("b", "1,0:m", 0), entry("c", "0,0:m", 0)], options);
    expect(chunks.map((chunk) => chunk.name)).toEqual(["buildings:chunk:0,0:m", "buildings:chunk:1,0:m"]);
    expect(chunks.map((chunk) => chunk.userData.featureIds)).toEqual([["a", "c"], ["b"]]);
    expect(chunks.every((chunk) => chunk.userData.layer === "building" && chunk.castShadow && chunk.receiveShadow)).toBe(true);
    expect(chunks[0].userData.properties).toBeUndefined();
  });

  it("records each feature's triangle range, and the face lookup agrees with it", () => {
    const [chunk] = mergeChunks([entry("a", "k", 0), entry("b", "k", 0), entry("c", "k", 0)], options);
    expect(chunk.userData.triangleStarts).toEqual([0, 12, 24, 36]);
    expect((chunk.geometry.getAttribute("position") as THREE.BufferAttribute).count / 3).toBe(36);
    expect(featureAtFace(chunk.userData as never, 13)).toBe("b");
  });

  it("sits the chunk at its lowest base and lifts every other building by its own height above that", () => {
    const [chunk] = mergeChunks([entry("a", "k", 7), entry("b", "k", 10), entry("c", "k", 9)], options);
    expect(chunk.position.y).toBe(7);
    const position = chunk.geometry.getAttribute("position") as THREE.BufferAttribute;
    const bottoms = [0, 1, 2].map((i) => {
      let min = Infinity;
      for (let v = i * 36; v < (i + 1) * 36; v++) min = Math.min(min, position.getY(v));
      return chunk.position.y + min;
    });
    // A BoxGeometry is centred on y = 0, so the bottom is half its height (5) under the base, shifted by the lift.
    expect(bottoms).toEqual([7 - 5, 10 - 5, 9 - 5]);
  });

  it("gives the chunk one edges child with the edge segments of every footprint, never picked", () => {
    const [chunk] = mergeChunks([entry("a", "k", 0, [box(0, 0)]), entry("b", "k", 3, [box(30, 0)])], options);
    const edges = chunk.children.filter((child) => child.name === "edges") as THREE.LineSegments[];
    expect(chunk.children).toHaveLength(1);
    expect(edges).toHaveLength(1);
    expect(edges[0].isLineSegments).toBe(true);
    expect(edges[0].material).toBe(edgeMaterial);
    expect(edges[0].geometry.getAttribute("position").count).toBe(2 * 12 * 2);
    const hits: THREE.Intersection[] = [];
    edges[0].raycast({} as THREE.Raycaster, hits);
    expect(hits).toEqual([]);
    expect(edges[0].geometry.getAttribute("lineDistance")).toBeUndefined();
  });

  it("measures line distances only for dashed edges", () => {
    const [chunk] = mergeChunks([entry("a", "k", 0)], { ...options, dashed: true });
    expect((chunk.getObjectByName("edges") as THREE.LineSegments).geometry.getAttribute("lineDistance")).toBeDefined();
  });

  it("records each feature's centre and height for callers that need where the buildings are", () => {
    const [chunk] = mergeChunks([entry("a", "k", 0, [box(0, 0, 10)], 8), entry("b", "k", 0, [box(20, 40, 10)], 12)], options);
    expect(chunk.userData.centres).toEqual([5, 5, 8, 25, 45, 12]);
  });

  it("takes extra userData from the key and entries", () => {
    const [chunk] = mergeChunks([entry("a", "blk", 0)], { ...options, extra: (key) => ({ block: key }) });
    expect(chunk.userData.block).toBe("blk");
  });
});
