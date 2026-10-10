import { ApiError } from "../api/client";

/** What a failed "Add terrain" means for the user, by the error's contract `code`. */
export function terrainFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "elevation_unavailable":
        return "The terrain source can't be reached right now. The place stays flat; try again in a minute.";
      case "import_in_progress":
        return "This place is still being imported or analysed. Try again when it has finished.";
      case "import_area_not_ready":
        return "This place hasn't finished importing, so it can't get terrain yet.";
      case "import_area_not_found":
        return "That import area no longer exists. Open another one on the Map tab.";
      case "http_error":
      case "network_error":
        return "The API can't be reached. Is the server running?";
      default:
        return `Terrain couldn't be added (${error.code}).`;
    }
  }
  return "Terrain couldn't be added: something failed unexpectedly.";
}
