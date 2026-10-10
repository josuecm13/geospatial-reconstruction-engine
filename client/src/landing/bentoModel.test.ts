import { describe, expect, it } from "vitest";
import type { MapData, Position } from "../api/types";
import { evenSample, farthestPairs, formatDistance, glbName, groundDistance, hashString, seeded, streetBuildings } from "./bentoModel";

describe("farthestPairs", () => {
  const nodes: Position[] = [
    [0, 0],
    [0.001, 0],
    [0.005, 0.004],
    [0.0051, 0.0001],
  ];

  it("puts the pair with the greatest ground distance first", () => {
    const [first] = farthestPairs(nodes, 1);
    expect(first[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(first[1]).toEqual({ latitude: 0.004, longitude: 0.005 });
  });

  it("orders the rest by distance and stops at the count", () => {
    const pairs = farthestPairs(nodes, 3);
    expect(pairs).toHaveLength(3);
    const metres = pairs.map(([a, b]) => groundDistance([a.longitude, a.latitude], [b.longitude, b.latitude]));
    expect(metres).toEqual([...metres].sort((x, y) => y - x));
  });

  it("is empty with fewer than two nodes", () => {
    expect(farthestPairs([[1, 1]])).toEqual([]);
  });
});

describe("evenSample", () => {
  it("keeps everything under the limit and spreads the rest", () => {
    expect(evenSample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(evenSample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("labels", () => {
  it("formats distances", () => {
    expect(formatDistance(1420)).toBe("1.42 km");
    expect(formatDistance(640.4)).toBe("640 m");
  });
  it("names the glb after the first eight characters of the id", () => {
    expect(glbName("795cfebc-f2ee-4445-a343-1f63b5948f8a")).toBe("gre-area-795cfebc.glb");
  });
});

describe("streetBuildings", () => {
  it("is stable for a seed and marks seeded heights as assumed", () => {
    expect(streetBuildings(null, 7, 6)).toEqual(streetBuildings(null, 7, 6));
    expect(streetBuildings(null, 7, 6).every((b) => b.defaulted)).toBe(true);
  });

  it("uses the area's own heights when it has buildings", () => {
    const data = {
      buildings: { features: [{ properties: { height_meters: 21, levels: null, category: "house" } }] },
    } as unknown as MapData;
    expect(streetBuildings(data, 1, 4)).toEqual(Array(4).fill({ height: 21, defaulted: false }));
  });
});

describe("seeded", () => {
  it("repeats for the same seed and differs between seeds", () => {
    const a = seeded(hashString("a"));
    const b = seeded(hashString("a"));
    expect([a(), a()]).toEqual([b(), b()]);
    expect(seeded(1)()).not.toBe(seeded(2)());
  });
});
