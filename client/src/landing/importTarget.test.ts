import { describe, expect, it } from "vitest";
import type { ImportArea } from "../api/types";
import { importTarget } from "./importTarget";

const area = (id: string): ImportArea => ({
  id,
  provider: "osm",
  bbox: { min_latitude: 1, min_longitude: 2, max_latitude: 3, max_longitude: 4 },
  status: "completed",
  road_count: 1,
  node_count: 1,
  building_count: 1,
  poi_count: 0,
  area_feature_count: 0,
  block_count: 0,
  linked_building_count: null,
  imported_at: null,
});

describe("importTarget", () => {
  it("opens the area remembered in this browser", () => {
    expect(importTarget([area("a"), area("b")], "b")).toEqual({ page: "explore", areaId: "b", view: "map", scope: null, at: null });
  });

  it("falls back to the most recent listed area", () => {
    expect(importTarget([area("a"), area("b")], null)).toEqual({ page: "explore", areaId: "a", view: "map", scope: null, at: null });
  });

  it("opens the map with nothing open when there is no area yet", () => {
    expect(importTarget([], null)).toEqual({ page: "explore", areaId: null, view: "map", scope: null, at: null });
  });
});
