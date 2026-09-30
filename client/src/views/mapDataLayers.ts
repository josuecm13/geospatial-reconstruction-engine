import * as maplibregl from "maplibre-gl";
import type { MapData } from "../api/types";
import { roadWidthExpression } from "../geo/roadWidth";

/** The engine's own representation of an imported area, drawn over the basemap: this is what was
 * served from the API, not the basemap's rendering of OSM. */
const LAYERS = ["area_features", "blocks", "road_segments", "buildings", "pois"] as const;
type LayerName = (typeof LAYERS)[number];

const CLICKABLE = ["engine-area-features", "engine-roads", "engine-buildings", "engine-pois", "engine-blocks"];

export class MapDataLayers {
  private readonly popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });

  constructor(private readonly map: maplibregl.Map) {
    for (const name of LAYERS) map.addSource(sourceId(name), { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "engine-area-features",
      type: "fill",
      source: sourceId("area_features"),
      paint: { "fill-color": ["match", ["get", "kind"], "water", "#7fb8e6", "#9fd08a"], "fill-opacity": 0.7 },
    });
    map.addLayer({
      id: "engine-blocks",
      type: "fill",
      source: sourceId("blocks"),
      paint: { "fill-color": ["case", ["get", "is_median"], "#c9b37a", "#e8dcc0"], "fill-opacity": 0.45, "fill-outline-color": "#a8946a" },
    });
    map.addLayer({
      id: "engine-roads",
      type: "line",
      source: sourceId("road_segments"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "lane_type"], "wide", "#e0a33a", "narrow", "#b9b9b9", "#f4f1ea"],
        "line-width": 2,
      },
    });
    map.addLayer({
      id: "engine-buildings",
      type: "fill",
      source: sourceId("buildings"),
      paint: {
        // Measured heights are solid; unknown ones are paler, so the difference is visible at a glance.
        "fill-color": ["case", ["==", ["get", "height_meters"], null], "#b7a8c9", "#6f5a8c"],
        "fill-opacity": 0.85,
        "fill-outline-color": "#3d2f52",
      },
    });
    map.addLayer({
      id: "engine-pois",
      type: "circle",
      source: sourceId("pois"),
      paint: { "circle-radius": 4, "circle-color": "#d1495b", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 },
    });
    for (const id of CLICKABLE) {
      map.on("click", id, (event) => this.describe(event));
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
  }

  show(data: MapData): void {
    // Roads drawn at their generated carriageway width, in meters on the ground.
    this.map.setPaintProperty("engine-roads", "line-width", roadWidthExpression(data.projection.origin.latitude) as never);
    for (const name of LAYERS) {
      (this.map.getSource(sourceId(name)) as maplibregl.GeoJSONSource).setData(data[name] as never);
    }
  }

  private describe(event: maplibregl.MapLayerMouseEvent): void {
    const feature = event.features?.[0];
    if (!feature) return;
    // Only the top-most clicked layer describes itself.
    if (event.originalEvent.defaultPrevented) return;
    event.originalEvent.preventDefault();
    this.popup.setLngLat(event.lngLat).setDOMContent(describeFeature(feature.layer.id, feature.properties ?? {})).addTo(this.map);
  }
}

function sourceId(name: LayerName): string {
  return `engine-${name}`;
}

const TITLES: Record<string, string> = {
  "engine-area-features": "Area feature",
  "engine-blocks": "Block",
  "engine-roads": "Road segment",
  "engine-buildings": "Building",
  "engine-pois": "Point of interest",
};

/** MapLibre flattens nested properties to JSON strings; `street` is one. */
export function featureRows(layerId: string, properties: Record<string, unknown>): [string, string][] {
  const value = (v: unknown) => (v === null || v === undefined || v === "null" ? "unknown" : String(v));
  switch (layerId) {
    case "engine-roads": {
      const street = typeof properties.street === "string" ? JSON.parse(properties.street) : (properties.street as Record<string, unknown>);
      return [
        ["Street", value(street?.name ?? null)],
        ["Class", value(street?.classification)],
        ["Lanes", `${value(properties.lane_count)} (${value(properties.lane_count_provenance)})`],
        ["Lane type", value(properties.lane_type)],
        ["Width", `${Number(properties.width_meters).toFixed(1)} m`],
        ["Length", `${Number(properties.distance_meters).toFixed(1)} m`],
      ];
    }
    case "engine-buildings":
      return [
        ["Category", value(properties.category)],
        ["Height", properties.height_meters == null || properties.height_meters === "null" ? "unknown" : `${Number(properties.height_meters).toFixed(1)} m`],
        ["Levels", value(properties.levels)],
        ["In a block", properties.block_id == null || properties.block_id === "null" ? "no" : "yes"],
      ];
    case "engine-blocks":
      return [
        ["Area", `${Math.round(Number(properties.area_square_meters))} m²`],
        ["Buildable", `${Math.round(Number(properties.buildable_area_square_meters))} m²`],
        ["Median", value(properties.is_median)],
        ["Clipped by the rectangle", value(properties.is_clipped)],
      ];
    case "engine-pois":
      return [["Name", value(properties.name)], ["Category", value(properties.category)]];
    default:
      return [["Kind", value(properties.kind)]];
  }
}

function describeFeature(layerId: string, properties: Record<string, unknown>): HTMLElement {
  const root = document.createElement("div");
  root.className = "feature-popup";
  const title = document.createElement("strong");
  title.textContent = TITLES[layerId] ?? "Feature";
  root.appendChild(title);
  const table = document.createElement("table");
  for (const [label, text] of featureRows(layerId, properties)) {
    const row = table.insertRow();
    row.insertCell().textContent = label;
    row.insertCell().textContent = text;
  }
  root.appendChild(table);
  return root;
}
