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

describe("deleteImportArea", () => {
  it("deletes by id and returns nothing for a 204", async () => {
    const { client, calls } = recording(new Response(null, { status: 204 }));

    await expect(client.deleteImportArea("a 1")).resolves.toBeUndefined();
    expect(calls[0].url).toBe("/api/import-areas/a%201");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("surfaces a refusal by its code with the covering areas", async () => {
    const covering = [{ id: "b2", name: "Mitte" }, { id: "c3", name: null }];
    const { client } = recording(json(409, { error: { code: "import_area_in_use", message: "in use", details: { covering_areas: covering } } }));

    const error = await client.deleteImportArea("a1").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code, error.details]).toEqual([409, "import_area_in_use", { covering_areas: covering }]);
  });
});

describe("featured area setting", () => {
  it("reads the featured id, null when none", async () => {
    const { client, calls } = recording(json(200, { import_area_id: "a1" }));

    await expect(client.featuredArea()).resolves.toBe("a1");
    expect(calls[0].url).toBe("/api/settings/featured-area");
    expect(calls[0].init?.method).toBe("GET");
    await expect(recording(json(200, { import_area_id: null })).client.featuredArea()).resolves.toBeNull();
  });

  it("puts the id, and null to clear", async () => {
    const { client, calls } = recording(json(200, { import_area_id: "a1" }));

    await expect(client.setFeaturedArea("a1")).resolves.toBe("a1");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ import_area_id: "a1" });

    const cleared = recording(json(200, { import_area_id: null }));
    await expect(cleared.client.setFeaturedArea(null)).resolves.toBeNull();
    expect(JSON.parse(String(cleared.calls[0].init?.body))).toEqual({ import_area_id: null });
  });

  it("surfaces a refusal by its code", async () => {
    const { client } = recording(json(409, { error: { code: "import_area_not_ready", message: "not ready", details: null } }));

    const error = await client.setFeaturedArea("a1").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code]).toEqual([409, "import_area_not_ready"]);
  });
});

