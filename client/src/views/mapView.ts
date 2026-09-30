import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre looks for its worker next to its own module, which Vite's bundling moves. Have Vite
// bundle the worker itself and hand MapLibre that URL, in dev and in the build alike.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(workerUrl);

/** OpenFreeMap's keyless vector style, built from OpenStreetMap data; it carries its own attribution. */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export interface MapView {
  map: maplibregl.Map;
  /** MapLibre needs a resize once its container becomes visible again. */
  shown(): void;
}

export function createMapView(container: HTMLElement): MapView {
  const map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: [13.401, 52.5297],
    zoom: 15,
    attributionControl: false,
  });
  // Expanded, never collapsed: the OpenStreetMap attribution must always be visible.
  map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }), "bottom-right");
  // The basemap style names POI icons its own sprite doesn't have (atm, gate, office, …). Give each
  // one a transparent placeholder once, so the console isn't flooded and real errors stay visible.
  const blank = { width: 1, height: 1, data: new Uint8Array(4) };
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, blank);
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  return { map, shown: () => map.resize() };
}
