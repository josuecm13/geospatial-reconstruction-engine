import { describe, expect, it } from "vitest";
import type { ImportArea } from "../api/types";
import { MAX_RECENT, RecentImports } from "./recentImports";

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
  id, provider: "osm", bbox, status: "completed", road_count: 1, node_count: 1, building_count: 2, poi_count: 0,
  area_feature_count: 0, block_count: 0, linked_building_count: 0, imported_at: "2026-09-30T00:00:00Z", ...over,
});

describe("RecentImports", () => {
  it("keeps newest first and moves a re-import to the front without duplicating it", () => {
    const recent = new RecentImports(new MemoryStore());
    recent.record(area("a", { bbox: { ...bbox, max_latitude: 52.532 } }));
    recent.record(area("b"));
    recent.record(area("a", { building_count: 9, bbox: { ...bbox, max_latitude: 52.532 } }));

    expect(recent.list().map((item) => [item.id, item.buildingCount])).toEqual([["a", 9], ["b", 2]]);
  });

  it("finds an earlier import of the same rectangle", () => {
    const recent = new RecentImports(new MemoryStore());
    recent.record(area("b"));

    expect(recent.findByBbox({ ...bbox })?.id).toBe("b");
    expect(recent.findByBbox({ ...bbox, max_longitude: 13.404 })).toBeUndefined();
  });

  it("caps the list", () => {
    const recent = new RecentImports(new MemoryStore());
    for (let i = 0; i < MAX_RECENT + 3; i++) recent.record(area(`a${i}`, { bbox: { ...bbox, max_latitude: 52.531 + i / 1e4 } }));

    expect(recent.list()).toHaveLength(MAX_RECENT);
  });

  it("survives corrupt storage", () => {
    const store = new MemoryStore();
    store.setItem("gre.recentImports", "{not json");

    expect(new RecentImports(store).list()).toEqual([]);
  });
});
