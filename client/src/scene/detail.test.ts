import { describe, expect, it } from "vitest";
import { cellOfCentres } from "./batching";
import {
  appendBoxes,
  BOX_STRIDE,
  BOX_VERTICES,
  boxesOf,
  DETAIL_BAND,
  DETAIL_FAR_PX,
  DETAIL_NEAR_PX,
  detailLevel,
  minAreaRect,
  parseCellKey,
  projectedRadius,
  superKey,
} from "./detail";
import type { Local } from "./projection";

/** A rectangle of `width` x `depth` centred on (cx, cz), turned by `angle` radians. */
const rotated = (cx: number, cz: number, width: number, depth: number, angle: number): Local[] =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => ({
    x: cx + (a * width * Math.cos(angle) - b * depth * Math.sin(angle)) / 2,
    z: cz + (a * width * Math.sin(angle) + b * depth * Math.cos(angle)) / 2,
  }));

describe("projectedRadius", () => {
  it("is the radius over the distance, scaled by half the viewport height over tan(fov / 2)", () => {
    // 90 degrees: tan(45) = 1, so a 10 m radius at 100 m on a 1000 px viewport is 10 / 100 * 500 = 50 px.
    expect(projectedRadius(10, 100, 1000, 90)).toBeCloseTo(50, 6);
  });

  it("shows more of the same cell through a narrower lens, and less from further away", () => {
    expect(projectedRadius(100, 1000, 1000, 38)).toBeGreaterThan(projectedRadius(100, 1000, 1000, 50));
    expect(projectedRadius(100, 2000, 1000, 50)).toBeCloseTo(projectedRadius(100, 1000, 1000, 50) / 2, 6);
  });
});

describe("detailLevel", () => {
  it("takes a cell with no history at the plain thresholds", () => {
    expect(detailLevel(DETAIL_NEAR_PX)).toBe("near");
    expect(detailLevel(DETAIL_NEAR_PX - 1)).toBe("mid");
    expect(detailLevel(DETAIL_FAR_PX)).toBe("mid");
    expect(detailLevel(DETAIL_FAR_PX - 1)).toBe("far");
  });

  it("keeps a near cell near until it falls below the band, and a mid cell mid until it rises above it", () => {
    const [low, high] = [DETAIL_NEAR_PX * (1 - DETAIL_BAND), DETAIL_NEAR_PX * (1 + DETAIL_BAND)];
    expect(detailLevel(DETAIL_NEAR_PX - 1, "near")).toBe("near");
    expect(detailLevel(low + 0.01, "near")).toBe("near");
    expect(detailLevel(low - 0.01, "near")).toBe("mid");
    expect(detailLevel(DETAIL_NEAR_PX + 1, "mid")).toBe("mid");
    expect(detailLevel(high - 0.01, "mid")).toBe("mid");
    expect(detailLevel(high + 0.01, "mid")).toBe("near");
  });

  it("has the same band at the far threshold", () => {
    const [low, high] = [DETAIL_FAR_PX * (1 - DETAIL_BAND), DETAIL_FAR_PX * (1 + DETAIL_BAND)];
    expect(detailLevel(DETAIL_FAR_PX - 1, "mid")).toBe("mid");
    expect(detailLevel(low - 0.01, "mid")).toBe("far");
    expect(detailLevel(DETAIL_FAR_PX + 1, "far")).toBe("far");
    expect(detailLevel(high + 0.01, "far")).toBe("mid");
  });

  it("doesn't flicker for a size wobbling on a threshold", () => {
    let level = detailLevel(DETAIL_NEAR_PX + 1);
    const seen = new Set<string>();
    for (const wobble of [-3, 3, -2, 2, -4, 4]) seen.add((level = detailLevel(DETAIL_NEAR_PX + wobble, level)));
    expect(seen.size).toBe(1);
  });

  it("can cross two thresholds at once", () => {
    expect(detailLevel(1000, "far")).toBe("near");
    expect(detailLevel(1, "near")).toBe("far");
  });
});

describe("superKey", () => {
  it("groups 4 x 4 cells", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) keys.add(superKey(`${i},${j}`));
    expect([...keys]).toEqual(["0,0"]);
    expect(superKey("4,0")).toBe("1,0");
    expect(superKey("3,4")).toBe("0,1");
  });

  it("floors toward minus infinity, so the cells either side of zero are in different super-cells", () => {
    expect(superKey("-1,-1")).toBe("-1,-1");
    expect(superKey("-4,-4")).toBe("-1,-1");
    expect(superKey("-5,0")).toBe("-2,0");
    expect(superKey("0,0")).not.toBe(superKey("-1,-1"));
  });

  it("round-trips the indices of a cell key", () => {
    expect(parseCellKey("3,-2")).toEqual([3, -2]);
  });
});