describe("landing theme setting", () => {
  const chosen = { theme: "blueprint", time_of_day: "dawn" } as const;

  it("reads the theme, null when none", async () => {
    const { client, calls } = recording(json(200, { landing_theme: chosen }));

    await expect(client.getLandingTheme()).resolves.toEqual(chosen);
    expect(calls[0].url).toBe("/api/settings/landing-theme");
    expect(calls[0].init?.method).toBe("GET");
    await expect(recording(json(200, { landing_theme: null })).client.getLandingTheme()).resolves.toBeNull();
  });

  it("puts the value, and null to clear", async () => {
    const { client, calls } = recording(json(200, { landing_theme: chosen }));

    await expect(client.setLandingTheme(chosen)).resolves.toEqual(chosen);
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ landing_theme: chosen });

    const cleared = recording(json(200, { landing_theme: null }));
    await expect(cleared.client.setLandingTheme(null)).resolves.toBeNull();
    expect(JSON.parse(String(cleared.calls[0].init?.body))).toEqual({ landing_theme: null });
  });

  it("surfaces a rejection by its code", async () => {
    const { client } = recording(json(422, { error: { code: "invalid_request", message: "bad", details: null } }));

    const error = await client.setLandingTheme(chosen).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
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

describe("analyseElevation", () => {
  it("posts to the area's elevation endpoint and returns the events url", async () => {
    const { client, calls } = recording(json(202, { import_area_id: "a 1", events_url: "/import-areas/a%201/events" }));

    await expect(client.analyseElevation("a 1")).resolves.toEqual({ import_area_id: "a 1", events_url: "/import-areas/a%201/events" });
    expect(calls[0].url).toBe("/api/import-areas/a%201/elevation");
    expect(calls[0].init?.method).toBe("POST");
  });

  it("surfaces a refusal by its code", async () => {
    const { client } = recording(json(409, { error: { code: "import_in_progress", message: "running", details: null } }));

    await expect(client.analyseElevation("a1")).rejects.toMatchObject({ status: 409, code: "import_in_progress" });
  });
});

describe("generation", () => {
  it("starts a run with a seed in the body, and without a body when none is given", async () => {
    const { client, calls } = recording(json(202, { import_area_id: "a 1", events_url: "/import-areas/a%201/events" }));

    await expect(client.startGeneration("a 1", 42)).resolves.toEqual({ import_area_id: "a 1", events_url: "/import-areas/a%201/events" });
    expect(calls[0].url).toBe("/api/import-areas/a%201/generation");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ seed: 42 });

    await client.startGeneration("a 1");
    expect(calls[1].init?.body).toBeUndefined();
  });

  it("surfaces a refusal by its code", async () => {
    const { client } = recording(json(409, { error: { code: "import_in_progress", message: "running", details: null } }));

    await expect(client.startGeneration("a1")).rejects.toMatchObject({ status: 409, code: "import_in_progress" });
  });

  it("reads the run, and surfaces generation_not_found", async () => {
    const run = { run_id: "r1", seed: 1 };
    const { client, calls } = recording(json(200, run));

    await expect(client.generation("a1")).resolves.toEqual(run);
    expect(calls[0].url).toBe("/api/import-areas/a1/generation");
    const missing = recording(json(404, { error: { code: "generation_not_found", message: "none", details: null } }));
    await expect(missing.client.generation("a1")).rejects.toMatchObject({ status: 404, code: "generation_not_found" });
  });

  it("surfaces import_in_progress when deleting a run while a job runs", async () => {
    const { client } = recording(json(409, { error: { code: "import_in_progress", message: "running", details: null } }));

    await expect(client.deleteGeneration("a1")).rejects.toMatchObject({ status: 409, code: "import_in_progress" });
  });

  it("deletes the run and returns nothing for a 204", async () => {
    const { client, calls } = recording(new Response(null, { status: 204 }));

    await expect(client.deleteGeneration("a1")).resolves.toBeUndefined();
    expect(calls[0].url).toBe("/api/import-areas/a1/generation");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("block feedback", () => {
  it("puts a count, or no_buildings, on the block", async () => {
    const stored = { building_count: 4, no_buildings: false, updated_at: "t" };
    const { client, calls } = recording(json(200, stored));

    await expect(client.putBlockFeedback("b 1", { building_count: 4 })).resolves.toEqual(stored);
    expect(calls[0].url).toBe("/api/blocks/b%201/feedback");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ building_count: 4 });
    await client.putBlockFeedback("b 1", { no_buildings: true });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ no_buildings: true });
  });

  it("deletes a block's feedback and surfaces feedback_not_found", async () => {
    const { client, calls } = recording(new Response(null, { status: 204 }));

    await expect(client.deleteBlockFeedback("b1")).resolves.toBeUndefined();
    expect(calls[0].url).toBe("/api/blocks/b1/feedback");
    expect(calls[0].init?.method).toBe("DELETE");
    const missing = recording(json(404, { error: { code: "feedback_not_found", message: "none", details: null } }));
    await expect(missing.client.deleteBlockFeedback("b1")).rejects.toMatchObject({ status: 404, code: "feedback_not_found" });
  });

  it("lists an area's feedback from the wrapping object", async () => {
    const entry = { block_id: "b1", import_area_id: "a1", building_count: null, no_buildings: true, updated_at: "t", orphaned: false };
    const { client, calls } = recording(json(200, { feedback: [entry] }));

    await expect(client.areaFeedback("a1")).resolves.toEqual([entry]);
    expect(calls[0].url).toBe("/api/import-areas/a1/feedback");
  });

  it("searches places with an encoded query and unwraps the list", async () => {
    const place = { display_name: "Zürich, Switzerland", name: "Zürich", latitude: 47.4, longitude: 8.5, bbox: { south: 47.3, west: 8.4, north: 47.5, east: 8.6 }, category: "boundary", type: "administrative" };
    const { client, calls } = recording(json(200, { places: [place] }));

    await expect(client.searchPlaces("Zürich & co", 3)).resolves.toEqual([place]);
    expect(calls[0].url).toBe("/api/places/search?q=Z%C3%BCrich+%26+co&limit=3");
  });

  it("surfaces a geocoder failure by its code", async () => {
    const { client } = recording(json(503, { error: { code: "geocoder_unavailable", message: "down", details: null } }));

    await expect(client.searchPlaces("Berlin")).rejects.toMatchObject({ status: 503, code: "geocoder_unavailable" });
  });
});
