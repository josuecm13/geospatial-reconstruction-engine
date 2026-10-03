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

## Tangents found
