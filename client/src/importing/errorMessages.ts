/** A user-facing sentence for each import failure, chosen by the contract `code`, never the raw message (the error reporter adds that only when its debug flag is on). */
export const IMPORT_MESSAGES: Record<string, string> = {
  invalid_bounding_box: "That rectangle can't be imported: it must be larger than zero and at most 1 km².",
  invalid_request: "The import request was malformed. This is a client bug.",
  payload_outside_bounding_box: "Some of the returned map data lies outside the rectangle, so nothing was imported.",
  ingestion_failed: "OpenStreetMap returned data this engine can't read yet, so nothing was imported.",
  source_incomplete: "OpenStreetMap sent back an incomplete answer, so nothing was changed. Try again in a moment.",
  upstream_unavailable: "OpenStreetMap's Overpass service is busy or unreachable. Nothing was changed. Try again in a minute.",
  import_conflict: "Another import of this exact rectangle started at the same time. Reopen it from Recent imports.",
  import_in_progress: "This rectangle is already being imported. Wait for it to finish, then open it from Imported areas.",
  import_job_not_found: "The import's progress is no longer available. Check Imported areas to see whether it finished.",
  payload_too_large: "The import is too large for the server.",
  database_unavailable: "The server can't reach its database.",
  http_error: "The API isn't answering. Is the server running?",
  network_error: "The API can't be reached. Is the server running?",
};
