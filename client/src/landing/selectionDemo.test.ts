// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { IMPORT_STAGES } from "../api/types";
import { selectionDemo, TICKER_STAGES } from "./selectionDemo";

describe("selectionDemo", () => {
  it("ticks through the stages the server streams, without the failure", () => {
    expect(TICKER_STAGES).toEqual(IMPORT_STAGES.filter((stage) => stage !== "failed"));
    expect(TICKER_STAGES[0]).toBe("fetched");
    expect(TICKER_STAGES.at(-1)).toBe("completed");
  });

  it("renders one list item per stage, in order", () => {
    const items = [...selectionDemo().querySelectorAll(".cta-stage")].map((li) => li.textContent);
    expect(items).toEqual([...TICKER_STAGES]);
  });
});
