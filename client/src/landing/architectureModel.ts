/** The pipeline the landing page draws: what each stage produces and where its doc lives. Pure data, no DOM. */

const DOCS = "https://github.com/josuecm13/geospatial-reconstruction-engine/blob/main/docs";

export interface Stage {
  id: string;
  title: string;
  /** One line under the title inside the diagram. */
  caption: string;
  /** What the stage hands to the next one, for the side card. */
  produces: string[];
  /** A section of the project's docs on GitHub. */
  docHref: string;
  docLabel: string;
}

export interface Edge {
  from: string;
  to: string;
}

/** In pipeline order: the data flows from the first stage to the last. */
export const STAGES: readonly Stage[] = [
  {
    id: "overpass",
    title: "Overpass",
    caption: "OpenStreetMap",
    produces: ["Roads, building footprints, points of interest and parks for a rectangle of up to 1 km²", "Fetched live, or replayed from a fixture"],
    docHref: `${DOCS}/architecture.md#osm-translation`,
    docLabel: "OSM translation",
  },
  {
    id: "ingestion",
    title: "Ingestion",
    caption: "parse, reconcile",
    produces: [
      "Application-level records: OSM tags never cross into the domain",
      "A reconciling re-import: unchanged data keeps its ids, removed data goes",
      "Background jobs that announce each stage as it finishes",
    ],
    docHref: `${DOCS}/architecture.md#background-imports`,
    docLabel: "Background imports",
  },
  {
    id: "domain",
    title: "PostGIS domain",
    caption: "the model it owns",
    produces: ["Road segments and navigable nodes", "Logical streets, buildings, points of interest and area features", "Blocks and traced boundaries over an import area"],
    docHref: `${DOCS}/architecture.md#core-domain-entities`,
    docLabel: "Core domain entities",
  },
  {
    id: "derivation",
    title: "Derivation",
    caption: "cross-sections, blocks, turns",
    produces: [
      "Lanes, lane type and width for every street",
      "Blocks enclosed by roads, with a buildable area and a median flag",
      "A turn graph the router searches",
    ],
    docHref: `${DOCS}/schema.md#blocks-and-buildings--the-primary-focus`,
    docLabel: "Blocks and buildings",
  },
  {
    id: "api",
    title: "HTTP API",
    caption: "map-data, routes, events",
    produces: ["GeoJSON map-data per area or traced boundary, with a local projection", "Routes between two points", "Server-sent events while an import builds", "Exports in filter and clip modes"],
    docHref: `${DOCS}/architecture.md#api-and-visualization`,
    docLabel: "API and visualization",
  },
  {
    id: "client",
    title: "This client",
    caption: "2D map, 3D scene",
    produces: ["A 2D map to choose a place and trace boundaries", "A low-poly 3D scene to fly over and walk through, with buildings raised to their source heights (paler where the height is a default)", "glTF export of the scene"],
    docHref: `${DOCS}/client-features.md`,
    docLabel: "Client features",
  },
];

/** Each stage feeds the next. */
export const EDGES: readonly Edge[] = STAGES.slice(1).map((stage, i) => ({ from: STAGES[i].id, to: stage.id }));

export function stageById(id: string): Stage | undefined {
  return STAGES.find((stage) => stage.id === id);
}
