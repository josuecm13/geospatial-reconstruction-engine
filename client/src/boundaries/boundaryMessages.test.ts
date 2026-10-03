import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { BOUNDARY_MESSAGES, BOUNDARY_RULES, BOUNDARY_RULE_MESSAGES, reportBoundaryError } from "./boundaryMessages";

describe("boundary messages", () => {
  it.each(BOUNDARY_RULES)("has a sentence for the server rule %s", (rule) => {
    expect(BOUNDARY_RULE_MESSAGES[rule].length).toBeGreaterThan(0);
    const error = new ApiError(422, "invalid_boundary", "raw server text", { rule });
    expect(reportBoundaryError(error).sentence).toBe(BOUNDARY_RULE_MESSAGES[rule]);
  });

  it("explains a self-crossing shape in plain words", () => {
    const error = new ApiError(422, "invalid_boundary", "boundary ring crosses itself", { rule: "self_intersecting" });
    expect(reportBoundaryError(error).sentence).toBe("The shape crosses itself.");
  });

  it("falls back to the generic sentence for an unknown rule", () => {
    const error = new ApiError(422, "invalid_boundary", "x", { rule: "brand_new" });
    expect(reportBoundaryError(error).sentence).toBe(BOUNDARY_MESSAGES.invalid_boundary);
  });

  it.each(["boundary_name_conflict", "boundary_not_found"])("has a sentence for %s", (code) => {
    expect(reportBoundaryError(new ApiError(409, code, "raw")).sentence).toBe(BOUNDARY_MESSAGES[code]);
  });
});
