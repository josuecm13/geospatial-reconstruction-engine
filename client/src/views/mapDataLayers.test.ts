// @vitest-environment jsdom
import * as maplibregl from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { featureRows, MapDataLayers } from "./mapDataLayers";

/** A map that only records its layer click handlers. */
function fakeMap() {
  const handlers = new Map<string, (event: unknown) => void>();
  const map = {
    addSource() {},
    addLayer() {},
    getCanvas: () => ({ style: {} as Record<string, string> }),
    on(type: string, id: string, handler: (event: unknown) => void) {
      handlers.set(`${type}:${id}`, handler);
    },
  };
  const click = () =>
    handlers.get("click:engine-buildings")!({
      features: [{ layer: { id: "engine-buildings" }, properties: {} }],
      lngLat: { lng: 0, lat: 0 },
      originalEvent: { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } },
    });
  return { map: map as unknown as maplibregl.Map, click };
}

describe("MapDataLayers popups", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a popup on a click, but not while popups are disabled, and again once re-enabled", () => {
    const addTo = vi.spyOn(maplibregl.Popup.prototype, "addTo").mockReturnThis();
    const remove = vi.spyOn(maplibregl.Popup.prototype, "remove").mockReturnThis();
    const { map, click } = fakeMap();
    const layers = new MapDataLayers(map);
    click();
    expect(addTo).toHaveBeenCalledTimes(1);
    layers.setPopupsEnabled(false);
    expect(remove).toHaveBeenCalled();
    click();
    expect(addTo).toHaveBeenCalledTimes(1);
    layers.setPopupsEnabled(true);
    click();
    expect(addTo).toHaveBeenCalledTimes(2);
  });
});

describe("featureRows", () => {
  it("describes a road from MapLibre's flattened properties", () => {
    const rows = featureRows("engine-roads", {
      street: JSON.stringify({ id: "s1", name: "Torstraße", classification: "primary" }),
      lane_count: 2,
      lane_count_provenance: "defaulted",
      lane_type: "wide",
      width_meters: 7,
      distance_meters: 42.345,
    });
    expect(rows).toEqual([
      ["Street", "Torstraße"],
      ["Class", "primary"],
      ["Lanes", "2 (defaulted)"],
      ["Lane type", "wide"],
      ["Width", "7.0 m"],
      ["Length", "42.3 m"],
    ]);
  });

  it("shows an unknown building height as unknown, never as zero", () => {
    const rows = Object.fromEntries(featureRows("engine-buildings", { category: "residential", height_meters: null, levels: 5, block_id: null }));
    expect(rows).toEqual({ Category: "residential", Height: "unknown", Levels: "5", "In a block": "no" });
  });
});
