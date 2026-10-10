import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { deleteOutcome } from "./deleteMessage";

const fail = (status: number, code: string, details: Record<string, unknown> | null = null) => new ApiError(status, code, "x", details);

describe("deleteOutcome", () => {
  it("names the larger places to delete first, and an unnamed one as such", () => {
    const error = fail(409, "import_area_in_use", { covering_areas: [{ id: "b", name: "Mitte" }, { id: "c", name: null }] });

    const outcome = deleteOutcome(error, "Kreuzberg");

    expect(outcome.gone).toBe(false);
    expect(outcome.message).toContain("Delete Mitte, an unnamed area first.");
  });

  it("still refuses plainly when the covering areas are missing", () => {
    expect(deleteOutcome(fail(409, "import_area_in_use"), "A").message).toContain("Delete a larger area first.");
  });

  it("says a running import is still running", () => {
    const outcome = deleteOutcome(fail(409, "import_in_progress"), "A");

    expect(outcome.message).toContain("still being imported");
    expect(outcome.gone).toBe(false);
  });

  it("treats a 404 as already gone", () => {
    expect(deleteOutcome(fail(404, "import_area_not_found"), "A").gone).toBe(true);
  });

  it("falls back to the code, or a generic sentence for a non-API error", () => {
    expect(deleteOutcome(fail(500, "boom"), "A").message).toContain("(boom)");
    expect(deleteOutcome(new Error("x"), "A")).toMatchObject({ gone: false });
  });
});
