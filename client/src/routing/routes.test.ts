import { describe, expect, it } from "vitest";
import { formatRoute, legacyRedirect, parseUrl, roundCamera, sameRoute, type Route } from "./routes";

const base = "http://localhost:55173";
const parse = (path: string) => parseUrl(new URL(path, base));

const explore = (areaId: string, rest: Partial<Extract<Route, { page: "explore" }>> = {}): Route => ({
  page: "explore",
  areaId,
  view: "map",
  scope: null,
  at: null,
  ...rest,
});

describe("parseUrl", () => {
  it.each<[string, Route]>([
    ["/", { page: "landing" }],
    ["/locations", { page: "locations" }],
    ["/locations/", { page: "locations" }],
    ["/explore/abc", explore("abc")],
    ["/explore/abc/", explore("abc")],
    ["/explore/abc?view=scene", explore("abc", { view: "scene" })],
    ["/explore/abc?view=sphere", explore("abc")],
    ["/explore/abc?scope=b1", explore("abc", { scope: "b1" })],
    ["/explore/abc?scope=", explore("abc")],
    ["/explore/abc?at=52.5297,13.401,15", explore("abc", { at: { lat: 52.5297, lon: 13.401, zoom: 15 } })],
    ["/explore/abc?at=-33.86882,151.20929,12.5", explore("abc", { at: { lat: -33.86882, lon: 151.20929, zoom: 12.5 } })],
    [
      "/explore/abc?view=scene&scope=b1&at=1,2,3",
      explore("abc", { view: "scene", scope: "b1", at: { lat: 1, lon: 2, zoom: 3 } }),
    ],
    ["/explore/a%20b", explore("a b")],
  ])("%s", (path, expected) => {
    expect(parse(path)).toEqual(expected);
  });

  it.each([
    ["too few numbers", "1,2"],
    ["too many numbers", "1,2,3,4"],
    ["not numbers", "a,b,c"],
    ["an empty part", "1,,3"],
    ["latitude out of range", "91,0,5"],
    ["longitude out of range", "0,181,5"],
    ["negative zoom", "0,0,-1"],
    ["zoom above 24", "0,0,25"],
    ["empty", ""],
  ])("drops an invalid camera (%s) without failing the route", (_name, at) => {
    expect(parse(`/explore/abc?view=scene&at=${at}`)).toEqual(explore("abc", { view: "scene" }));
  });

  it("reads the camera's boundary values as valid", () => {
    expect(parse("/explore/abc?at=-90,180,0")).toEqual(explore("abc", { at: { lat: -90, lon: 180, zoom: 0 } }));
    expect(parse("/explore/abc?at=90,-180,24")).toEqual(explore("abc", { at: { lat: 90, lon: -180, zoom: 24 } }));
  });

  it("turns a negative zero into zero", () => {
    const route = parse("/explore/abc?at=-0,0,5") as Extract<Route, { page: "explore" }>;
    expect(Object.is(route.at!.lat, 0)).toBe(true);
  });

  it.each(["/nope", "/explore", "/explore/", "/explore/a/b", "/locations/x", "/explore/%E0%A4%A"])("%s is not found", (path) => {
    expect(parse(path)).toEqual({ page: "not-found", path: new URL(path, base).pathname });
  });
});

describe("formatRoute", () => {
  it.each<[Route, string]>([
    [{ page: "landing" }, "/"],
    [{ page: "locations" }, "/locations"],
    [{ page: "not-found", path: "/nope" }, "/nope"],
    [explore("abc"), "/explore/abc"],
    [explore("abc", { view: "scene" }), "/explore/abc?view=scene"],
    [explore("abc", { scope: "b1" }), "/explore/abc?scope=b1"],
    [explore("abc", { at: { lat: 52.5297, lon: 13.401, zoom: 15 } }), "/explore/abc?at=52.52970,13.40100,15.00"],
    [
      explore("abc", { view: "scene", scope: "b 1", at: { lat: -33.86882, lon: 151.20929, zoom: 12.5 } }),
      "/explore/abc?view=scene&scope=b%201&at=-33.86882,151.20929,12.50",
    ],
    [explore("a b"), "/explore/a%20b"],
    // More precision than the URL keeps is rounded: 52.529712345 -> 52.52971, 14.666 -> 14.67.
    [explore("abc", { at: { lat: 52.529712345, lon: 13.4005, zoom: 14.666 } }), "/explore/abc?at=52.52971,13.40050,14.67"],
  ])("%j", (route, expected) => {
    expect(formatRoute(route)).toBe(expected);
  });
});

describe("round trip", () => {
  const table: Route[] = [
    { page: "landing" },
    { page: "locations" },
    { page: "not-found", path: "/nope" },
    explore("abc"),
    explore("a b"),
    explore("abc", { view: "scene" }),
    explore("abc", { scope: "b1" }),
    explore("abc", { scope: "b 1&2" }),
    explore("abc", { at: { lat: 52.5297, lon: 13.401, zoom: 15 } }),
    explore("abc", { view: "scene", scope: "b1", at: { lat: -33.86882, lon: 151.20929, zoom: 12.5 } }),
  ];
  it.each(table.map((route) => [formatRoute(route), route] as const))("%s", (_url, route) => {
    expect(parseUrl(new URL(formatRoute(route), base))).toEqual(route);
  });
});

describe("roundCamera", () => {
  it("keeps 5 decimals of latitude and longitude and 2 of zoom", () => {
    expect(roundCamera({ lat: 52.529712345, lon: 13.4005, zoom: 14.666 })).toEqual({ lat: 52.52971, lon: 13.4005, zoom: 14.67 });
  });

  it("does not leave a negative zero", () => {
    expect(roundCamera({ lat: -0.000001, lon: 0, zoom: 3 }).lat).toBe(0);
  });
});

describe("sameRoute", () => {
  it("compares by URL, so a camera that rounds the same is the same route", () => {
    const a = explore("abc", { at: { lat: 1.000001, lon: 2, zoom: 3 } });
    const b = explore("abc", { at: { lat: 1.000002, lon: 2, zoom: 3 } });
    expect(sameRoute(a, b)).toBe(true);
    expect(sameRoute(a, explore("abd"))).toBe(false);
  });
});

describe("legacyRedirect", () => {
  it.each([
    ["#map", "abc", "/explore/abc"],
    ["#scene", "abc", "/explore/abc?view=scene"],
    ["#scene/area/1", "abc", "/explore/abc?view=scene"],
    ["#map", null, "/locations"],
    ["#scene", null, "/locations"],
    ["", "abc", null],
    ["#unknown", "abc", null],
    ["#mapx", "abc", null],
  ])("%s with %s remembered -> %s", (hash, remembered, expected) => {
    expect(legacyRedirect(hash, remembered)).toBe(expected);
  });
});
