import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BOX_STRIDE } from "./detail";
import { CHUNK_CELL, cellKey, featureAtFace, foldChunks, footprintEdges, groupByKey, mergeChunks, ringsCentre, type BatchEntry } from "./batching";
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

describe("foldChunks", () => {
  const options = { layer: "generated", prefix: "generated", edgeMaterial, dashed: true, castShadow: true };
  /** A block's chunk as the scene view streams it: one per block, with the block of each feature and its cell. */
  const blockChunk = (block: string, entries: BatchEntry[]) =>
    mergeChunks(entries, { ...options, extra: (_key, group) => ({ block, blocks: group.map(() => block), cell: "0,0" }) })[0];
  const fold = (chunks: THREE.Mesh[]) => foldChunks(chunks, { prefix: "generated", keyOf: (chunk) => `${chunk.userData.cell}:m`, edgeMaterial, dashed: true });

  it("merges two block chunks into one named for the cell, keeping ids, triangle ranges, centres and the block of each feature", () => {
    const one = blockChunk("b1", [entry("a", "b1", 2, [box(0, 0)], 8), entry("b", "b1", 5, [box(20, 0)], 10)]);
    const two = blockChunk("b2", [entry("c", "b2", 3, [box(40, 40)], 12)]);
    const [{ replaced, chunk }] = fold([one, two]);
    expect(replaced).toEqual([one, two]);
    expect(chunk.name).toBe("generated:chunk:0,0:m");
    expect(chunk.userData).toMatchObject({ layer: "generated", chunk: true, cell: "0,0", blocks: ["b1", "b1", "b2"], featureIds: ["a", "b", "c"], triangleStarts: [0, 12, 24, 36] });
    expect(chunk.userData.block).toBeUndefined(); // a cell chunk spans blocks
    expect(chunk.userData.centres).toEqual([5, 5, 8, 25, 5, 10, 45, 45, 12]);
    expect(featureAtFace(chunk.userData as never, 25)).toBe("c");
    expect((chunk.geometry.getAttribute("position") as THREE.BufferAttribute).count / 3).toBe(36);
    expect(chunk.castShadow && chunk.receiveShadow).toBe(true);
  });

  it("sits at the lowest chunk and keeps every feature where it was, in geometry, baseLift and edges", () => {
    const one = blockChunk("b1", [entry("a", "b1", 4, [box(0, 0)], 10), entry("b", "b1", 6, [box(20, 0)], 10)]);
    const two = blockChunk("b2", [entry("c", "b2", 3, [box(40, 40)], 10)]);
    const bottoms = (mesh: THREE.Mesh, i: number) => {
      const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const starts = mesh.userData.triangleStarts as number[];
      let min = Infinity;
      for (let v = starts[i] * 3; v < starts[i + 1] * 3; v++) min = Math.min(min, position.getY(v));
      return mesh.position.y + min;
    };
    const before = [bottoms(one, 0), bottoms(one, 1), bottoms(two, 0)];
    const [{ chunk }] = fold([one, two]);
    expect(chunk.position.y).toBe(3);
    expect([0, 1, 2].map((i) => bottoms(chunk, i))).toEqual(before);
    const lift = chunk.geometry.getAttribute("baseLift");
    const at = (i: number) => lift.getX(chunk.userData.triangleStarts[i] * 3);
    expect([at(0), at(1), at(2)]).toEqual([1, 3, 0]);
    // Each footprint's edges run from its own base (the lift) up to its height: the lowest edge point is the lift.
    const edges = chunk.getObjectByName("edges") as THREE.LineSegments;
    const ys = Array.from({ length: edges.geometry.getAttribute("position").count }, (_, k) => edges.geometry.getAttribute("position").getY(k));
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(13); // b: lift 3 + height 10
    expect(edges.geometry.getAttribute("position").count).toBe(3 * 12 * 2);
    expect(edges.geometry.getAttribute("lineDistance")).toBeDefined();
  });

  it("concatenates the far-level boxes of every chunk, raising each lift by how far its chunk moved up", () => {
    const one = blockChunk("b1", [entry("a", "b1", 4, [box(0, 0)], 10)]);
    const two = blockChunk("b2", [entry("c", "b2", 3, [box(40, 40)], 10)]);
    const before = [...(one.userData.boxes as number[]), ...(two.userData.boxes as number[])];
    const [{ chunk }] = fold([one, two]);
    const boxes = chunk.userData.boxes as number[];
    expect(boxes).toHaveLength(before.length);
    expect(boxes.length).toBe(2 * BOX_STRIDE);
    const diff = boxes.map((v, k) => v - before[k]);
    expect(diff).toEqual(Array.from({ length: boxes.length }, (_, k) => (k === 5 ? 1 : 0))); // only the first chunk (y 4 over the folded 3) has its lift raised
  });

  it("disposes the merged-away geometries and their edges", () => {
    const one = blockChunk("b1", [entry("a", "b1", 0)]);
    const two = blockChunk("b2", [entry("b", "b2", 0)]);
    const disposed: THREE.BufferGeometry[] = [];
    for (const old of [one, two]) {
      for (const geometry of [old.geometry, (old.getObjectByName("edges") as THREE.LineSegments).geometry]) geometry.addEventListener("dispose", () => disposed.push(geometry));
    }
    fold([one, two]);
    expect(disposed).toHaveLength(4);
  });

  it("keeps a lone chunk's geometry alive under its new name, and leaves one already named for its key alone", () => {
    const one = blockChunk("b1", [entry("a", "b1", 0)]);
    const geometry = one.geometry;
    let disposed = false;
    geometry.addEventListener("dispose", () => (disposed = true));
    const [{ chunk }] = fold([one]);
    expect(chunk.name).toBe("generated:chunk:0,0:m");
    expect(chunk.geometry).toBe(geometry);
    expect(disposed).toBe(false);
    expect(fold([chunk])).toEqual([]);
  });

  it("makes one chunk per key, so a cell's new block folds into its existing chunk and other cells stay apart", () => {
    const folded = fold([blockChunk("b1", [entry("a", "b1", 0)]), blockChunk("b2", [entry("b", "b2", 0)])])[0].chunk;
    const next = blockChunk("b3", [entry("c", "b3", 0)]);
    const far = blockChunk("b4", [entry("d", "b4", 0)]);
    far.userData.cell = "1,0";
    const result = fold([folded, next, far]);
    expect(result.map(({ chunk }) => chunk.name)).toEqual(["generated:chunk:0,0:m", "generated:chunk:1,0:m"]);
    expect(result[0].chunk.userData.featureIds).toEqual(["a", "b", "c"]);
    expect(result[0].chunk.userData.blocks).toEqual(["b1", "b2", "b3"]);
    expect(result[1].replaced).toEqual([far]);
  });
});
