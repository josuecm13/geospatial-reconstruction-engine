import type { BlockFeedback, BlockFeedbackBody, BlockProperties } from "../api/types";
import { APPLIES_LATER, blockSummary, eligibilityReason, feedbackFailureMessage, feedbackText, parseBuildingCount, shortId } from "./blockInfo";

/** What the panel needs of the API: set and clear a block's feedback. */
export interface BlockFeedbackApi {
  putBlockFeedback(blockId: string, body: BlockFeedbackBody): Promise<BlockFeedback>;
  deleteBlockFeedback(blockId: string): Promise<void>;
}

export interface SelectedBlock {
  id: string;
  properties: BlockProperties;
}

export interface BlockPanel {
  /** Shows the block, or hides the panel for `null`. */
  show(block: SelectedBlock | null): void;
  /** Removes the panel from the page. */
  dispose(): void;
}

/**
 * The block panel, shared by the 2D map and the 3D scene: the block's summary line, why it isn't built on (when
 * it isn't), and the feedback controls: **Actual number of buildings** (a number and Save), **No buildings
 * here**, and **Clear feedback**. A change calls the API, updates the panel from the response, and says
 * "Applies on the next Generate". `onFeedback` lets the host keep its own copy of the block's properties in
 * step (the 3D mesh's `userData`, the 2D source data). `onClose` is the panel's close button.
 */
export function createBlockPanel(
  host: HTMLElement,
  api: BlockFeedbackApi,
  onFeedback: (blockId: string, feedback: BlockFeedback | null) => void,
  onClose: () => void,
): BlockPanel {
  const root = Object.assign(document.createElement("div"), { className: "block-panel", hidden: true });
  const summary = Object.assign(document.createElement("div"), { className: "block-summary" });
  const reason = Object.assign(document.createElement("div"), { className: "block-reason" });
  const said = Object.assign(document.createElement("div"), { className: "block-said" });
  const field = Object.assign(document.createElement("label"), { className: "block-count" });
  const input = Object.assign(document.createElement("input"), { type: "number", min: "0", step: "1", inputMode: "numeric" });
  const save = Object.assign(document.createElement("button"), { type: "button", textContent: "Save" });
  field.append("Actual number of buildings ", input, save);
  const none = Object.assign(document.createElement("button"), { type: "button", textContent: "No buildings here" });
  const clear = Object.assign(document.createElement("button"), { type: "button", textContent: "Clear feedback" });
  const status = Object.assign(document.createElement("div"), { className: "block-status" });
  status.setAttribute("role", "status");
  const close = Object.assign(document.createElement("button"), { type: "button", className: "block-close", textContent: "×", title: "Close (Esc)" });
  close.setAttribute("aria-label", "Close");
  const row = Object.assign(document.createElement("div"), { className: "block-actions" });
  row.append(none, clear);
  root.append(close, summary, reason, said, field, row, status);
  host.appendChild(root);

  let current: SelectedBlock | null = null;
  let busy = false;

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle("error", error);
  };
  const render = () => {
    if (!current) {
      root.hidden = true;
      return;
    }
    const { properties } = current;
    summary.textContent = `${blockSummary(properties)} (${shortId(current.id)})`;
    const why = eligibilityReason(properties.eligibility);
    reason.textContent = why ?? "";
    reason.hidden = !why;
    const text = feedbackText(properties.feedback);
    said.textContent = text ?? "";
    said.hidden = !text;
    clear.hidden = !properties.feedback;
    for (const control of [input, save, none, clear]) control.disabled = busy;
    root.hidden = false;
  };

  /** Runs a feedback call, then re-renders from its result. */
  const change = async (apply: () => Promise<BlockFeedback | null>) => {
    const block = current;
    if (!block || busy) return;
    busy = true;
    say("Saving…");
    render();
    try {
      const feedback = await apply();
      block.properties = { ...block.properties, feedback };
      onFeedback(block.id, feedback);
      if (current === block) {
        input.value = feedback?.building_count != null ? String(feedback.building_count) : "";
        say(APPLIES_LATER);
      }
    } catch (error) {
      if (current === block) say(feedbackFailureMessage(error), true);
    } finally {
      busy = false;
      if (current === block) render();
    }
  };

  save.addEventListener("click", () => {
    const parsed = parseBuildingCount(input.value);
    if (!parsed.ok) return say(parsed.message, true);
    void change(() => api.putBlockFeedback(current!.id, { building_count: parsed.value }));
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save.click();
    if (event.key === "Escape") event.stopPropagation(); // Escape in the field leaves the field; the host's Escape closes the panel
  });
  none.addEventListener("click", () => void change(() => api.putBlockFeedback(current!.id, { no_buildings: true })));
  clear.addEventListener("click", () =>
    void change(async () => {
      try {
        await api.deleteBlockFeedback(current!.id);
      } catch (error) {
        // Already gone on the server: the panel should show it as cleared.
        if ((error as { code?: string }).code !== "feedback_not_found") throw error;
      }
      return null;
    }),
  );
  close.addEventListener("click", () => onClose());

  return {
    show(block) {
      current = block;
      busy = false;
      input.value = block?.properties.feedback?.building_count != null ? String(block.properties.feedback.building_count) : "";
      say("");
      render();
    },
    dispose() {
      root.remove();
    },
  };
}
