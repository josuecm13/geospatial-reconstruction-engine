# 04 — Show the server's reason for a failure, behind one debug flag (#88)

## Goal

Every view reports API errors through one function, `useErrorReporter`. It turns an error into
what to display: the friendly sentence, plus the server's own reason and offending OSM ids when a
single debugging constant is on.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 88`.

## Code to read first

- `client/src/importing/errorMessages.ts`: today's `importErrorMessage(error)`, with sentences by `code`.
- `client/src/importing/importPanel.ts`: calls `importErrorMessage` in three places and writes text
  into a status element.
- `client/src/api/client.ts`: `ApiError` has `status`, `code`, `message`, and `details`.
- `server/app/api/errors.py`: what `details` each code carries.
  `payload_outside_bounding_box` → `{"source_ids": ["123", …]}`. `ingestion_failed` and
  `source_incomplete` → no details, but the message names the element (`"way 123 must be a closed
  polygon"`, `"node 9 has invalid coordinates"`, `"restriction relation 77 …"`).

## Design

New module `client/src/errors/errorReporter.ts`, plus a test:

```ts
/** Off by default and the same in every build: flip it in source while debugging. */
export const DEBUG_ERRORS = false;

export interface OsmRef { type: "node" | "way" | "relation"; id: string; url: string }
export interface ReportedError {
  sentence: string;        // always present
  reason: string | null;   // the server's message, only when debug is on and the code is one that carries specifics
  osmRefs: OsmRef[];       // only when debug is on
}

/** `debug` is injectable for tests; production callers use the default. */
export function useErrorReporter(messages: Record<string, string>, debug = DEBUG_ERRORS): (error: unknown) => ReportedError;

/** Renders a ReportedError into an element: the sentence, then (if any) the reason and a list of OSM links. */
export function renderReportedError(target: HTMLElement, report: ReportedError): void;
```

- The `messages` table stays per context. Move `IMPORT_MESSAGES` into the import module as today,
  and let later briefs (05 boundaries, 09 routing) pass their own tables. Unknown code →
  `` `The request failed (${code}).` ``. Not an `ApiError` → `"Something failed unexpectedly."`.
- Codes that show the reason when debug is on: `ingestion_failed`, `payload_outside_bounding_box`,
  `source_incomplete`. Exported as a `Set`, so it's easy to extend. Codes that never show it:
  `upstream_unavailable`, `http_error`, `network_error`, and anything not in the set.
- OSM refs: from `details.source_ids` when present, and also parsed from the message with
  `/\b(node|way|relation) (\d+)\b/g`. Deduplicate them. URL: `https://www.openstreetmap.org/<type>/<id>`.
  - `details.source_ids` are bare ids with no type. Look each one up in the message's parsed refs
    to get its type. If none is found, link with type `way` only if the id came from a feature
    (buildings, roads, and areas are ways). **Better: make the server send typed refs.** In
    `PayloadOutsideBoundingBox` (raised in `server/app/ingestion/service.py`,
    `_validate_within_bounding_box`), also pass `source_refs: ["way/123", "node/9"]`, which the
    validator knows (POI nodes vs. ways). Add it to the error's `details` next to `source_ids`, then
    prefer `source_refs` in the client. Keep `source_ids` for compatibility. This small server change is
    in scope because the acceptance criteria need a working link; add a test to `test_import_areas.py`.
- Links open in a new tab (`target="_blank" rel="noreferrer"`), and are built with DOM APIs, not
  `innerHTML` (the message is server text).
- Replace every `importErrorMessage(...)` call in `importPanel.ts` with the reporter and
  `renderReportedError`. Delete `importErrorMessage`, and move its test cases into the new test file.

## Tests (`client/src/errors/errorReporter.test.ts`)

- Debug off: only the sentence, for every code (including `ingestion_failed` with a message).
- Debug on: the reason plus refs for the three codes; `upstream_unavailable` shows only the
  sentence; refs are parsed from the message and from `details`, deduplicated; and an unknown code and
  a non-`ApiError` both get the fallback sentences.

## Docs and specs

- Spec delta `showcase-client` (a capability this change ADDS, so edit its requirements in place;
  there's no living spec to MODIFY): the requirement "The client SHALL select a rectangle … import
  it live" says "Errors SHALL be shown by their code, never as the raw message." Change it to:
  errors are shown by a sentence chosen by code, and the server's message and OSM links appear only
  when the client's debug flag is on. Do the same in the first requirement ("…report errors by
  code"). Add a scenario for each flag state.
- `docs/client-features.md` → Error contract: note the debug flag.
- `tasks.md`: tick `1.12a #88`.

## Outcome

- `client/src/errors/errorReporter.ts` has `useErrorReporter`, `renderReportedError`, `osmRefsOf`, the
  `DEBUG_ERRORS` flag (off) and the exported `CODES_WITH_REASON` set. `renderReportedError` uses DOM
  APIs only; the reason goes in a `span.error-reason` and each ref is an `<a target="_blank" rel="noreferrer">`
  appended after it (spans and links rather than a `<ul>`, because the status element is a `<p>`).
- `importPanel.ts` reports all three failure paths through it. `importErrorMessage` is gone, and its
  test cases moved to `errorReporter.test.ts`, with the fallbacks reworded for any context
  (`The request failed (<code>).`, `Something failed unexpectedly.`). `IMPORT_MESSAGES` is now exported
  from `errorMessages.ts`.
- Server: `PayloadOutsideBoundingBox` carries `source_refs` (`way/<id>`, `node/<id>`), and the 422 puts it
  in `details` beside `source_ids`. Roads, buildings, area features, and POIs mapped as areas are
  `way`; POIs mapped as nodes are `node`. Tests updated in `test_import_areas.py` and
  `test_osm_ingestion_service.py`.
- Decision: a bare id in `details.source_ids` with no type in `source_refs` and none in the message gets
  no link, rather than a guessed `way`. The server now always sends refs, so this only affects older servers.
- Spec delta (both requirements plus a scenario per flag state), `docs/client-features.md` error contract,
  and `tasks.md` 1.12a are updated.
- Guard tests are not mutation-checked (no local test runs). Checked locally: `tsc --noEmit` only.

## Tangents found
