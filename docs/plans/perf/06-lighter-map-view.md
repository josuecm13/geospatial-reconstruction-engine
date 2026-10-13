# 06 — A lighter 2D map, without the POI dots

Issue: #151. The owner asked to remove the points-of-interest dots and to make the 2D map view lighter. Everything here
is in `client/src/views/mapDataLayers.ts` (MapLibre GL 6) unless stated otherwise. Read it whole first.

## The changes

1. **Remove the POI dots:**
   - Drop the `engine-pois` circle layer, the `pois` entry in `LAYERS` (so no `pois` GeoJSON source is created or fed),
     `engine-pois` in `CLICKABLE` and `ABOVE_BLOCKS`, its label in the description map, and its `featureRows` case.
   - Drop `MAP_COLORS.poi` and `poiStroke` from `views/mapColors.ts` if nothing else uses them.
   - Keep `pois` in the API types and the staged-build stream: the server still sends them, and Milestone 13 will use
     them.
2. **Don't re-tile the generated buildings on every streamed block.**
   - `pages/explore.ts:232` passes `streamed: (features) => mapLayers?.setGeneratedBuildings(features)`, and
     `setGeneratedBuildings` calls `setData` with the whole collection. Read where `streamed` is called (the scene view's
     generation sink, `scene/generationControls.ts`): if it fires once per block with everything so far, a
     740-block run re-tiles a growing collection 740 times, while the map is hidden behind the 3D view.
   - Coalesce:
     - while the map view is hidden, keep only the latest features and apply them when the map is shown (`mapShown`,
       `shown` hooks in `pages/explore.ts` and `importing/importPanel.ts`);
     - while it is visible, apply at most about once a second, with a trailing update so the last block always lands.
   - Keep the pure scheduling logic testable.
3. **Slimmer sources.**
   - MapLibre copies every feature's properties into its worker and into each tile. Feed each source only the
     properties its layer paint and filter expressions read, plus a numeric id. Keep the full properties in a
     `Map<number, properties>` on the class, so the popup (`describeFeature`, `featureRows`) and the block panel read
     them from there.
   - Read which properties each layer's `paint` and `filter` use before stripping. Read `featureRows` and the block
     selection (`select`, `this.panel?.show`, feedback updates) so they keep working.
   - MapLibre flattens nested properties to JSON strings (`featureRows` parses `street`). With full properties in the
     map that parsing may become unnecessary; keep it tolerant of both.
4. **Source options:**
   - Give every `geojson` source `maxzoom: 16` (vector overzoom keeps it crisp past that) and `tolerance: 0.5`. Leave
     `buffer` as it is.
   - Check the `OUTLINES` source and the map's own `maxZoom` in `views/mapView.ts` so nothing looks wrong at the
     closest zoom.
5. **Don't push unchanged data.** If `setMapData` (or its equivalent) is called with the same response object again,
   skip the `setData` calls.

## Docs

- `openspec/specs/showcase-client/spec.md` line 33 lists "points of interest, each describable by clicking" among what
  the map draws. Check whether `openspec/changes/add-scene-themes-and-time-of-day/specs/showcase-client/spec.md`
  modifies that requirement. Edit whichever text is current to drop POIs from the map, and add or adjust a scenario if
  one names POIs.
- `docs/client-features.md` line 55, the POI row: change the client cell to say POIs are drawn in neither view (the
  data stays in `map-data` for Milestone 13), and set the Client column accordingly (`not drawn`, or the file's term
  for that; read the legend at the top).

## Tests

Update `mapDataLayers` tests that mention POIs. Add vitest tests for:
- the coalescing scheduler;
- the property slimming (which keys stay per layer, and the id-to-properties lookup).

No WebGL. Do **not** run `npm test`, `npm run build` or any suite. `cd client && npx tsc --noEmit` is allowed.

## Deliverable

Commit on `work/perf-map-view` (`perf(client): ...`), ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Report:
- per-file changes;
- for each item, file:line and what you found (in particular how often `streamed` fires);
- the docs edits;
- tsc result.
