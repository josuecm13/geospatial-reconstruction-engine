import * as maplibregl from "maplibre-gl";
import type { BlockFeedback, Feature, GeneratedBuildingProperties, MapData } from "../api/types";
import { roadWidthExpression } from "../geo/roadWidth";
import { createBlockPanel, type BlockFeedbackApi, type BlockPanel } from "../scene/blockPanel";
import { generatedOrigin } from "../scene/generationMessages";
import { BLOCK_FILL_FILTER, blockEntries, blockOutlines, blockUnder, type BlockEntry } from "./blockOutlines";
import { MAP_COLORS } from "./mapColors";

/** The engine's own representation of an imported area, drawn over the basemap: this is what was
 * served from the API, not the basemap's rendering of OSM. */
const LAYERS = ["area_features", "generation_zones", "blocks", "road_segments", "buildings", "generated_buildings", "pois"] as const;
type LayerName = (typeof LAYERS)[number];

const CLICKABLE = ["engine-area-features", "engine-roads", "engine-buildings", "engine-generated", "engine-pois"];
/** What a click on a block yields to: when one of these is under the click, its popup shows and the block isn't selected. */
const ABOVE_BLOCKS = ["engine-roads", "engine-buildings", "engine-generated", "engine-pois"];

const OUTLINES = "engine-block_outlines";

/** Selecting a block on the map needs the API (for its feedback) and somewhere to put the panel. */
export interface BlockSelectionOptions {
  api: BlockFeedbackApi;
  host: HTMLElement;
}

