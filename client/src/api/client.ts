import { API_PREFIX } from "../../devServer";
import type {
  BoundaryProperties,
  BoundingBox,
  Coordinate,
  ErrorCode,
  ExportMode,
  Feature,
  FeatureCollection,
  Geometry,
  ImportArea,
  ImportStarted,
  ImportStatus,
  MapData,
  Route,
} from "./types";

/** A non-2xx API response, carrying the contract's machine-readable `code`. Switch on `code`, not the status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | string,
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A strategy name no server registers, sent to make it answer with the list of those it has. */
export const PROBE_STRATEGY = "__list_strategies__";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MapDataQuery {
  boundaryId?: string;
  mode?: ExportMode;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string = import.meta.env?.VITE_API_BASE_URL || API_PREFIX,
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  health(): Promise<{ status: string }> {
    return this.request("GET", "/health");
  }

  /** Without a payload the server fetches the box live from Overpass. */
  importArea(bbox: BoundingBox, payload?: unknown): Promise<ImportArea> {
    return this.request("POST", "/import-areas", payload === undefined ? { bbox } : { bbox, payload });
  }

  /**
   * Starts an import in the server's background and answers at once with where its stages stream.
   * The UI uses this; `importArea` stays for tests and scripts.
   */
  startImport(bbox: BoundingBox): Promise<ImportStarted> {
    return this.request("POST", "/import-areas", { bbox, background: true });
  }

  /** The server-sent events of a background import: one per stage. The browser reconnects with `Last-Event-ID`. */
  importEvents(areaId: string): EventSource {
    return new EventSource(`${this.baseUrl}/import-areas/${encodeURIComponent(areaId)}/events`);
  }

  /** Import areas, most recently imported first. */
  async listImportAreas(query: { status?: ImportStatus; limit?: number } = {}): Promise<ImportArea[]> {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.size ? `?${params}` : "";
    const body = await this.request<{ import_areas: ImportArea[] }>("GET", `/import-areas${suffix}`);
    return body.import_areas;
  }

  getImportArea(id: string): Promise<ImportArea> {
    return this.request("GET", `/import-areas/${encodeURIComponent(id)}`);
  }

  mapData(id: string, query: MapDataQuery = {}): Promise<MapData> {
    const params = new URLSearchParams();
    if (query.boundaryId) params.set("boundary_id", query.boundaryId);
    if (query.mode) params.set("mode", query.mode);
    const suffix = params.size ? `?${params}` : "";
    return this.request("GET", `/import-areas/${encodeURIComponent(id)}/map-data${suffix}`);
  }

  createBoundary(areaId: string, name: string, geometry: Geometry): Promise<Feature<BoundaryProperties>> {
    return this.request("POST", `/import-areas/${encodeURIComponent(areaId)}/boundaries`, { name, geometry });
  }

  listBoundaries(areaId: string): Promise<FeatureCollection<BoundaryProperties>> {
    return this.request("GET", `/import-areas/${encodeURIComponent(areaId)}/boundaries`);
  }

  deleteBoundary(areaId: string, boundaryId: string): Promise<void> {
    return this.request("DELETE", `/import-areas/${encodeURIComponent(areaId)}/boundaries/${encodeURIComponent(boundaryId)}`);
  }

  route(areaId: string, origin: Coordinate, destination: Coordinate, strategy?: string): Promise<Route> {
    return this.request("POST", `/import-areas/${encodeURIComponent(areaId)}/routes`, {
      origin,
      destination,
      ...(strategy ? { strategy } : {}),
    });
  }

  private strategies = new Map<string, string[]>();

  /**
   * The routing strategies the server has registered, for the route picker. There is no endpoint
   * that lists them: the only source is `details.registered_strategies` on the 422
   * `unknown_routing_strategy` error, so this sends a route request naming a strategy that can't
   * exist (the strategy is resolved before any routing happens) and reads the list off the error.
   * Cached per area for the session. If anything else goes wrong it returns `[]`, which the picker
   * treats as "server default only" (no `strategy` field is sent).
   */
  async routingStrategies(areaId: string): Promise<string[]> {
    const cached = this.strategies.get(areaId);
    if (cached) return cached;
    let names: string[] = [];
    try {
      const { bbox } = await this.getImportArea(areaId);
      const centre = { latitude: (bbox.min_latitude + bbox.max_latitude) / 2, longitude: (bbox.min_longitude + bbox.max_longitude) / 2 };
      await this.route(areaId, centre, centre, PROBE_STRATEGY);
    } catch (error) {
      const listed = error instanceof ApiError && error.code === "unknown_routing_strategy" ? error.details?.registered_strategies : null;
      if (Array.isArray(listed)) names = listed.map(String);
    }
    if (names.length) this.strategies.set(areaId, names);
    return names;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiError(0, "network_error", `the API could not be reached: ${String(error)}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string; details?: Record<string, unknown> | null } })?.error;
      if (error?.code) throw new ApiError(response.status, error.code, error.message ?? error.code, error.details ?? null);
      // Not the API's envelope: the dev proxy's own failure when the server isn't running.
      throw new ApiError(response.status, "http_error", `HTTP ${response.status}`);
    }
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
