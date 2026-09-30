import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  return { map, shown: () => map.resize() };
}