describe("cellOfCentres", () => {
  it("names the cell of the mean of the centres", () => {
    expect(cellOfCentres([10, 10, 5, 290, 10, 5])).toBe("1,0"); // the mean x, 150, is the next cell over
    expect(cellOfCentres([10, 10, 5, 280, 10, 5])).toBe("0,0");
    expect(cellOfCentres([-10, -10, 5])).toBe("-1,-1");
  });

  it("has none for a chunk with no centres", () => {
    expect(cellOfCentres([])).toBeUndefined();
  });
});

describe("minAreaRect", () => {
  it("returns a rectangle as itself", () => {
    const rect = minAreaRect([rotated(5, -3, 8, 3, 0)])!;
    expect(rect.x).toBeCloseTo(5, 6);
    expect(rect.z).toBeCloseTo(-3, 6);
    expect(rect.width).toBeCloseTo(8, 6);
    expect(rect.depth).toBeCloseTo(3, 6);
    expect(rect.angle).toBeCloseTo(0, 6);
  });

  it("returns a turned rectangle as itself, the long side first", () => {
    for (const angle of [Math.PI / 6, Math.PI / 2 + 0.3, 2.5]) {
      const rect = minAreaRect([rotated(100, 40, 4, 12, angle)])!;
      expect(rect.x).toBeCloseTo(100, 5);
      expect(rect.z).toBeCloseTo(40, 5);
      expect(rect.width).toBeCloseTo(12, 5);
      expect(rect.depth).toBeCloseTo(4, 5);
      // The long side of a 4 x 12 turned by `angle` runs along `angle + pi / 2`.
      expect(Math.cos(rect.angle - angle - Math.PI / 2) ** 2).toBeCloseTo(1, 5);
    }
  });

  it("gives an L shape its minimum-area rectangle", () => {
    const l: Local[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
      { x: 0, z: 3 },
    ];
    const rect = minAreaRect([l])!;
    expect(rect.width * rect.depth).toBeCloseTo(12, 6); // the axis-aligned 4 x 3; the hull's slanted edge gives about 15
    expect(rect.width).toBeCloseTo(4, 6);
    expect(rect.depth).toBeCloseTo(3, 6);
    expect(rect.x).toBeCloseTo(2, 6);
    expect(rect.z).toBeCloseTo(1.5, 6);
  });

  it("finds the tight rectangle of a turned L, not its bounding box", () => {
    const l: Local[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
      { x: 0, z: 3 },
    ];
    const angle = 0.5;
    const turned = l.map((p) => ({ x: p.x * Math.cos(angle) - p.z * Math.sin(angle), z: p.x * Math.sin(angle) + p.z * Math.cos(angle) }));
    const rect = minAreaRect([turned])!;
    expect(rect.width * rect.depth).toBeCloseTo(12, 5);
  });

  it("gives a footprint with no area a thin rectangle, and nothing for no points", () => {
    const segment = minAreaRect([[{ x: 0, z: 0 }, { x: 6, z: 0 }]])!;
    expect(segment.width).toBeCloseTo(6, 6);
    expect(segment.depth).toBeGreaterThan(0);
    expect(minAreaRect([[{ x: 1, z: 1 }]])!.width).toBeGreaterThan(0);
    expect(minAreaRect([])).toBeNull();
  });
});

describe("boxes", () => {
  it("boxesOf keeps one rectangle per outer ring, with its lift and height", () => {
    const boxes = boxesOf([rotated(0, 0, 4, 2, 0), rotated(20, 0, 4, 2, 0)], 1.5, 9);
    expect(boxes).toHaveLength(2 * BOX_STRIDE);
    expect(boxes.slice(5, 7)).toEqual([1.5, 9]);
    expect(boxes.slice(BOX_STRIDE + 5, BOX_STRIDE + 7)).toEqual([1.5, 9]);
  });

  it("appendBoxes writes 12 triangles a box, every one wound outward, and the base lift at each vertex", () => {
    const positions: number[] = [];
    const lifts: number[] = [];
    // A 6 x 4 footprint turned 0.7 rad, 10 m tall, standing 2 m up in the chunk, whose origin is 100 m up.
    appendBoxes(positions, lifts, boxesOf([rotated(30, -20, 6, 4, 0.7)], 2, 10), 100);
    expect(positions).toHaveLength(BOX_VERTICES * 3);
    expect(lifts).toEqual(new Array(BOX_VERTICES).fill(102));
    const centre = [30, 107, -20];
    for (let t = 0; t < 12; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => positions.slice((t * 3 + k) * 3, (t * 3 + k) * 3 + 3));
      const [ab, ac] = [b.map((v, i) => v - a[i]), c.map((v, i) => v - a[i])];
      const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      expect(normal[0] * (a[0] - centre[0]) + normal[1] * (a[1] - centre[1]) + normal[2] * (a[2] - centre[2])).toBeGreaterThan(0);
    }
    const ys = positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(102, 6);
    expect(Math.max(...ys)).toBeCloseTo(112, 6);
  });
});
