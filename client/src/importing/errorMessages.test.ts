import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { importErrorMessage } from "./errorMessages";

describe("importErrorMessage", () => {
  it.each(["invalid_bounding_box", "ingestion_failed", "import_conflict", "source_incomplete", "upstream_unavailable"])(
    "has a message of its own for %s",
    (code) => {
      const message = importErrorMessage(new ApiError(422, code, "raw server text"));
      expect(message).not.toContain("raw server text");
      expect(message).not.toContain(`(${code})`);
    },
  );

  it("names an unknown code rather than showing the raw message", () => {
    expect(importErrorMessage(new ApiError(500, "brand_new_code", "raw"))).toBe("The import failed (brand_new_code).");
  });
});
