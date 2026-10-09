import type { ApiClient } from "../api/client";
import type { BoundingBox, Geometry, MapData, Position, Route } from "../api/types";
import { previewTransform, projectToPreview } from "../locations/previewTransform";
import { farthestPairs, formatDistance, glbName, hashString, nodePositions, streetBuildings } from "./bentoModel";
import { num, svg } from "./svg";

/** The capabilities, in the order of the bento: the route is the hero tile. */
const COPY = {
  route: { index: "01", title: "Route across it", body: "Pick two points and the engine finds the way along the real street graph.", action: "Plan a route" },
  walk: { index: "02", title: "Walk through it", body: "Drop to street level and move through the place, stopped by its buildings.", action: "Start walking" },
  export: { index: "03", title: "Export it as glTF", body: "Take the whole model into a game engine or a modelling tool.", action: "Download the model" },
} as const;

type Capability = keyof typeof COPY;

const lines = (geometry: Geometry): Position[][] => {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

const rings = (geometry: Geometry): Position[][] => {
  if (geometry.type === "Polygon") return [geometry.coordinates[0] ?? []];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0] ?? []);
  return [];
};

type Project = (position: Position) => [number, number];

const linePath = (paths: Position[][], project: Project, close = false): string =>
  paths
    .filter((path) => path.length > 1)
    .map((path) => path.map((p, i) => `${i === 0 ? "M" : "L"}${project(p).map(num).join(" ")}`).join("") + (close ? "Z" : ""))
    .join("");

/** `bbox` grown to hold every road vertex: a road that crosses the rectangle's edge runs on outside it, and so can a route's end. */
function extentOf(bbox: BoundingBox, data: MapData): BoundingBox {
  const box = { ...bbox };
  for (const road of data.road_segments.features) {
    for (const [lon, lat] of lines(road.geometry).flat()) {
      box.min_longitude = Math.min(box.min_longitude, lon);
      box.max_longitude = Math.max(box.max_longitude, lon);
      box.min_latitude = Math.min(box.min_latitude, lat);
      box.max_latitude = Math.max(box.max_latitude, lat);
    }
  }
  return box;
}

/** The road network by lane tier, so each tier is one `<path>` the CSS can weigh differently. */
function roadPaths(data: MapData, project: Project): SVGPathElement[] {
  return (["narrow", "normal", "wide"] as const).map((tier) => {
    const geometry = data.road_segments.features.filter((f) => f.properties.lane_type === tier).flatMap((f) => lines(f.geometry));
    return svg("path", { d: linePath(geometry, project), class: `bento-road bento-road-${tier}` });
  });
}

function buildingPath(data: MapData, project: Project): SVGPathElement {
  const footprints = data.buildings.features.flatMap((f) => rings(f.geometry));
  return svg("path", { d: linePath(footprints, project, true), class: "bento-footprint" });
}

// --- 01: the route across the place ---

const ROUTE_W = 640;
const ROUTE_H = 780;

/** The network with the route on top (when there is one) and, over the route, its real distance. */
function routeVisual(bbox: BoundingBox, data: MapData, route: Route | null): SVGSVGElement {
  const transform = previewTransform(extentOf(bbox, data), ROUTE_W, ROUTE_H, 40);
  const project: Project = ([lon, lat]) => projectToPreview(transform, lon, lat);
  const root = svg("svg", { viewBox: `0 0 ${ROUTE_W} ${ROUTE_H}`, class: "bento-svg", role: "img", preserveAspectRatio: "xMidYMid meet" });
  const [west, north] = project([bbox.min_longitude, bbox.max_latitude]);
  const [east, south] = project([bbox.max_longitude, bbox.min_latitude]);
  root.append(
    svg("rect", { x: west, y: north, width: east - west, height: south - north, class: "bento-bounds" }),
    buildingPath(data, project),
    ...roadPaths(data, project),
  );

  const path = route?.geometry ? lines(route.geometry) : [];
  const points = path.flat();
  if (route && points.length > 1) {
    const [start, end] = [project(points[0]), project(points[points.length - 1])];
    root.append(
      svg("path", { d: linePath(path, project), class: "bento-route-glow", pathLength: 1 }),
      svg("path", { d: linePath(path, project), class: "bento-route-line", pathLength: 1 }),
      svg("circle", { cx: start[0], cy: start[1], r: 5, class: "bento-marker bento-marker-start" }),
      svg("circle", { cx: end[0], cy: end[1], r: 5, class: "bento-marker bento-marker-end" }),
    );
    root.setAttribute("aria-label", `The street network with a route across it, ${formatDistance(route.total_distance_meters)}`);
  } else {
    root.setAttribute("aria-label", "The street network of the featured place");
  }
  return root;
}

// --- 02: an eye-level street ---

const WALK_W = 400;
const WALK_H = 300;
const HORIZON = 120;
const FOCAL = 210;
const EYE = 1.6;
const HALF_ROAD = 5;
const KERB = 6.6;

