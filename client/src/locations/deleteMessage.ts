import { ApiError } from "../api/client";

export interface DeleteOutcome {
  /** What to tell the user. */
  message: string;
  /** True when the area no longer exists (404), so its card should go even though this call did not delete it. */
  gone: boolean;
}

function coveringNames(details: ApiError["details"]): string[] {
  const covering = details?.covering_areas;
  if (!Array.isArray(covering)) return [];
  return covering.map((entry) => {
    const name = (entry as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name : "an unnamed area";
  });
}

/** What a failed delete of `title` means for the user, by the error's contract `code`. */
export function deleteOutcome(error: unknown, title: string): DeleteOutcome {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "import_area_not_found":
        return { message: `${title} was already deleted.`, gone: true };
      case "import_in_progress":
        return { message: `${title} is still being imported. Try again when the import has finished.`, gone: false };
      case "import_area_in_use": {
        const names = coveringNames(error.details);
        const list = names.length ? names.join(", ") : "a larger area";
        return { message: `${title} can't be deleted yet: larger places use its data. Delete ${list} first.`, gone: false };
      }
      case "http_error":
      case "network_error":
        return { message: `${title} wasn't deleted: the API can't be reached. Is the server running?`, gone: false };
      default:
        return { message: `${title} wasn't deleted (${error.code}).`, gone: false };
    }
  }
  return { message: `${title} wasn't deleted: something failed unexpectedly.`, gone: false };
}
