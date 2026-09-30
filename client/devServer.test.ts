import { describe, expect, it } from "vitest";
import { resolveDevServerConfig, stripApiPrefix } from "./devServer";

describe("resolveDevServerConfig", () => {
  it("forwards to APP_PORT from the server's environment", () => {
    expect(resolveDevServerConfig({ APP_PORT: "58123" })).toEqual({ clientPort: 55173, apiTarget: "http://localhost:58123" });
  });

  it("defaults to the project's non-default ports", () => {
    expect(resolveDevServerConfig({})).toEqual({ clientPort: 55173, apiTarget: "http://localhost:58000" });
  });

  it("takes CLIENT_PORT and an explicit API_TARGET", () => {
    expect(resolveDevServerConfig({ CLIENT_PORT: "4000", APP_PORT: "58123", API_TARGET: "http://api.test:9" })).toEqual({
      clientPort: 4000,
      apiTarget: "http://api.test:9",
    });
  });

  it.each(["abc", "0", "70000", "58.5"])("rejects a bad port %s", (value) => {
    expect(() => resolveDevServerConfig({ APP_PORT: value })).toThrow(/APP_PORT/);
  });
});

describe("stripApiPrefix", () => {
  it.each([
    ["/api/import-areas", "/import-areas"],
    ["/api/import-areas/1/map-data?mode=clip", "/import-areas/1/map-data?mode=clip"],
    ["/api", "/"],
    ["/apiary", "/apiary"],
  ])("%s → %s", (path, expected) => {
    expect(stripApiPrefix(path)).toBe(expected);
  });
});
