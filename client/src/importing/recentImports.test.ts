import { describe, expect, it } from "vitest";
import type { ImportArea } from "../api/types";
import { CurrentArea, describeArea, findByBbox } from "./recentImports";

class MemoryStore {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const bbox = { min_latitude: 52.5285, min_longitude: 13.3995, max_latitude: 52.531, max_longitude: 13.4035 };
const area = (id: string, over: Partial<ImportArea> = {}): ImportArea => ({
  id, provider: "osm", bbox, status: "completed", road_count: 61, node_count: 1, building_count: 147, poi_count: 0,
  area_feature_count: 0, block_count: 15, linked_building_count: null, imported_at: "2026-09-30T17:18:33Z", ...over,
});

describe("findByBbox", () => {
  it("finds an earlier import of exactly the same rectangle", () => {
    const areas = [area("a", { bbox: { ...bbox, max_latitude: 52.532 } }), area("b")];

    expect(findByBbox(areas, { ...bbox })?.id).toBe("b");
    expect(findByBbox(areas, { ...bbox, max_longitude: 13.404 })).toBeUndefined();
  });
});

describe("describeArea", () => {
  it("names the center, the counts, and a missing import time", () => {
    const label = describeArea(area("a", { imported_at: null }));
    expect(label).toBe("52.5297, 13.4015 · never completed · 147 buildings, 61 roads");
  });
});

describe("CurrentArea", () => {
  it("remembers the last opened area and ignores clearing to null", () => {
    const current = new CurrentArea(new MemoryStore());
    current.id = "a1";
    current.id = null;

    expect(current.id).toBe("a1");
  });
});
