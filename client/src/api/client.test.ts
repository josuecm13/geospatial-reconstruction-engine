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
  const listing = { strategies: ["distance", "fewest_turns"], default: "distance" };

  function answering(...responses: Response[]) {
    const calls: string[] = [];
    const fetchImpl: Fetch = async (url) => {
      calls.push(url);
      return responses[Math.min(calls.length, responses.length) - 1].clone();
    };
    return { client: new ApiClient("/api", fetchImpl), calls };
  }

  it("lists the strategies and the default from GET /routing-strategies", async () => {
    const { client, calls } = answering(json(200, listing));

    expect(await client.routingStrategies()).toEqual(listing);
    expect(calls).toEqual(["/api/routing-strategies"]);
  });

  it("asks only once", async () => {
    const { client, calls } = answering(json(200, listing));

    await client.routingStrategies();
    await client.routingStrategies();

    expect(calls).toHaveLength(1);
  });

  it("gives null on a failure and asks again next time", async () => {
    const { client, calls } = answering(json(503, { error: { code: "database_unavailable", message: "down" } }), json(200, listing));

    expect(await client.routingStrategies()).toBeNull();
    expect(await client.routingStrategies()).toEqual(listing);
    expect(calls).toHaveLength(2);
  });
});
