import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { blockSummary, eligibilityReason, feedbackFailureMessage, feedbackText, legendReasons, parseBuildingCount, shortId } from "./blockInfo";

describe("blockSummary", () => {
  it("reads real, generated, the reference's short id and the style", () => {
    expect(blockSummary({ real_building_count: 4, generated_building_count: 7, reference_block_id: "0123456789abcdef", style: "regular" })).toBe(
      "Block · real: 4 · generated: 7 · reference: 01234567 · style: regular",
    );
  });

  it('says "defaults" when a run used no reference block', () => {
    expect(blockSummary({ real_building_count: 0, generated_building_count: 5, reference_block_id: null, style: "sparse" })).toBe("Block · real: 0 · generated: 5 · reference: defaults · style: sparse");
  });

  it("has no reference or style to report without a run", () => {
    expect(blockSummary({ real_building_count: 3, generated_building_count: 0, reference_block_id: null, style: null })).toBe("Block · real: 3 · generated: 0 · reference: — · style: —");
  });

  it("counts a block that came without counts as none", () => {
    expect(blockSummary({})).toBe("Block · real: 0 · generated: 0 · reference: — · style: —");
  });
});

describe("shortId", () => {
  it("is the first 8 characters", () => {
    expect(shortId("0123456789abcdef")).toBe("01234567");
  });
});

describe("eligibilityReason", () => {
  it("is null for an eligible block, and for one with no eligibility given", () => {
    expect(eligibilityReason("eligible")).toBeNull();
    expect(eligibilityReason(undefined)).toBeNull();
  });

  it("names why every other block isn't built on", () => {
    expect(eligibilityReason("clipped")).toContain("rectangle");
    expect(eligibilityReason("median")).toContain("median");
    expect(eligibilityReason("no_buildable_area")).toContain("30 m²");
  });
});

describe("feedbackText", () => {
  it("says what the owner said, with the right plural", () => {
    expect(feedbackText({ building_count: 4, no_buildings: false })).toBe("You said: 4 buildings");
    expect(feedbackText({ building_count: 1, no_buildings: false })).toBe("You said: 1 building");
    expect(feedbackText({ building_count: 0, no_buildings: false })).toBe("You said: 0 buildings");
    expect(feedbackText({ building_count: null, no_buildings: true })).toBe("You said: no buildings here");
  });

  it("is null without feedback", () => {
    expect(feedbackText(null)).toBeNull();
    expect(feedbackText(undefined)).toBeNull();
  });
});

describe("parseBuildingCount", () => {
  it("accepts whole numbers, zero or more, with surrounding space", () => {
    expect(parseBuildingCount("0")).toEqual({ ok: true, value: 0 });
    expect(parseBuildingCount(" 12 ")).toEqual({ ok: true, value: 12 });
  });

  it("refuses an empty field, a negative, a fraction, an exponent and words", () => {
    for (const text of ["", "   ", "-1", "2.5", "1e3", "abc", "+3", "1,000"]) expect(parseBuildingCount(text).ok, JSON.stringify(text)).toBe(false);
  });

  it("refuses a number too large to be an exact integer", () => {
    expect(parseBuildingCount("99999999999999999999")).toMatchObject({ ok: false });
  });

  it("says what is wrong", () => {
    expect(parseBuildingCount("")).toEqual({ ok: false, message: "Enter a number of buildings." });
    expect(parseBuildingCount("-1")).toEqual({ ok: false, message: "Use a whole number, zero or more." });
  });
});

describe("feedbackFailureMessage", () => {
  const fail = (status: number, code: string) => new ApiError(status, code, "x");

  it("names a block that is gone, and a count the server refused", () => {
    expect(feedbackFailureMessage(fail(404, "block_not_found"))).toContain("no longer exists");
    expect(feedbackFailureMessage(fail(422, "invalid_request"))).toContain("whole number");
  });

  it("says the API can't be reached for a network failure", () => {
    expect(feedbackFailureMessage(fail(0, "network_error"))).toContain("can't be reached");
  });

  it("falls back to the code, or a generic sentence for a non-API error", () => {
    expect(feedbackFailureMessage(fail(500, "boom"))).toContain("(boom)");
    expect(feedbackFailureMessage(new Error("x"))).toContain("unexpectedly");
  });
});

describe("legendReasons", () => {
  it("lists every reason in a fixed order when none are given", () => {
    expect(legendReasons()).toEqual(["water", "steep", "landuse", "setback"]);
  });

  it("lists only the reasons present, in that order", () => {
    expect(legendReasons(["setback", "water", "setback"])).toEqual(["water", "setback"]);
    expect(legendReasons([])).toEqual([]);
  });
});
