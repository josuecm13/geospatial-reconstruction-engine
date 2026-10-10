import { ApiError } from "../api/client";
import type { GenerationRun, StaleReason } from "../api/types";

/** What a failed Generate / Regenerate means for the user, by the error's contract `code`. */
export function generationFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "import_in_progress":
        return "This place is still being imported, analysed or generated. Try again when it has finished.";
      case "import_area_not_ready":
        return "This place hasn't finished importing, so it can't get buildings yet.";
      case "import_area_not_found":
        return "That import area no longer exists. Open another one on the Map tab.";
      case "http_error":
      case "network_error":
        return "The API can't be reached. Is the server running?";
      default:
        return `Buildings couldn't be generated (${error.code}).`;
    }
  }
  return "Buildings couldn't be generated: something failed unexpectedly.";
}

const STALE_TEXT: Record<StaleReason, string> = {
  roads_changed: "the roads changed",
  terrain_changed: "the terrain changed",
};

/** The Generate button for the area's run: its label, whether it is emphasised, and its tooltip. */
export function generateButtonState(run: GenerationRun | null): { label: string; stale: boolean; title: string } {
  if (!run) return { label: "Generate", stale: false, title: "Generate buildings on this place's empty blocks" };
  if (!run.stale) return { label: "Regenerate", stale: false, title: "Generate again with a new seed" };
  const reasons = run.stale_reasons.map((reason) => STALE_TEXT[reason] ?? reason);
  return { label: "Regenerate", stale: true, title: `Out of date: ${reasons.length ? reasons.join(" and ") : "the place changed"} since these buildings were generated` };
}

/** The status line while a run is going. */
export const generationProgressText = (blockCount: number | null): string =>
  blockCount == null ? "Generating buildings…" : `Generating buildings on ${blockCount} ${blockCount === 1 ? "block" : "blocks"}…`;

const short = (id: string) => id.slice(0, 8);

/** What a generated building's popup says about where it came from. */
export function generatedOrigin(properties: { count_source?: string | null; reference_block_id?: string | null }): string {
  if (properties.count_source === "feedback") return "Generated · from your count";
  if (properties.reference_block_id) return `Generated · from block ${short(properties.reference_block_id)}`;
  return "Generated · defaults";
}
