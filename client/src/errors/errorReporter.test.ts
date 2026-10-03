import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { IMPORT_MESSAGES } from "../importing/errorMessages";
import { CODES_WITH_REASON, osmRefsOf, useErrorReporter } from "./errorReporter";

const off = useErrorReporter(IMPORT_MESSAGES, false);
const on = useErrorReporter(IMPORT_MESSAGES, true);

describe("useErrorReporter with debug off", () => {
  it.each(Object.keys(IMPORT_MESSAGES))("shows only the sentence for %s, never the raw message", (code) => {
    const report = off(new ApiError(422, code, "way 123 must be a closed polygon", { source_refs: ["way/123"] }));
    expect(report.sentence).toBe(IMPORT_MESSAGES[code]);
    expect(report.reason).toBeNull();
    expect(report.osmRefs).toEqual([]);
  });

  it("names an unknown code rather than showing the raw message", () => {
    expect(off(new ApiError(500, "brand_new_code", "raw")).sentence).toBe("The request failed (brand_new_code).");
  });

  it("has a generic sentence for something that isn't an ApiError", () => {
    expect(off(new TypeError("boom")).sentence).toBe("Something failed unexpectedly.");
  });
});

describe("useErrorReporter with debug on", () => {
  it("adds the reason and the elements parsed from the message for ingestion_failed", () => {
    const report = on(new ApiError(422, "ingestion_failed", "way 123 must be a closed polygon"));
    expect(report.sentence).toBe(IMPORT_MESSAGES.ingestion_failed);
    expect(report.reason).toBe("way 123 must be a closed polygon");
    expect(report.osmRefs).toEqual([{ type: "way", id: "123", url: "https://www.openstreetmap.org/way/123" }]);
  });

  it("links the typed refs the server sends for payload_outside_bounding_box", () => {
    const report = on(
      new ApiError(422, "payload_outside_bounding_box", "payload contains features outside the import bounding box: 9, 4", {
        source_ids: ["9", "4"],
        source_refs: ["node/9", "way/4"],
      }),
    );
    expect(report.osmRefs.map((ref) => ref.url)).toEqual(["https://www.openstreetmap.org/node/9", "https://www.openstreetmap.org/way/4"]);
  });

  it("deduplicates elements named by both the details and the message", () => {
    const error = new ApiError(422, "source_incomplete", "node 9 has invalid coordinates", { source_refs: ["node/9"] });
    expect(osmRefsOf(error)).toHaveLength(1);
  });

  it("does not link bare ids that have no type", () => {
    const error = new ApiError(422, "payload_outside_bounding_box", "outside: 7", { source_ids: ["7"] });
    expect(osmRefsOf(error)).toEqual([]);
  });

  it("shows only the sentence for upstream_unavailable, http_error and network_error", () => {
    for (const code of ["upstream_unavailable", "http_error", "network_error"]) {
      expect(CODES_WITH_REASON.has(code)).toBe(false);
      const report = on(new ApiError(502, code, "way 1 raw", { source_refs: ["way/1"] }));
      expect(report.reason).toBeNull();
      expect(report.osmRefs).toEqual([]);
    }
  });

  it("falls back to the sentence for an unknown code and a non-ApiError", () => {
    expect(on(new ApiError(500, "brand_new_code", "raw")).reason).toBeNull();
    expect(on("nope").sentence).toBe("Something failed unexpectedly.");
  });
});
