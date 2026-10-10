import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { GenerationRun } from "../api/types";
import { generatedOrigin, generateButtonState, generationFailureMessage, generationProgressText } from "./generationMessages";

const fail = (status: number, code: string) => new ApiError(status, code, "x");
const run = (extra: Partial<GenerationRun> = {}): GenerationRun => ({
  run_id: "r1",
  seed: 1,
  algorithm_version: "frontage-lots-v1",
  created_at: "t",
  building_count: 10,
  block_count: 3,
  eligible_block_count: 4,
  stale: false,
  stale_reasons: [],
  feedback_shortfall_block_ids: [],
  calibration_ratio: null,
  ...extra,
});

describe("generationFailureMessage", () => {
  it("says a running job is still running", () => {
    expect(generationFailureMessage(fail(409, "import_in_progress"))).toContain("still being imported, analysed or generated");
  });

  it("names an area that isn't ready, and one that is gone", () => {
    expect(generationFailureMessage(fail(409, "import_area_not_ready"))).toContain("hasn't finished importing");
    expect(generationFailureMessage(fail(404, "import_area_not_found"))).toContain("no longer exists");
  });

  it("says the API can't be reached for a network failure", () => {
    expect(generationFailureMessage(fail(0, "network_error"))).toContain("can't be reached");
    expect(generationFailureMessage(fail(502, "http_error"))).toContain("can't be reached");
  });

  it("falls back to the code, or a generic sentence for a non-API error", () => {
    expect(generationFailureMessage(fail(500, "boom"))).toContain("(boom)");
    expect(generationFailureMessage(new Error("x"))).toContain("unexpectedly");
  });
});

describe("generateButtonState", () => {
  it("offers Generate when there is no run", () => {
    expect(generateButtonState(null)).toMatchObject({ label: "Generate", stale: false });
  });

  it("offers a plain Regenerate for a current run", () => {
    expect(generateButtonState(run())).toMatchObject({ label: "Regenerate", stale: false });
  });

  it("emphasises a stale Regenerate and lists why in the tooltip", () => {
    const state = generateButtonState(run({ stale: true, stale_reasons: ["roads_changed", "terrain_changed"] }));

    expect(state).toMatchObject({ label: "Regenerate", stale: true });
    expect(state.title).toContain("the roads changed and the terrain changed");
    expect(generateButtonState(run({ stale: true, stale_reasons: ["terrain_changed"] })).title).toContain("the terrain changed");
  });
});

describe("generationProgressText", () => {
  it("names the block count when known", () => {
    expect(generationProgressText(57)).toBe("Generating buildings on 57 blocks…");
    expect(generationProgressText(1)).toBe("Generating buildings on 1 block…");
    expect(generationProgressText(null)).toBe("Generating buildings…");
  });
});

describe("generatedOrigin", () => {
  it("says which block it learned from, by a short id", () => {
    expect(generatedOrigin({ count_source: "reference", reference_block_id: "0123456789abcdef" })).toBe("Generated · from block 01234567");
  });

  it("says defaults when no block was learned from", () => {
    expect(generatedOrigin({ count_source: "default", reference_block_id: null })).toBe("Generated · defaults");
  });

  it("says it follows your count when the block has feedback", () => {
    expect(generatedOrigin({ count_source: "feedback", reference_block_id: "0123456789abcdef" })).toBe("Generated · from your count");
  });
});