export class MapDataLayers {
  private readonly popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });
  private popupsEnabled = true;
  private blocks: BlockEntry[] = [];
  private storedGenerated: unknown = { type: "FeatureCollection", features: [] };
  private selected: string | null = null;
  private readonly panel: BlockPanel | undefined;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.selected) this.select(null);
  };

  constructor(private readonly map: maplibregl.Map, selection?: BlockSelectionOptions) {
    for (const name of LAYERS) map.addSource(sourceId(name), { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource(OUTLINES, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "engine-area-features",
      type: "fill",
      source: sourceId("area_features"),
      paint: {
        "fill-color": [
          "match",
          ["get", "kind"],
          "water", MAP_COLORS.water,
          "forest", MAP_COLORS.forest,
          "farmland", MAP_COLORS.farmland,
          "cemetery", MAP_COLORS.cemetery,
          "railway", MAP_COLORS.railway,
          "industrial", MAP_COLORS.industrial,
          MAP_COLORS.green,
        ],
        "fill-opacity": 0.9,
      },
    });
    map.addLayer({
      id: "engine-zones",
      type: "fill",
      source: sourceId("generation_zones"),
      // Where the last run kept buildings off, by reason.
      paint: {
        "fill-color": ["match", ["get", "reason"], "water", MAP_COLORS.zoneWater, "steep", MAP_COLORS.zoneSteep, "landuse", MAP_COLORS.zoneLanduse, MAP_COLORS.zoneSetback],
        "fill-opacity": 0.3,
      },
    });
    map.addLayer({
      id: "engine-blocks",
      type: "fill",
      source: sourceId("blocks"),
      filter: BLOCK_FILL_FILTER as unknown as maplibregl.FilterSpecification,
      paint: { "fill-color": ["case", ["get", "is_median"], MAP_COLORS.blockMedian, MAP_COLORS.buildable], "fill-opacity": 0.45, "fill-outline-color": MAP_COLORS.buildableOutline },
    });
    // Each block's outline, 1.5 m inside its boundary: crisp dashes for an eligible block, a different dash for a reference block,
    // faint dots for the rest, and a solid highlight for the selected one. `line-dasharray` can't be data-driven, so one layer each.
    const outline = (id: string, kind: string, paint: maplibregl.LineLayerSpecification["paint"], round = false): maplibregl.LayerSpecification => ({
      id,
      type: "line",
      source: OUTLINES,
      filter: ["==", ["get", "kind"], kind],
      layout: round ? { "line-cap": "round" } : {},
      paint,
    });
    map.addLayer(outline("engine-block-outline", "crisp", { "line-color": MAP_COLORS.blockOutline, "line-width": 1.5, "line-dasharray": [4, 2] }));
    map.addLayer(outline("engine-block-outline-reference", "reference", { "line-color": MAP_COLORS.blockReference, "line-width": 1.75, "line-dasharray": [8, 2] }));
    map.addLayer(outline("engine-block-outline-faint", "faint", { "line-color": MAP_COLORS.blockOutline, "line-width": 1.5, "line-opacity": 0.45, "line-dasharray": [0.1, 2.5] }, true));
    map.addLayer({
      id: "engine-block-selected",
      type: "line",
      source: OUTLINES,
      filter: ["==", ["get", "id"], ""],
      paint: { "line-color": MAP_COLORS.blockSelected, "line-width": 3 },
    });
    map.addLayer({
      id: "engine-roads",
      type: "line",
      source: sourceId("road_segments"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "lane_type"], "wide", MAP_COLORS.roadWide, "narrow", MAP_COLORS.roadNarrow, MAP_COLORS.roadNormal],
        "line-width": 2,
      },
    });
    map.addLayer({
      id: "engine-buildings",
      type: "fill",
      source: sourceId("buildings"),
      paint: {
        // Measured heights are pale; unknown ones are dimmer, so the difference is visible at a glance.
        "fill-color": ["case", ["==", ["get", "height_meters"], null], MAP_COLORS.buildingDefaulted, MAP_COLORS.buildingMeasured],
        "fill-opacity": 0.85,
        "fill-outline-color": MAP_COLORS.buildingOutline,
      },
    });
    map.addLayer({
      id: "engine-generated",
      type: "fill",
      source: sourceId("generated_buildings"),
      // Cool blue: generated, not observed, so the two never read as one.
      paint: { "fill-color": MAP_COLORS.buildingGenerated, "fill-opacity": 0.85, "fill-outline-color": MAP_COLORS.buildingOutline },
    });
    map.addLayer({
      id: "engine-pois",
      type: "circle",
      source: sourceId("pois"),
      paint: { "circle-radius": 4, "circle-color": MAP_COLORS.poi, "circle-stroke-color": MAP_COLORS.poiStroke, "circle-stroke-width": 1 },
    });
    if (selection) {
      this.panel = createBlockPanel(selection.host, selection.api, (blockId, feedback) => this.feedbackChanged(blockId, feedback), () => this.select(null));
      // Registered before the layers' own handlers, so a click on a block (and no road, building or point on it) is the block's:
      // preventDefault keeps the popup of the area feature under it from opening too.
      map.on("click", (event) => this.clicked(event));
      window.addEventListener("keydown", this.onKeyDown);
    }
    // Without block selection, a click on a block describes it in a popup like the other layers.
    for (const id of selection ? CLICKABLE : [...CLICKABLE, "engine-blocks"]) {
      map.on("click", id, (event) => this.describe(event));
      map.on("mouseenter", id, () => {
        if (this.popupsEnabled) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
  }

  /** Removes the `window` listener and the block panel; call when the page is left. */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.panel?.dispose();
  }

  /** Turned off while a boundary is being traced, so a click places a vertex and nothing else; closes an open popup. */
  setPopupsEnabled(enabled: boolean): void {
    this.popupsEnabled = enabled;
    if (!enabled) this.popup.remove();
  }

  /** The block under a click selects; a click on no block deselects; a click on something drawn over blocks leaves it to that layer's popup. */
  private clicked(event: maplibregl.MapMouseEvent): void {
    if (!this.popupsEnabled) return;
    if (this.map.queryRenderedFeatures(event.point, { layers: ABOVE_BLOCKS }).length) return;
    const block = blockUnder(this.blocks, event.lngLat);
    if (block) event.originalEvent.preventDefault();
    this.select(block?.id ?? null);
  }

  private select(id: string | null): void {
    this.selected = id;
    this.map.setFilter("engine-block-selected", ["==", ["get", "id"], id ?? ""]);
    const block = this.blocks.find((entry) => entry.id === id);
    this.popup.remove();
    this.panel?.show(block ? { id: block.id, properties: block.properties } : null);
  }

  private feedbackChanged(blockId: string, feedback: BlockFeedback | null): void {
    const block = this.blocks.find((entry) => entry.id === blockId);
    if (block) block.properties = { ...block.properties, feedback };
  }

  /**
   * The generated layer while a generation job streams: these buildings (every one streamed so far) replace the
   * stored ones, which come back with `null` (the job failed). Left as they are when the job completes: they are
   * the stored run's, and `show` redraws the layer from map-data the next time the area is shown.
   */
  setGeneratedBuildings(features: Feature<GeneratedBuildingProperties>[] | null): void {
    const data = features ? { type: "FeatureCollection", features } : this.storedGenerated;
    (this.map.getSource(sourceId("generated_buildings")) as maplibregl.GeoJSONSource).setData(data as never);
  }

  show(data: MapData): void {
    this.storedGenerated = data.generated_buildings ?? { type: "FeatureCollection", features: [] };
    this.blocks = blockEntries(data);
    (this.map.getSource(OUTLINES) as maplibregl.GeoJSONSource).setData(blockOutlines(data) as never);
    if (this.selected) this.select(null); // a new area, or the same one reloaded: the old selection's properties are stale
    // Roads drawn at their generated carriageway width, in meters on the ground.
    this.map.setPaintProperty("engine-roads", "line-width", roadWidthExpression(data.projection.origin.latitude) as never);
    for (const name of LAYERS) {
      (this.map.getSource(sourceId(name)) as maplibregl.GeoJSONSource).setData((data[name] ?? { type: "FeatureCollection", features: [] }) as never);
    }
  }

  private describe(event: maplibregl.MapLayerMouseEvent): void {
    if (!this.popupsEnabled) return;
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
  "engine-generated": "Generated building",
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
    case "engine-generated":
      return [
        ["Origin", generatedOrigin({ count_source: String(properties.count_source), reference_block_id: properties.reference_block_id == null || properties.reference_block_id === "null" ? null : String(properties.reference_block_id) })],
        ["Height", `${Number(properties.height_meters).toFixed(1)} m`],
        ["Levels", value(properties.levels)],
        ["Style", value(properties.style)],
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
