import * as maplibregl from "maplibre-gl";
import type { BlockFeedback, Feature, GeneratedBuildingProperties, MapData } from "../api/types";
import { roadWidthExpression } from "../geo/roadWidth";
import { createBlockPanel, type BlockFeedbackApi, type BlockPanel } from "../scene/blockPanel";
import { generatedOrigin } from "../scene/generationMessages";
import { BLOCK_FILL_FILTER, blockEntries, blockOutlines, blockUnder, type BlockEntry } from "./blockOutlines";
import { Coalescer } from "./coalesce";
import { MAP_COLORS } from "./mapColors";
import { LAYERS, SOURCE_KEYS, slimCollection, type LayerName, type PropertyLookup, type SlimCollection } from "./mapSources";

const CLICKABLE = ["engine-area-features", "engine-roads", "engine-buildings", "engine-generated"];
/** What a click on a block yields to: when one of these is under the click, its popup shows and the block isn't selected. */
const ABOVE_BLOCKS = ["engine-roads", "engine-buildings", "engine-generated"];

/** The source each clickable layer draws, to find a clicked feature's full properties. */
const LAYER_SOURCE: Record<string, LayerName> = {
  "engine-area-features": "area_features",
  "engine-blocks": "blocks",
  "engine-roads": "road_segments",
  "engine-buildings": "buildings",
  "engine-generated": "generated_buildings",
};

const OUTLINES = "engine-block_outlines";

/** Past this zoom a source's tiles are overzoomed (vector, so still crisp) instead of cut finer; `tolerance` is the simplification, in tile units. */
const SOURCE_OPTIONS = { maxzoom: 16, tolerance: 0.5 } as const;
const emptyCollection = () => ({ type: "FeatureCollection" as const, features: [] });

/** Selecting a block on the map needs the API (for its feedback) and somewhere to put the panel. */
export interface BlockSelectionOptions {
  api: BlockFeedbackApi;
  host: HTMLElement;
}

export class MapDataLayers {
  private readonly popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });
  private popupsEnabled = true;
  private blocks: BlockEntry[] = [];
  private storedGenerated: SlimCollection = slimCollection(null, []);
  /** Every layer's features' full properties by source id: the sources only carry what their paint reads (`SOURCE_KEYS`). */
  private properties: Record<LayerName, PropertyLookup> = Object.fromEntries(LAYERS.map((name) => [name, new Map()])) as Record<LayerName, PropertyLookup>;
  /** The last response drawn: the same object again changes nothing. */
  private drawn: MapData | null = null;
  /** The streamed generated buildings reach the map at most once a second, and not at all while it is hidden. */
  private readonly generated = new Coalescer<Feature<GeneratedBuildingProperties>[] | null>((features) => this.drawGenerated(features));
  private selected: string | null = null;
  private readonly panel: BlockPanel | undefined;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.selected) this.select(null);
  };

  constructor(private readonly map: maplibregl.Map, selection?: BlockSelectionOptions) {
    for (const name of LAYERS) map.addSource(sourceId(name), { type: "geojson", data: emptyCollection(), ...SOURCE_OPTIONS });
    map.addSource(OUTLINES, { type: "geojson", data: emptyCollection(), ...SOURCE_OPTIONS });
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
    if (selection) {
      this.panel = createBlockPanel(selection.host, selection.api, (blockId, feedback) => this.feedbackChanged(blockId, feedback), () => this.select(null));
      // Registered before the layers' own handlers, so a click on a block (and no road or building on it) is the block's:
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
    this.generated.cancel();
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
   * the stored run's, and `show` redraws the layer from map-data the next time the area is shown. A job streams one
   * update per block, each with everything so far, so they are coalesced (`Coalescer`): held while the map is hidden,
   * and applied at most once a second while it shows, the last one always landing.
   */
  setGeneratedBuildings(features: Feature<GeneratedBuildingProperties>[] | null): void {
    this.generated.push(features);
  }

  /** Whether the map is on screen: a hidden map takes no generated buildings until it shows again (then the latest). */
  setVisible(visible: boolean): void {
    this.generated.setVisible(visible);
  }

  private drawGenerated(features: Feature<GeneratedBuildingProperties>[] | null): void {
    const slim = features ? slimCollection({ features }, SOURCE_KEYS.generated_buildings) : this.storedGenerated;
    this.properties.generated_buildings = slim.properties;
    (this.map.getSource(sourceId("generated_buildings")) as maplibregl.GeoJSONSource).setData(slim.data as never);
  }

  show(data: MapData): void {
    if (data === this.drawn) return;
    this.drawn = data;
    this.generated.cancel(); // the area's own data replaces whatever a job had streamed
    this.storedGenerated = slimCollection(data.generated_buildings, SOURCE_KEYS.generated_buildings);
    this.blocks = blockEntries(data);
    (this.map.getSource(OUTLINES) as maplibregl.GeoJSONSource).setData(blockOutlines(data) as never);
    if (this.selected) this.select(null); // a new area, or the same one reloaded: the old selection's properties are stale
    // Roads drawn at their generated carriageway width, in meters on the ground.
    this.map.setPaintProperty("engine-roads", "line-width", roadWidthExpression(data.projection.origin.latitude) as never);
    for (const name of LAYERS) {
      const slim = name === "generated_buildings" ? this.storedGenerated : slimCollection(data[name], SOURCE_KEYS[name]);
      this.properties[name] = slim.properties;
      (this.map.getSource(sourceId(name)) as maplibregl.GeoJSONSource).setData(slim.data as never);
    }
  }

  /** A clicked feature's full properties from `properties` (its source id is numeric), else the little its tile carries. */
  private fullProperties(feature: maplibregl.MapGeoJSONFeature): Record<string, unknown> {
    const source = LAYER_SOURCE[feature.layer.id];
    const full = source && typeof feature.id === "number" ? this.properties[source].get(feature.id) : undefined;
    return full ?? feature.properties ?? {};
  }

  private describe(event: maplibregl.MapLayerMouseEvent): void {
    if (!this.popupsEnabled) return;
    const feature = event.features?.[0];
    if (!feature) return;
    // Only the top-most clicked layer describes itself.
    if (event.originalEvent.defaultPrevented) return;
    event.originalEvent.preventDefault();
    this.popup.setLngLat(event.lngLat).setDOMContent(describeFeature(feature.layer.id, this.fullProperties(feature))).addTo(this.map);
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
};

/** The popup's rows, from the full properties (`MapDataLayers.properties`), where `street` is an object. A tile's copy, which MapLibre flattens (`street` becomes a JSON string), is read too. */
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
