# 15 — Locations gallery with previews and fly-to (#103)

## Goal

`/locations` shows every import area as a card with a visual preview. Opening one animates the map
to it.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 103`.

## Depends on

Brief 13 (router, explore route). It can run in parallel with brief 14. If 14 is already on the
branch, also swap its landing cards for these.

## Design

- `client/src/locations/cardModel.ts` (pure, tested): from an `ImportArea` → `{ id, title, subtitle, when,
  counts, status, bbox }`. The title is the place name if the API has one, else the rounded centre.
  Also `filterCards(cards, text)` and `sortCards(cards, "recent" | "size")`.
- **Preview**: `client/src/locations/preview.ts`. A canvas 2D render of the area's map-data (buildings
  filled, roads stroked by width, area features tinted), fitted to the bbox. It loads when the card
  scrolls into view (`IntersectionObserver`), at most 3 at a time, and is cached in memory by area id
  plus `imported_at`. No WebGL per card. The fit/transform math is `previewTransform(bbox, w, h)`,
  pure and tested.
- **Fly-to**: `client/src/locations/flyTo.ts`. `flyParams(fromCamera, toBbox, viewport)` (pure, tested)
  gives MapLibre `flyTo` options: centre, zoom fitted to the bbox with padding, `curve` ≈ 1.42, and a
  duration scaled by distance (clamped 1.2–3.5 s). Use `prefers-reduced-motion` → `jumpTo`. The explore
  page calls it whenever the area changes by navigation, including from the gallery. The gallery passes
  its scroll position through history state so Back returns to the same spot.
- The import panel's inline area list is replaced by a "Browse locations" link plus the current area's
  line.

## Tests

`cardModel.test.ts`, `previewTransform` and `flyParams` cases (same-place, antimeridian-free far
jump, tiny bbox, duration clamps).

## Docs

Spec delta: "The client SHALL list import areas with previews and fly to the one opened".
`client-features.md` rows (list import areas, map-data).

## Outcome

Built as briefed. `pages/locations.ts` is the gallery; its modules are in `client/src/locations/`:

- `cardModel.ts` (pure, tested): `toCard(area, now)` gives `{ id, title, subtitle, when, importedAt, counts, status, statusLabel, bbox,
  squareMeters }`; `filterCards`, `sortCards("recent" | "size")`, `formatCentre`, `formatWhen`. The API gives no place name
  (`ImportArea` has none), so the title is always the rounded centre ("52.5300° N, 13.4000° E"). The date is relative for a week,
  then a UTC date, so it reads the same everywhere. Counts are empty unless the import completed.
- `previewTransform.ts` (pure, tested): `previewTransform(bbox, w, h, padding)` and `projectToPreview`; longitude is scaled by the
  cosine of the centre latitude. `preview.ts` draws on a 2D canvas (640 x 400) and holds `PreviewLoader` (IntersectionObserver with a
  240 px margin, a queue of 3, a 48-entry LRU cache keyed by `id@imported_at`, shared across visits so Back shows them at once; a
  card still queued when it scrolls away is dropped). `previewScheduler.ts` (tested) has the queue, the LRU, and the key.
- `flyTo.ts`: `flyParams(from, toBbox, viewport)` (pure, tested): centre in Mercator, zoom fitted with 60 px padding (clamped 0 to
  19), `curve` 1.42, duration 1200 + 600 * log10(1 + km) clamped to 1.2 to 3.5 s. `flyToArea(map, bbox)` calls `flyTo`, or `jumpTo`
  under `prefers-reduced-motion`.
- `card.ts`: `renderLocationCard(card, { previews, onOpen? }): HTMLElement`, the one function the landing page can adopt. The title
  is a `data-link` anchor stretched over the whole card; an area that did not complete is a dashed card with a status badge and no link.
- `galleryState.ts` (tested): scroll, filter, and sort in `history.state` under the key `locations` (read on mount, written on a
  150 ms debounce and at the moment a card is opened), so Back restores them. The router needed no change.

Explore and the panel: `ImportPanel.open` now flies (instead of `fitBounds` for 800 ms) unless `instant`, `quiet`, or a `camera` is
given. Explore passes `instant: initial && !gallery`, where `gallery = consumeFlyTo(areaId)`. Decision: a page that opens on an
explore URL (a pasted link, a reload) still jumps, because flying there from the map's default Berlin view is not an arrival, and
only a click on a gallery card marks the area (`markFlyTo`, valid for 5 s). Any area change while explore is open (Back, Forward,
a link) flies. A route with `at` jumps to that camera. The panel's list is now "Browse locations" plus one line for the open area;
it still fetches up to 200 areas (was 50) to detect a re-import of a rectangle.

Not run locally (CI only): `tsc --noEmit -p client` is clean, tests included. Expected values in the tests are computed by hand
(comments show the arithmetic). Guards are not mutation-checked. The canvas drawing, the IntersectionObserver loading, the fly,
and the CSS were never seen in a browser; a human should open `/locations` with a few areas and open one. Not done: the landing
page (brief 14) does not use `renderLocationCard` yet; it is a drop-in with a `PreviewLoader` that the page disposes on unmount.
Preview, fly and gallery have no component tests (they need a canvas, a map, or a DOM).

## Tangents found

- With no import area there is no way to reach the map: `/explore/:areaId` needs an id, and the gallery's empty state can only say
  to "import a place on the map". The first import needs an explore route without an area (or a landing action that opens the
  map at a default view). Worth an issue before the walkthrough (brief 11) is written.
- The map's default view is Berlin (`createMapView`), so the first fly from the gallery starts there, not where the user was.
  Remembering the last camera would make arrival smoother.
- `ImportPanel.open`'s `quiet` option has no caller left (grep shows none passing it); it can go.
