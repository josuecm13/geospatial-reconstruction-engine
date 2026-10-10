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
    const { map, click } = fakeMap();
    const layers = new MapDataLayers(map);
    // MapLibre defines `remove` per instance (an arrow-function field), not on the prototype.
    const popup = (layers as unknown as { popup: maplibregl.Popup }).popup;
    const remove = vi.spyOn(popup, "remove").mockReturnValue(popup);
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

  it("says where a generated building came from: a block, defaults, or your count", () => {
    const rows = (properties: Record<string, unknown>) => Object.fromEntries(featureRows("engine-generated", { height_meters: 6.4, levels: 2, style: "regular", ...properties }));

    expect(rows({ count_source: "reference", reference_block_id: "0123456789abcdef" })).toEqual({ Origin: "Generated · from block 01234567", Height: "6.4 m", Levels: "2", Style: "regular" });
    // MapLibre hands a null property back as the string "null".
    expect(rows({ count_source: "default", reference_block_id: "null" }).Origin).toBe("Generated · defaults");
    expect(rows({ count_source: "default", reference_block_id: null }).Origin).toBe("Generated · defaults");
    expect(rows({ count_source: "feedback", reference_block_id: "0123456789abcdef" }).Origin).toBe("Generated · from your count");
  });

  it("shows an unknown building height as unknown, never as zero", () => {
    const rows = Object.fromEntries(featureRows("engine-buildings", { category: "residential", height_meters: null, levels: 5, block_id: null }));
    expect(rows).toEqual({ Category: "residential", Height: "unknown", Levels: "5", "In a block": "no" });
  });
});
