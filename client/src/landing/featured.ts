import type { ImportArea } from "../api/types";

/** The configured area when it is completed, else the most recent completed one. */
export function pickFeatured(recent: readonly ImportArea[], configured: ImportArea | null): ImportArea | null {
  if (configured && configured.status === "completed") return configured;
  return recent[0] ?? null;
}
