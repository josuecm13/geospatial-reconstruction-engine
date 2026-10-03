import { ApiError } from "../api/client";

/** Off by default and the same in every build: flip it in source while debugging. */
export const DEBUG_ERRORS = false;

/** Codes whose server message names the offending element, so it is worth showing while debugging. */
export const CODES_WITH_REASON: ReadonlySet<string> = new Set(["ingestion_failed", "payload_outside_bounding_box", "source_incomplete"]);

export interface OsmRef {
  type: "node" | "way" | "relation";
  id: string;
  url: string;
}

export interface ReportedError {
  /** Always present: the friendly sentence for the error's code. */
  sentence: string;
  /** The server's own message, only when debug is on and the code is one that carries specifics. */
  reason: string | null;
  /** The OpenStreetMap elements the error names, only when debug is on and the code carries specifics. */
  osmRefs: OsmRef[];
}

const OSM_TYPES = new Set<string>(["node", "way", "relation"]);

function osmRef(type: string, id: string): OsmRef | null {
  return OSM_TYPES.has(type) ? { type: type as OsmRef["type"], id, url: `https://www.openstreetmap.org/${type}/${id}` } : null;
}

/** The elements an error names: typed `details.source_refs` ("way/123"), plus any "way 123" in the message. */
export function osmRefsOf(error: ApiError): OsmRef[] {
  const refs = new Map<string, OsmRef>();
  const add = (type: string, id: string) => {
    const ref = osmRef(type, id);
    if (ref) refs.set(`${type}/${id}`, ref);
  };
  const typed = error.details?.source_refs;
  if (Array.isArray(typed)) {
    for (const entry of typed) {
      const [type, id] = String(entry).split("/");
      if (id) add(type, id);
    }
  }
  for (const match of error.message.matchAll(/\b(node|way|relation) (\d+)\b/g)) add(match[1], match[2]);
  return [...refs.values()];
}

/**
 * Turns an error into what to display. `messages` maps a contract `code` to its sentence and stays
 * per context (import, boundaries, routing). `debug` is injectable for tests; callers use the default.
 */
export function useErrorReporter(messages: Record<string, string>, debug = DEBUG_ERRORS): (error: unknown) => ReportedError {
  return (error) => {
    if (!(error instanceof ApiError)) return { sentence: "Something failed unexpectedly.", reason: null, osmRefs: [] };
    const sentence = messages[error.code] ?? `The request failed (${error.code}).`;
    if (!debug || !CODES_WITH_REASON.has(error.code)) return { sentence, reason: null, osmRefs: [] };
    return { sentence, reason: error.message, osmRefs: osmRefsOf(error) };
  };
}

/** Renders a ReportedError into an element: the sentence, then (if any) the reason and links to the OSM elements. */
export function renderReportedError(target: HTMLElement, report: ReportedError): void {
  target.replaceChildren(report.sentence);
  if (report.reason) {
    target.append(" ", Object.assign(document.createElement("span"), { className: "error-reason", textContent: `(${report.reason})` }));
  }
  for (const ref of report.osmRefs) {
    const link = Object.assign(document.createElement("a"), {
      href: ref.url,
      target: "_blank",
      rel: "noreferrer",
      textContent: `${ref.type} ${ref.id}`,
    });
    target.append(" ", link);
  }
}
