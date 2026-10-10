import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { terrainFailureMessage } from "./terrainMessages";

const fail = (status: number, code: string) => new ApiError(status, code, "x");

describe("terrainFailureMessage", () => {
  it("says the source is down and the place stays flat", () => {
    expect(terrainFailureMessage(fail(0, "elevation_unavailable"))).toContain("stays flat");
  });

  it("says a running job is still running", () => {
    expect(terrainFailureMessage(fail(409, "import_in_progress"))).toContain("still being imported or analysed");
  });

  it("names an area that isn't ready, and one that is gone", () => {
    expect(terrainFailureMessage(fail(409, "import_area_not_ready"))).toContain("hasn't finished importing");
    expect(terrainFailureMessage(fail(404, "import_area_not_found"))).toContain("no longer exists");
  });

  it("says the API can't be reached for a network failure", () => {
    expect(terrainFailureMessage(fail(0, "network_error"))).toContain("can't be reached");
    expect(terrainFailureMessage(fail(502, "http_error"))).toContain("can't be reached");
  });

  it("falls back to the code, or a generic sentence for a non-API error", () => {
    expect(terrainFailureMessage(fail(500, "boom"))).toContain("(boom)");
    expect(terrainFailureMessage(new Error("x"))).toContain("unexpectedly");
  });
});
