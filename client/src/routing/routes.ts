/** A map camera as the URL carries it: where the map is centred and how far it is zoomed in. */
export interface Camera {
  lat: number;
  lon: number;
  zoom: number;
}

export type ExploreView = "map" | "scene";

export interface ExploreRoute {
  page: "explore";
  /** The open import area; null is the map with nothing open yet, where a first import starts. */
  areaId: string | null;
  view: ExploreView;
  /** The id of the boundary the view is scoped to; null is the whole import area. */
  scope: string | null;
  /** Where the 2D map is; null lets the map fit the area. */
  at: Camera | null;
}

export type Route = { page: "landing" } | { page: "locations" } | ExploreRoute | { page: "not-found"; path: string };

export type PageName = Route["page"];

const EXPLORE_PATH = "/explore";
const EXPLORE_PREFIX = `${EXPLORE_PATH}/`;
const LAT_LIMIT = 90;
const LON_LIMIT = 180;
const MAX_ZOOM = 24;

/** The route a URL names. Unknown paths are `not-found`; invalid query parameters are dropped, never errors. */
export function parseUrl(url: URL): Route {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  if (path === "/") return { page: "landing" };
  if (path === "/locations") return { page: "locations" };
  if (path === EXPLORE_PATH || path.startsWith(EXPLORE_PREFIX)) {
    const areaId = path === EXPLORE_PATH ? null : decodeSegment(path.slice(EXPLORE_PREFIX.length));
    if (path === EXPLORE_PATH || areaId) {
      return {
        page: "explore",
        areaId,
        view: url.searchParams.get("view") === "scene" ? "scene" : "map",
        scope: (areaId && url.searchParams.get("scope")) || null, // a scope only means something inside an area
        at: parseCamera(url.searchParams.get("at")),
      };
    }
  }
  return { page: "not-found", path: url.pathname };
}

/** The path and query of a route; `parseUrl` of it gives the route back (for a camera already rounded to `roundCamera`). */
export function formatRoute(route: Route): string {
  switch (route.page) {
    case "landing":
      return "/";
    case "locations":
      return "/locations";
    case "not-found":
      return route.path;
    case "explore": {
      const query: string[] = [];
      if (route.view === "scene") query.push("view=scene");
      if (route.scope) query.push(`scope=${encodeURIComponent(route.scope)}`);
      if (route.at) query.push(`at=${route.at.lat.toFixed(5)},${route.at.lon.toFixed(5)},${route.at.zoom.toFixed(2)}`);
      const path = route.areaId ? `${EXPLORE_PREFIX}${encodeURIComponent(route.areaId)}` : EXPLORE_PATH;
      return `${path}${query.length ? `?${query.join("&")}` : ""}`;
    }
  }
}

/** A camera at the precision the URL keeps: 5 decimals for latitude and longitude, 2 for zoom. */
export function roundCamera(camera: Camera): Camera {
  return { lat: round(camera.lat, 5), lon: round(camera.lon, 5), zoom: round(camera.zoom, 2) };
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}

/**
 * Where an old `#map` / `#scene` link leads: the open area (the one remembered in this browser), or the
 * locations page when none is remembered. Any other hash is not a legacy link, so there is no redirect (null).
 */
export function legacyRedirect(hash: string, rememberedAreaId: string | null): string | null {
  const name = hash.replace(/^#/, "").split(/[/?&]/, 1)[0];
  if (name !== "map" && name !== "scene") return null;
  if (!rememberedAreaId) return "/locations";
  return formatRoute({ page: "explore", areaId: rememberedAreaId, view: name, scope: null, at: null });
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals)) + 0; // + 0 turns -0 into 0
}

function decodeSegment(segment: string): string | null {
  if (!segment || segment.includes("/")) return null;
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return null;
  }
}

function parseCamera(value: string | null): Camera | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) return null;
  const [lat, lon, zoom] = parts.map(Number);
  if (![lat, lon, zoom].every(Number.isFinite)) return null;
  if (Math.abs(lat) > LAT_LIMIT || Math.abs(lon) > LON_LIMIT || zoom < 0 || zoom > MAX_ZOOM) return null;
  return { lat: lat + 0, lon: lon + 0, zoom: zoom + 0 };
}
