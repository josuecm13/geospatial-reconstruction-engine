# 01 — Dense-city imports: open-way POIs (#136) and multipolygon rings outside the box (#137)

Model: sonnet. Branch: `work/136-137`, from the tip of `origin/fix/136-dense-city-imports`. Make
**two commits, one per issue**, and don't push. `python -m py_compile` on changed files is fine. No
`pytest` / `npm test` / `openspec validate`: CI is the gate. Server only. Don't touch `client/`.

Both bugs abort a whole live import over one feature. They were reproduced against live Overpass for
Midtown (40.7540,-73.9900 – 40.7600,-73.9820: 29 open-line benches) and the Financial District
(40.7040,-74.0130 – 40.7100,-74.0050: 16 open-line benches plus two multipolygons).

## Part 1: #136, a POI drawn as an open way

`OSMFixtureAdapter.parse` (`server/app/ingestion/osm_adapter.py`) sends every non-road way with a POI
tag through `_polygon_nodes` (line 324). That function raises
`IngestionError("way <id> must be a closed polygon")` unless the way is a closed ring of 3 or more
distinct vertices. Example: way 945305161, `amenity=bench`, 2 nodes, open. Buildings (line 315) and
area features (line 331) go through the same check.

What to do:
- **POI way that isn't a closed ring.**
  - Import it as a point POI at the line's middle vertex (`node_ids[len(node_ids) // 2]`). That's
    stable for the same way, which matters because re-import reconciles by source id.
  - Set `footprint_node_ids` to the way's node ids. The field is only read by
    `_validate_within_bounding_box`, so the bench gets the same "envelope touches the box" rule as a
    road, and a bench crossing the edge isn't rejected. Update the field's comment to say it holds
    "the way's nodes, closed or not".
  - A POI way with fewer than 2 distinct nodes can't be placed. Skip it and count it, as below.
- **Building or area-feature way that isn't a valid closed ring.** Skip it, don't raise, and count it.
  - Add `skipped_features: tuple[str, ...] = ()` to `ImportRecords`, next to `skipped_restrictions`
    and documented the same way.
  - Plumb the count like `skipped_restriction_count`: `ImportResult` (`service.py:77`), the log line
    near `service.py:232`, `import_area_out` in `api/mappers.py`, `ImportAreaOut` in `api/schemas.py`,
    and both call sites (`api/background_import.py:114`, `api/routers/import_areas.py:131`). Name it
    `skipped_feature_count`.
- Closed POI, building and area ways behave exactly as before.

Tests (fixtures, no live Overpass): a small fixture JSON or an inline payload with an open-line
`amenity=bench`, an unclosed `building=yes` way, an unclosed `leisure=park` way, and one valid closed
building. Assert:
- the bench is a point POI at its middle vertex;
- the bad building and park are skipped, and the API response shows `skipped_feature_count` == 2;
- the closed building is imported;
- a bench whose middle vertex lies just outside the box but whose line crosses it is accepted.

Put adapter tests with the existing adapter tests (look under `server/tests/ingestion/`) and the
count in the API import tests (`server/tests/api/test_import_areas.py`). Follow how those files
build payloads.

## Part 2: #137, multipolygon rings outside the box

`_multipolygon_features` (`osm_adapter.py:366`) turns each closed outer ring of a multipolygon
building or area into its own feature. The source id is `relation/<id>` when the relation has one
ring, else `relation/<id>/<ring index>`, with synthetic node ids `<source_id>#<i>`. Overpass returns
a relation whole, so a big relation (harbour water, relation 2389633; a waterfront park, 16066428)
arrives with rings far outside the box. `_validate_within_bounding_box` (`service.py:430`) checks each
ring as its own feature and raises `PayloadOutsideBoundingBox`.

What to do: in `OSMIngestionService`, before `_validate_within_bounding_box` runs, drop
multipolygon ring features whose envelope lies entirely outside the box, but only when at least one
other ring of the same relation touches it.
- Group by relation using the `relation/<id>` prefix of `source_id`.
- If no ring of a relation touches the box, keep them all, so the existing rejection still fires.
- Apply it on both paths that validate: `import_fixture` (line 99) and the live path (line 296).
  Prefer one helper that returns filtered `ImportRecords` (`dataclasses.replace`).
- Keep the ring ids unchanged. Indexes come from the relation's full ring list, so a ring keeps its
  id whichever box imports it.
- Drop the dropped rings' synthetic nodes from `records.nodes` only if leaving them would persist
  something. Check how `records.nodes` is used before deciding, and say what you found.
- Roads, ways and node POIs outside the box are still rejected exactly as now.

Tests (fixtures, no live Overpass): a multipolygon `natural=water` with two outer rings, one
crossing the box and one wholly outside it. The import succeeds, and only the crossing ring is
stored, under its original `relation/<id>/<index>` id. A multipolygon with every ring outside the box
still fails with `PayloadOutsideBoundingBox`. Look at the existing multipolygon tests (#20) for how
they build relation payloads, and at `test_live_import.py` for the live path with a stub Overpass.

## Docs and specs

- `openspec/specs/osm-fixture-ingestion/spec.md`: the open-way POI rule, skipping unclosed
  buildings and area features, and the ring rule for the bounding box, each with a scenario.
  `openspec/specs/live-osm-import/spec.md` only if it states the bounding-box rule itself.
- `docs/client-features.md`: a row for `skipped_feature_count` next to the skipped-restrictions row
  (line 26), with the same shape and the client column "—".

## Commits

```
fix(ingestion): import a POI drawn as an open way, skip unclosed buildings and areas (#136)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```
```
fix(ingestion): drop multipolygon rings outside the box instead of failing the import (#137)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Report both SHAs, `git show --stat` for each, what you found about `records.nodes`, and anything in
this brief that didn't match the source.
