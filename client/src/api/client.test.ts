import { describe, expect, it } from "vitest";
import { ApiClient, ApiError, type Fetch } from "./client";

function recording(response: Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response.clone();
  };
  return { client: new ApiClient("/api", fetchImpl), calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BBOX = { min_latitude: 52.5292, min_longitude: 13.4005, max_latitude: 52.5302, max_longitude: 13.4021 };

describe("ApiClient", () => {
  it("imports live by omitting the payload", async () => {
    const { client, calls } = recording(json(200, { id: "a1", status: "completed" }));

    await client.importArea(BBOX);

    expect(calls[0].url).toBe("/api/import-areas");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ bbox: BBOX });
  });

  it("sends a posted payload when given one", async () => {
    const { client, calls } = recording(json(200, { id: "a1" }));

    await client.importArea(BBOX, { elements: [] });

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ bbox: BBOX, payload: { elements: [] } });
  });

  it("surfaces an error by its contract code and details", async () => {
    const { client } = recording(json(503, { error: { code: "upstream_unavailable", message: "busy", details: { upstream_status: 504 } } }));

    const error = await client.importArea(BBOX).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code, error.details]).toEqual([503, "upstream_unavailable", { upstream_status: 504 }]);
  });

  it("reports a non-envelope failure (the dev proxy with no server) as http_error", async () => {
    const { client } = recording(new Response("Bad Gateway", { status: 502 }));

    await expect(client.health()).rejects.toMatchObject({ code: "http_error", status: 502 });
  });

  it("reports an unreachable API as network_error", async () => {
    const { client } = recording(new TypeError("Failed to fetch"));

    await expect(client.health()).rejects.toMatchObject({ code: "network_error", status: 0 });
  });

  it("builds map-data scope and mode parameters", async () => {
    const { client, calls } = recording(json(200, {}));

    await client.mapData("a1", { boundaryId: "b2", mode: "clip" });

    expect(calls[0].url).toBe("/api/import-areas/a1/map-data?boundary_id=b2&mode=clip");
  });

  it("returns nothing for a 204", async () => {
    const { client, calls } = recording(new Response(null, { status: 204 }));

    await expect(client.deleteBoundary("a1", "b2")).resolves.toBeUndefined();
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("listImportAreas", () => {
  it("asks for completed areas and unwraps the list", async () => {
    const calls: string[] = [];
    const client = new ApiClient("/api", async (url) => {
      calls.push(url);
      return json(200, { import_areas: [{ id: "a1" }] });
    });

    expect(await client.listImportAreas({ status: "completed", limit: 20 })).toEqual([{ id: "a1" }]);
    expect(calls).toEqual(["/api/import-areas?status=completed&limit=20"]);
  });
});

describe("routingStrategies", () => {
  const area = { id: "a1", bbox: BBOX };
  const unknown = { error: { code: "unknown_routing_strategy", message: "nope", details: { registered_strategies: ["distance", "fewest_turns"] } } };

  function routed(routeResponse: Response) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: Fetch = async (url, init) => {
      calls.push({ url, init });
      return (url.endsWith("/routes") ? routeResponse : json(200, area)).clone();
    };
    return { client: new ApiClient("/api", fetchImpl), calls };
  }

  it("reads the registered strategies off the unknown_routing_strategy error", async () => {
    const { client, calls } = routed(json(422, unknown));

    expect(await client.routingStrategies("a1")).toEqual(["distance", "fewest_turns"]);

    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.strategy).toBe("__list_strategies__");
    expect(body.origin).toEqual(body.destination);
  });

  it("asks only once per area", async () => {
    const { client, calls } = routed(json(422, unknown));

    await client.routingStrategies("a1");
    await client.routingStrategies("a1");

    expect(calls).toHaveLength(2);
  });

  it("falls back to no strategies (server default) on any other failure", async () => {
    const { client } = routed(json(503, { error: { code: "database_unavailable", message: "down" } }));

    expect(await client.routingStrategies("a1")).toEqual([]);
  });
});