/** A point of the street (X to the right, Y up, Z ahead, in metres) on the picture. */
const eye = (x: number, y: number, z: number): [number, number] => [WALK_W / 2 + (FOCAL * x) / z, HORIZON + (FOCAL * (EYE - y)) / z];
const quad = (corners: [number, number][]): string => `M${corners.map((c) => c.map(num).join(" ")).join("L")}Z`;

/** The street as parametric code: two rows of buildings at the area's heights, converging on a vanishing point. */
function walkVisual(data: MapData | null, seed: number): SVGSVGElement {
  const root = svg("svg", { viewBox: `0 0 ${WALK_W} ${WALK_H}`, class: "bento-svg", role: "img", preserveAspectRatio: "xMidYMid slice" });
  root.setAttribute("aria-label", "A street seen at eye level, lined with buildings at the heights of the featured place");

  const defs = svg("defs");
  const sky = svg("radialGradient", { id: `wt-sky-${seed}`, cx: "50%", cy: `${(HORIZON / WALK_H) * 100}%`, r: "70%" });
  sky.append(svg("stop", { offset: 0, class: "wt-sky-near" }), svg("stop", { offset: 1, class: "wt-sky-far" }));
  defs.append(sky);
  root.append(defs, svg("rect", { width: WALK_W, height: HORIZON + 1, fill: `url(#wt-sky-${seed})` }));

  root.append(
    svg("path", { d: quad([[0, HORIZON], [WALK_W, HORIZON], [WALK_W, WALK_H], [0, WALK_H]]), class: "wt-ground" }),
    svg("path", { d: quad([eye(-KERB, 0, 1.4), eye(KERB, 0, 1.4), eye(KERB, 0, 400), eye(-KERB, 0, 400)]), class: "wt-pavement" }),
    svg("path", { d: quad([eye(-HALF_ROAD, 0, 1.4), eye(HALF_ROAD, 0, 1.4), eye(HALF_ROAD, 0, 400), eye(-HALF_ROAD, 0, 400)]), class: "wt-road" }),
  );

  // The dashed centre line.
  const centre: string[] = [];
  for (let z = 3; z < 160; z += 7) centre.push(quad([eye(-0.08, 0, z), eye(0.08, 0, z), eye(0.08, 0, z + 3), eye(-0.08, 0, z + 3)]));
  root.append(svg("path", { d: centre.join(""), class: "wt-centre" }));

  // Two rows of buildings, drawn far to near.
  const random = hashString(String(seed));
  const heights = streetBuildings(data, random, 24);
  interface Block { side: -1 | 1; z0: number; z1: number; height: number; defaulted: boolean }
  const blocks: Block[] = [];
  ([-1, 1] as const).forEach((side, sideIndex) => {
    let z = 2.4 + sideIndex * 3.2;
    for (let i = 0; i < 12 && z < 180; i++) {
      const { height, defaulted } = heights[sideIndex * 12 + i];
      const length = 9 + ((random >>> (i + sideIndex * 3)) % 7) * 1.6;
      blocks.push({ side, z0: z, z1: z + length, height, defaulted });
      z += length + 1.2 + ((random >>> (i + 5)) % 3);
    }
  });
  blocks.sort((a, b) => b.z0 - a.z0);
  for (const { side, z0, z1, height, defaulted } of blocks) {
    const group = svg("g", { class: defaulted ? "wt-building wt-assumed" : "wt-building", opacity: num(0.3 + 0.7 * Math.exp(-z0 / 70)) });
    const x = side * KERB;
    group.append(
      svg("path", { d: quad([eye(x, 0, z0), eye(x, 0, z1), eye(x, height, z1), eye(x, height, z0)]), class: "wt-facade" }),
      svg("path", { d: quad([eye(x, 0, z0), eye(x + side * 9, 0, z0), eye(x + side * 9, height, z0), eye(x, height, z0)]), class: "wt-end" }),
    );
    const floors: string[] = [];
    for (let y = 3.2; y < height - 0.5; y += 3.2) floors.push(`M${eye(x, y, z0).map(num).join(" ")}L${eye(x, y, z1).map(num).join(" ")}`);
    if (floors.length) group.append(svg("path", { d: floors.join(""), class: "wt-floor" }));
    root.append(group);
  }

  // Footsteps leading away from the viewer: each one lights a moment after the one before it.
  const steps = svg("g", { class: "wt-steps" });
  for (let i = 0; i < 12; i++) {
    const z = 2.6 + i * 2.3;
    const [cx, cy] = eye(i % 2 ? 0.45 : -0.45, 0, z);
    const rx = (FOCAL * 0.16) / z;
    steps.append(svg("ellipse", { cx, cy, rx, ry: rx * 0.55, class: "wt-step", style: `--k:${i}`, opacity: num(Math.max(0.25, 1 - i * 0.06)) }));
  }
  root.append(steps);
  return root;
}

