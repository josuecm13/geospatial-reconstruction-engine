import { ApiError } from "../api/client";
import { useErrorReporter, type ReportedError } from "../errors/errorReporter";

/** Every `details.rule` the server's `invalid_boundary` can carry (server/app/domain/traced_boundary.py). */
export const BOUNDARY_RULES = [
  "blank_name",
  "too_few_vertices",
  "not_closed",
  "self_intersecting",
  "degenerate",
  "outside_import_area",
  "invalid_geojson",
  "holes_not_supported",
] as const;
export type BoundaryRule = (typeof BOUNDARY_RULES)[number];

/** A plain-words sentence per rule. The client's own prechecks use the same names. */
export const BOUNDARY_RULE_MESSAGES: Record<BoundaryRule, string> = {
  blank_name: "The boundary needs a name.",
  too_few_vertices: "The shape needs at least three corners.",
  not_closed: "The shape isn't closed.",
  self_intersecting: "The shape crosses itself.",
  degenerate: "The shape has no area.",
  outside_import_area: "The shape reaches outside the imported rectangle.",
  invalid_geojson: "The shape couldn't be read. This is a client bug.",
  holes_not_supported: "A boundary can't have holes.",
};

export const BOUNDARY_MESSAGES: Record<string, string> = {
  invalid_boundary: "The server rejected the shape.",
  boundary_name_conflict: "A boundary with that name already exists in this area. Pick another name.",
  boundary_not_found: "That boundary no longer exists.",
  import_area_not_found: "That import area no longer exists.",
  import_area_not_ready: "That area hasn't finished importing yet.",
  database_unavailable: "The server can't reach its database.",
  http_error: "The API isn't answering. Is the server running?",
  network_error: "The API can't be reached. Is the server running?",
};

const reportByCode = useErrorReporter(BOUNDARY_MESSAGES);

/** Like the shared reporter, but an `invalid_boundary` is explained by its `details.rule`. */
export function reportBoundaryError(error: unknown): ReportedError {
  const report = reportByCode(error);
  if (error instanceof ApiError && error.code === "invalid_boundary") {
    const rule = error.details?.rule;
    if (typeof rule === "string" && rule in BOUNDARY_RULE_MESSAGES) return { ...report, sentence: BOUNDARY_RULE_MESSAGES[rule as BoundaryRule] };
  }
  return report;
}
