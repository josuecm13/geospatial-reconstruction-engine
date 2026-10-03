import type * as maplibregl from "maplibre-gl";

/** The parts of a MapLibre map that the rectangle and boundary tools touch. */
export function fakeMap(): maplibregl.Map {
  const toggle = { enable() {}, disable() {} };
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  return {
    addSource() {},
    addLayer() {},
    getSource: () => undefined,
    getCanvas: () => canvas,
    getCanvasContainer: () => container,
    dragPan: toggle,
    boxZoom: toggle,
    doubleClickZoom: toggle,
    on() {},
    off() {},
  } as unknown as maplibregl.Map;
}