// --- 03: the exploded stack ---

const STACK_W = 400;
const STACK_H = 300;
/** The side of the plane, in the units the area is projected into before the isometric transform. */
const PLANE = 100;
const ISO = `matrix(1.299 0.75 -1.299 0.75 0 0)`; // x' = (x - y) * 0.866 * 1.5, y' = (x + y) * 0.5 * 1.5

/** Ground, roads and buildings as three isometric planes that pull apart, with the area's real footprints on them. */
function exportVisual(bbox: BoundingBox, data: MapData): SVGSVGElement {
  const root = svg("svg", { viewBox: `0 0 ${STACK_W} ${STACK_H}`, class: "bento-svg", role: "img", preserveAspectRatio: "xMidYMid meet" });
  root.setAttribute("aria-label", "The model as three layers, ground, roads and buildings, pulled apart");
  const transform = previewTransform(extentOf(bbox, data), PLANE, PLANE, 5);
  const project: Project = ([lon, lat]) => projectToPreview(transform, lon, lat);

  const layers: [string, SVGElement[]][] = [
    ["ground", [svg("rect", { width: PLANE, height: PLANE, class: "stack-plane" })]],
    ["roads", [svg("rect", { width: PLANE, height: PLANE, class: "stack-plane stack-plane-clear" }), ...roadPaths(data, project)]],
    ["buildings", [svg("rect", { width: PLANE, height: PLANE, class: "stack-plane stack-plane-clear" }), buildingPath(data, project)]],
  ];
  const centre = svg("g", { transform: `translate(${STACK_W / 2 - 25} 112)` });
  layers.forEach(([name, children], i) => {
    const layer = svg("g", { class: `stack-layer stack-layer-${name}`, style: `--i:${i}` });
    const plane = svg("g", { transform: ISO });
    plane.append(...children);
    const label = svg("text", { x: 138, y: 80, class: "stack-label" });
    label.textContent = name;
    layer.append(plane, label);
    centre.append(layer);
  });
  root.append(centre);
  return root;
}

// --- the tiles ---

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function tile(kind: Capability, href: string): { tile: HTMLElement; visual: HTMLElement } {
  const { index, title, body, action } = COPY[kind];
  const article = el("article", `bento-tile bento-${kind}`);
  const visual = el("div", "bento-visual");
  visual.dataset.state = "loading";
  const copy = el("div", "bento-copy");
  const a = el("a", "bento-link");
  a.href = href;
  a.dataset.link = "";
  a.append(action, Object.assign(el("span", "bento-arrow", "→"), { ariaHidden: "true" }));
  copy.append(el("span", "bento-index", index), el("h4", "bento-title", title), el("p", "bento-body", body), a);
  article.append(visual, copy);
  return { tile: article, visual };
}

/**
 * The bento of capabilities, drawn from the featured place's own map-data: its road network with a route drawn across it,
 * a street at the heights of its buildings, and its footprints on an exploded model. `api.mapData` should be the page's
 * shared one, so this is not a second request for what the preview and the stage already fetch.
 */
export function renderBento(root: HTMLElement, options: { api: ApiClient; areaId: string; bbox: BoundingBox; sceneHref: string }): () => void {
  const { api, areaId, bbox, sceneHref } = options;
  let disposed = false;
  const route = tile("route", sceneHref);
  const walk = tile("walk", sceneHref);
  const exported = tile("export", sceneHref);
  root.replaceChildren(route.tile, walk.tile, exported.tile);

  const chip = el("code", "bento-chip", glbName(areaId));
  exported.visual.after(chip);

  const ready = (visual: HTMLElement, content: SVGSVGElement) => {
    visual.replaceChildren(content);
    visual.dataset.state = "ready";
  };

  (async () => {
    const data = await api.mapData(areaId).catch(() => null);
    if (disposed) return;
    ready(walk.visual, walkVisual(data, hashString(areaId)));
    if (!data) {
      for (const visual of [route.visual, exported.visual]) visual.dataset.state = "error";
      return;
    }
    ready(exported.visual, exportVisual(bbox, data));
    ready(route.visual, routeVisual(bbox, data, null));

    // The farthest pair first; the next pairs only when the server finds no way between it (a piece of the network cut off).
    for (const [origin, destination] of farthestPairs(nodePositions(data))) {
      const found = await api.route(areaId, origin, destination).catch(() => null);
      if (disposed) return;
      if (found?.geometry) {
        const visual = routeVisual(bbox, data, found);
        ready(route.visual, visual);
        const label = el("div", "bento-route-label");
        label.append(el("span", "bento-route-kicker", "Route"), el("strong", undefined, formatDistance(found.total_distance_meters)));
        route.visual.append(label);
        return;
      }
    }
  })();

  return () => {
    disposed = true;
    root.replaceChildren();
  };
}
