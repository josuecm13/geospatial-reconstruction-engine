// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { BlockFeedback, BlockProperties } from "../api/types";
import { APPLIES_LATER } from "./blockInfo";
import { createBlockPanel, type BlockFeedbackApi, type SelectedBlock } from "./blockPanel";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const block = (extra: Partial<BlockProperties> = {}): SelectedBlock => ({
  id: "0123456789abcdef",
  properties: {
    area_square_meters: 100,
    buildable_area: null,
    buildable_area_square_meters: 90,
    is_median: false,
    is_clipped: false,
    import_area_id: "a1",
    eligibility: "eligible",
    real_building_count: 3,
    generated_building_count: 5,
    is_reference: false,
    reference_block_id: "fedcba9876543210",
    style: "regular",
    feedback: null,
    ...extra,
  },
});

function setup(api: Partial<BlockFeedbackApi> = {}) {
  const host = document.createElement("div");
  const calls: string[] = [];
  const changes: [string, BlockFeedback | null][] = [];
  const full: BlockFeedbackApi = {
    putBlockFeedback: async (id, body) => {
      calls.push(`put:${id}:${JSON.stringify(body)}`);
      return { building_count: "building_count" in body ? body.building_count : null, no_buildings: "no_buildings" in body, updated_at: "t" };
    },
    deleteBlockFeedback: async (id) => void calls.push(`delete:${id}`),
    ...api,
  };
  const onClose = vi.fn();
  const panel = createBlockPanel(host, full, (id, feedback) => changes.push([id, feedback]), onClose);
  const root = host.querySelector(".block-panel") as HTMLElement;
  const button = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
  const input = root.querySelector("input") as HTMLInputElement;
  const status = root.querySelector(".block-status") as HTMLElement;
  return { panel, root, button, input, status, calls, changes, onClose };
}

describe("createBlockPanel", () => {
  it("is hidden until a block is shown, and hides again for null", () => {
    const { panel, root } = setup();

    expect(root.hidden).toBe(true);
    panel.show(block());
    expect(root.hidden).toBe(false);
    panel.show(null);
    expect(root.hidden).toBe(true);
  });

  it("shows the summary line with the block's short id", () => {
    const { panel, root } = setup();

    panel.show(block());

    expect(root.querySelector(".block-summary")!.textContent).toBe("Block · real: 3 · generated: 5 · reference: fedcba98 · style: regular (01234567)");
  });

  it("gives the eligibility reason for a block that isn't built on, and none for an eligible one", () => {
    const { panel, root } = setup();
    const reason = root.querySelector(".block-reason") as HTMLElement;

    panel.show(block({ eligibility: "median" }));
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toContain("median");
    panel.show(block());
    expect(reason.hidden).toBe(true);
  });

  it("saves a count, shows the stored feedback and that it applies on the next Generate", async () => {
    const { panel, button, input, status, calls, changes, root } = setup();
    panel.show(block());

    input.value = "4";
    button("Save").click();
    await flush();

    expect(calls).toEqual(['put:0123456789abcdef:{"building_count":4}']);
    expect(changes).toEqual([["0123456789abcdef", { building_count: 4, no_buildings: false, updated_at: "t" }]]);
    expect(status.textContent).toBe(APPLIES_LATER);
    expect(root.querySelector(".block-said")!.textContent).toBe("You said: 4 buildings");
    expect(button("Clear feedback").hidden).toBe(false);
  });

  it("refuses a count that isn't a whole number, without calling the API", async () => {
    const { panel, button, input, status, calls } = setup();
    panel.show(block());

    for (const text of ["", "-2", "1.5"]) {
      input.value = text;
      button("Save").click();
    }
    await flush();

    expect(calls).toEqual([]);
    expect(status.classList.contains("error")).toBe(true);
    expect(status.textContent).not.toBe(APPLIES_LATER);
  });

  it("records that there are no buildings here", async () => {
    const { panel, button, calls, root } = setup();
    panel.show(block());

    button("No buildings here").click();
    await flush();

    expect(calls).toEqual(['put:0123456789abcdef:{"no_buildings":true}']);
    expect(root.querySelector(".block-said")!.textContent).toBe("You said: no buildings here");
  });

  it("clears feedback, and offers Clear feedback only while there is some", async () => {
    const { panel, button, calls, changes, status, input } = setup();
    panel.show(block({ feedback: { building_count: 6, no_buildings: false, updated_at: "t" } }));
    expect(button("Clear feedback").hidden).toBe(false);
    expect(input.value).toBe("6");

    button("Clear feedback").click();
    await flush();

    expect(calls).toEqual(["delete:0123456789abcdef"]);
    expect(changes).toEqual([["0123456789abcdef", null]]);
    expect(status.textContent).toBe(APPLIES_LATER);
    expect(button("Clear feedback").hidden).toBe(true);
    expect(input.value).toBe("");
  });

  it("treats feedback that was already gone as cleared", async () => {
    const { panel, button, changes } = setup({
      deleteBlockFeedback: async () => {
        throw new ApiError(404, "feedback_not_found", "none");
      },
    });
    panel.show(block({ feedback: { building_count: 6, no_buildings: false, updated_at: "t" } }));

    button("Clear feedback").click();
    await flush();

    expect(changes).toEqual([["0123456789abcdef", null]]);
  });

  it("says why a save failed, and keeps what was there", async () => {
    const { panel, button, input, status, changes } = setup({
      putBlockFeedback: async () => {
        throw new ApiError(404, "block_not_found", "gone");
      },
    });
    panel.show(block());

    input.value = "3";
    button("Save").click();
    await flush();

    expect(status.textContent).toContain("no longer exists");
    expect(status.classList.contains("error")).toBe(true);
    expect(changes).toEqual([]);
    expect(button("Save").disabled).toBe(false);
  });

  it("calls onClose from its close button", () => {
    const { panel, root, onClose } = setup();
    panel.show(block());

    (root.querySelector(".block-close") as HTMLButtonElement).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts a newly shown block with a clear status line", async () => {
    const { panel, button, status } = setup();
    panel.show(block());
    button("No buildings here").click();
    await flush();
    expect(status.textContent).toBe(APPLIES_LATER);

    panel.show(block());

    expect(status.textContent).toBe("");
  });
});
