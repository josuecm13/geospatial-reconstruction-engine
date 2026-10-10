import { API_PREFIX } from "../../devServer";
import type {
  AreaFeedbackEntry,
  BlockFeedbackBody,
  StoredFeedback,
  BoundaryProperties,
  BoundingBox,
  Coordinate,
  ErrorCode,
  ExportMode,
  Feature,
  FeatureCollection,
  GenerationRun,
  Geometry,
  ImportArea,
  ImportStarted,
  ImportStatus,
  MapData,
  Route,
  RoutingStrategies,
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

  deleteImportArea(areaId: string): Promise<void> {
    return this.request("DELETE", `/import-areas/${encodeURIComponent(areaId)}`);
  }

  /** The id of the import area the landing page features, or null when none is chosen. */
  async featuredArea(): Promise<string | null> {
    return (await this.request<{ import_area_id: string | null }>("GET", "/settings/featured-area")).import_area_id;
  }

  /** Chooses the landing page's featured area (a completed one); null clears the choice. Returns the stored id. */
  async setFeaturedArea(areaId: string | null): Promise<string | null> {
    return (await this.request<{ import_area_id: string | null }>("PUT", "/settings/featured-area", { import_area_id: areaId })).import_area_id;
  }

  /** Re-analyses an area's terrain in the background; its progress streams on `importEvents`. */
  analyseElevation(areaId: string): Promise<ImportStarted> {
    return this.request("POST", `/import-areas/${encodeURIComponent(areaId)}/elevation`);
  }

  /** Generates the area's buildings in the background, replacing its run; progress streams on `importEvents`. Without a seed the server reuses the current run's. */
  startGeneration(areaId: string, seed?: number): Promise<ImportStarted> {
    return this.request("POST", `/import-areas/${encodeURIComponent(areaId)}/generation`, seed === undefined ? undefined : { seed });
  }

  /** The area's current run; 404 `generation_not_found` when it has none. */
  generation(areaId: string): Promise<GenerationRun> {
    return this.request("GET", `/import-areas/${encodeURIComponent(areaId)}/generation`);
  }

  /** 404 `generation_not_found`; 409 `import_in_progress` while a job for the area runs. */
  deleteGeneration(areaId: string): Promise<void> {
    return this.request("DELETE", `/import-areas/${encodeURIComponent(areaId)}/generation`);
  }

  /** Records how many buildings a block should have (or that it has none); applies on the next generation. */
  putBlockFeedback(blockId: string, body: BlockFeedbackBody): Promise<StoredFeedback> {
    return this.request("PUT", `/blocks/${encodeURIComponent(blockId)}/feedback`, body);
  }

  deleteBlockFeedback(blockId: string): Promise<void> {
    return this.request("DELETE", `/blocks/${encodeURIComponent(blockId)}/feedback`);
  }

  /** The area's feedback (`{feedback: [...]}` on the wire); an entry whose block is gone is `orphaned`. */
  async areaFeedback(areaId: string): Promise<AreaFeedbackEntry[]> {
    return (await this.request<{ feedback: AreaFeedbackEntry[] }>("GET", `/import-areas/${encodeURIComponent(areaId)}/feedback`)).feedback;
  }

  route(areaId: string, origin: Coordinate, destination: Coordinate, strategy?: string): Promise<Route> {
    return this.request("POST", `/import-areas/${encodeURIComponent(areaId)}/routes`, {
      origin,
      destination,
      ...(strategy ? { strategy } : {}),
    });
  }

  private strategies: RoutingStrategies | null = null;

  /**
   * The routing strategies the server has registered and its default, for the route picker. The
   * registry is global, so the first answer is cached for the client's lifetime. Any failure gives
   * `null` and isn't cached, so a later call asks again; the picker treats `null` as "server
   * default only" (no `strategy` field is sent).
   */
  async routingStrategies(): Promise<RoutingStrategies | null> {
    if (this.strategies) return this.strategies;
    try {
      this.strategies = await this.request<RoutingStrategies>("GET", "/routing-strategies");
    } catch {
      return null;
    }
    return this.strategies;
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
