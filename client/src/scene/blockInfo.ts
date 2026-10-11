import { ApiError } from "../api/client";
import type { BlockFeedback, BlockProperties, Eligibility, ZoneReason } from "../api/types";

/** The first 8 characters of an id, which is how the panels name a block. */
export const shortId = (id: string): string => id.slice(0, 8);

/** What the panel shows after a feedback change: the run doesn't change until the next Generate. */
export const APPLIES_LATER = "Applies on the next Generate";

type Summarised = Pick<BlockProperties, "real_building_count" | "generated_building_count" | "is_reference" | "reference_block_id" | "style">;

/**
 * The panel's headline: `Block · real: N · generated: M · reference: <short id | defaults> · style: …`.
 * Without a run (`style` is null) there is no reference or style to report yet, which it says with a dash.
 */
export function blockSummary(block: Partial<Summarised>): string {
  const run = block.style != null;
  const reference = !run ? "—" : block.reference_block_id ? shortId(block.reference_block_id) : "defaults";
  return ["Block", `real: ${block.real_building_count ?? 0}`, `generated: ${block.generated_building_count ?? 0}`, `reference: ${reference}`, `style: ${block.style ?? "—"}`].join(" · ");
}

const REASONS: Record<Exclude<Eligibility, "eligible">, string> = {
  clipped: "Not generated on: the import rectangle cuts this block",
  median: "Not generated on: it's a median strip",
  no_buildable_area: "Not generated on: there's no room to build (under 30 m²)",
};

/** Why a block isn't built on, or null when it is eligible (or came without the field). */
export function eligibilityReason(eligibility: Eligibility | null | undefined): string | null {
  return eligibility && eligibility !== "eligible" ? REASONS[eligibility] : null;
}

/** A line about the block's feedback ("You said: 4 buildings"), or null when it has none. */
export function feedbackText(feedback: Pick<BlockFeedback, "building_count" | "no_buildings"> | null | undefined): string | null {
  if (!feedback) return null;
  if (feedback.no_buildings) return "You said: no buildings here";
  if (feedback.building_count == null) return null;
  return `You said: ${feedback.building_count} ${feedback.building_count === 1 ? "building" : "buildings"}`;
}

/** The "Actual number of buildings" input: a whole number, zero or more. */
export type CountInput = { ok: true; value: number } | { ok: false; message: string };

export function parseBuildingCount(text: string): CountInput {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: "Enter a number of buildings." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Use a whole number, zero or more." };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, message: "That number is too large." };
  return { ok: true, value };
}

/** What a failed feedback call means for the user, by the error's contract `code`. */
export function feedbackFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "block_not_found":
        return "That block no longer exists. Reload the place.";
      case "invalid_request":
        return "That count wasn't accepted. Use a whole number, zero or more.";
      case "http_error":
      case "network_error":
        return "The API can't be reached. Is the server running?";
      default:
        return `Your count couldn't be saved (${error.code}).`;
    }
  }
  return "Your count couldn't be saved: something failed unexpectedly.";
}

/** The legend's entries, in a fixed order, for the zone reasons present (all of them when none are given). */
export const ZONE_LABELS: Record<ZoneReason, string> = {
  water: "Near water",
  steep: "Too steep",
  landuse: "Not for housing (forest, farmland, …)",
  setback: "Front setback",
};

export function legendReasons(present?: Iterable<string>): ZoneReason[] {
  const have = present ? new Set(present) : null;
  return (Object.keys(ZONE_LABELS) as ZoneReason[]).filter((reason) => !have || have.has(reason));
}
