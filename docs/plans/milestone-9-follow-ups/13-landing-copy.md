# 13 — Landing copy mentions heights (#117)

## Goal

The landing page says what the scene shows. Buildings stand at the height OpenStreetMap gives them,
and the copy should say so, along with the fact that a building without one gets a default that's
drawn paler.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 117`.

The claim holds. Heights from source are built end to end:

- The adapter parses `height` and `building:levels` (`server/app/ingestion/osm_adapter.py:147-160`
  `_height_meters`, 163 `_levels`, used at 317 and 395).
- The domain stores them (`server/app/domain/building.py:17-18`: `height_meters: float | None`,
  `levels: int | None`).
- `MILESTONES.md:528-530` marks Milestone 8.1 completed.
- The scene extrudes to them (`client/src/scene/buildingHeight.ts:20-24`): `height_meters`, else
  `levels × 3.2 m`, else a per-category default flagged `defaulted`. `buildWorld.ts:102-105` draws a
  defaulted one in the paler `buildingDefaulted` material.

The landing copy never mentions height.

## Code to read first

- `client/src/pages/landing.ts`
  - `FACTS` (29-36). The second fact, line 33, reads exactly:
    `"A city model the engine owns: streets with lanes and widths, buildable blocks, buildings, and a road graph that can be routed over."`
  - The hero lede, line 56: `"Pick a place on the map and the engine rebuilds it as a queryable model, then shows it to you in 3D."`
    It's fine as is: it doesn't describe buildings.
- `client/src/landing/architectureModel.ts`: the diagram's stages, shown on the landing page. The
  `client` stage's `produces` (line 76) includes exactly:
  `"A low-poly 3D scene to fly over and walk through"`.
  The `domain` stage (48) lists `"Logical streets, buildings, points of interest and area features"`.
- `client/src/scene/buildingHeight.ts`: the rule the copy must not contradict.

## Design

Change two strings. Keep the voice: short, plain, no marketing.

1. `landing.ts:33`, "What comes out", becomes:
   `"A city model the engine owns: streets with lanes and widths, buildable blocks, buildings at the height OpenStreetMap gives them, and a road graph that can be routed over."`
2. `architectureModel.ts`, the `client` stage line, becomes:
   `"A low-poly 3D scene to fly over and walk through, with buildings raised to their source heights (paler where the height is a default)"`.

Leave the `domain` stage alone. It lists entity kinds, not their attributes, and saying "height"
there would be the only attribute in the list. Don't add numbers (3.2 m per level, the category
table). They belong to the docs, not the landing page.

## Tests

No new test: this is copy. `client/src/landing/architectureModel.test.ts` checks the structure
(six stages, edges, a non-empty `produces`, doc links), and still passes with a changed string.
Check by hand that the fact card and the diagram's client card read well at desktop width and at
phone width (the requirement says the layout fits down to a phone).

## Docs and specs

- `openspec/specs/showcase-client/spec.md`, requirement "The client SHALL open on a landing page that
  explains the engine": in "what it produces (streets with lanes and widths, buildable blocks,
  buildings, and a routable graph)", change "buildings" to "buildings at their source heights where
  the source has them". No new scenario: the existing ones don't touch the copy.
- `docs/client-features.md`: the landing-page row (line 81) doesn't quote the copy, so there's no
  change.

## Outcome

## Tangents found
