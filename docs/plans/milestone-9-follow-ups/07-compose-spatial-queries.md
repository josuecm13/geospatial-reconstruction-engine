# 07 — Spatial queries compose nested areas (#108)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 108`

`map-data` of an outer import area composes its inner areas: their buildings, POIs and area features
join the area's own, deduplicated by source id. The spatial-query endpoints don't compose. Every
query filters on `model.import_area_id == import_area_id`, so on an outer area they miss everything
the outer import skipped because an inner area already held it. Make the spatial queries compose the
way `map-data` does.

The issue lists four endpoints. Against the current code:

- `/nearby` and `/within-bbox`: true. Kinds `poi`, `building` and `area_feature` miss the inner
  areas' rows.
- `/buildings/{building_id}/footprint-area`: true. It answers 404 `building_not_found` for a building
  id that the outer area's `map-data` returns with an inner area as owner.
- `/nearest`: **not affected.** It only takes `kind=node|segment` (`NearestKind`,
  `server/app/api/schemas.py:54-56`). The road network is stored whole in the outer area
  (`docs/architecture.md` → "Nested import areas"), and `map-data` returns only the area's own
  segments and nodes too. `/nearest` is already consistent with `map-data`, so leave it unchanged.
- Kind `node` on `/nearby` and `/within-bbox` stays the area's own for the same reason.

## Code to read first

- `server/app/api/routers/spatial_queries.py` (125 lines): `nearby` (lines 41-61) and `within_bbox`
  (lines 64-92) dispatch on kind to a `SpatialQueryService` method, passing `area.id` and the
  optional boundary. `nearest` (lines 95-110) covers nodes and segments only. `footprint_area`
  (lines 113-125) maps `UnknownImportArea` to 404 `building_not_found`.
- `server/app/persistence/spatial_queries.py` (215 lines): `SpatialQueryService`. The generic
  `_within_radius` (154-165), `_intersecting_bbox` (167-177) and `_contained_by_bbox` (179-189) each
  filter `model.import_area_id == import_area_id`. `_scope` (191-203) loads the traced boundary
  of the *named* area and adds `ST_Intersects`. `building_footprint_area_square_meters` (106-116)
  filters `BuildingModel.import_area_id == import_area_id`.
- `server/app/api/routers/import_areas.py`, `get_map_data` (lines 207-271): this is the reference
  behaviour. `composed_area_ids` comes from
  `ImportAreaRepository.completed_areas_covered_by(area.bbox, exclude_id=area.id)` (lines 222-224).
  `owner_ids = [area.id, *composed_area_ids]`, and `_composed` (274-278) calls `compose_by_source_id`
  over each owner's whole layer in that order, so the area's own copy wins and then the earlier
  composed area.
- `server/app/persistence/repositories/import_area.py:62-75`, `completed_areas_covered_by`: ordered
  by `min_latitude, min_longitude, id`.
- `server/app/domain/covered_areas.py:47-58`, `compose_by_source_id`: the first copy of a source id
  wins.
- `server/app/persistence/map_scope.py`: `ids_intersecting_boundary` and `clip_to_scope` already take
  `composed_area_ids: Sequence[uuid.UUID] = ()`, and apply it to the feature layers only (lines
  41-75 and 98-142). Use the same parameter shape here.
- `server/tests/api/test_nested_import_areas.py`: the fixture grid, `INNER_BBOX` / `OUTER_BBOX`,
  `_payload`, `_import_inner`, `_import_outer`, and the source-id constants (`INNER_BUILDING`,
  `STRADDLING_BUILDING`, `OUTER_BUILDING`, `INNER_PARK`, `INNER_POI`, `OUTER_POI`).

## Design

**The rule.** A spatial query over a feature layer (POIs, buildings, area features) on area `A`
answers over the same set of rows that `map-data` of `A` composes, then applies its own predicate. A
row counts when its owner is in `owners = [A, *composed_area_ids]`, and no owner earlier in `owners`
holds a row with the same `source_id`.

The dedup has to run on the owner set, not on the query's matches. Otherwise an inner area's copy
could answer a `contains` query that the winning outer copy fails. That would return a feature
`map-data` doesn't show under that owner. In practice the copies share geometry, but the rule
shouldn't depend on that.

**Service.** Give the three generic helpers and `building_footprint_area_square_meters` a keyword
`composed_area_ids: Sequence[uuid.UUID] = ()`, passed in by the router. Replace the
`model.import_area_id == import_area_id` clause with one helper:

```python
def _owned(self, model, owners: Sequence[uuid.UUID]):
    """Rows of `model` that the composed layer of owners[0] shows: owned by one of `owners`, and
    not shadowed by a row with the same source_id owned by an earlier owner."""
```

Build it as an `or_` over the owners. Each owner `i` gives
`and_(model.import_area_id == owners[i], ~exists(earlier copy with model.source_id among owners[:i]))`,
using an `aliased(model)` for the earlier copy. A single-owner list collapses to today's clause.
Nodes don't go through `_owned`. They stay `import_area_id == import_area_id`.

**Boundary scope.** The traced boundary belongs to `A`. `_scope` already loads it by `A`'s id, and
`ST_Intersects` applies to composed rows unchanged. No change needed there.

**Router.** Compute `composed_area_ids` once per request, the way `get_map_data` does. Put the
lookup in one place, a small helper in `app/api/dependencies.py`, for example a dependency
`composed_area_ids(area, session) -> list[uuid.UUID]`. Use it from the spatial routes. Switching
`get_map_data` to it is optional and keeps the two in step. Pass it for the `poi`, `building` and
`area_feature` kinds only.

**Footprint area.** Accept a building whose owner passes `_owned` for `[A, *composed]`. Then every
building id that `map-data` of `A` returns works here, and a shadowed inner copy (one `map-data`
doesn't return) stays 404 `building_not_found`. Pick this rather than "any owner in the list", so the
ids `map-data` returns are exactly the ids that work.

**Left to the implementer:** the SQL form of the shadow test (the `or_`/`exists` above, or a
`CASE` rank with `DISTINCT ON (source_id)` in a subquery). Choose whichever reads better, as long as
the single-area query plan doesn't regress.

## Tests

Add these to `server/tests/api/test_nested_import_areas.py`, so they reuse its fixtures. Import the
inner area, then the outer:

- `/nearby?kind=building` around the inner building, on the outer area: it returns `INNER_BUILDING`
  with `properties.import_area_id == inner id`.
- `/nearby?kind=building` with a radius that covers the straddling building: `STRADDLING_BUILDING`
  appears exactly once, owned by the outer area.
- `/nearby?kind=poi` and `kind=area_feature` find `INNER_POI` and `INNER_PARK` on the outer area.
- `/within-bbox` (`building`, both `intersects` and `contains`) over the inner box, on the outer area:
  the inner building and no duplicate source ids. Map ids to source ids with the file's
  `_source_ids` helper.
- `/within-bbox?kind=node` on the outer area returns the same nodes as before (only the outer area's
  own). This guards against composing the network by mistake.
- `footprint-area` on the outer area: works for the inner building's id. Gives 404
  `building_not_found` for the inner area's shadowed copy of `STRADDLING_BUILDING`, if the inner
  import stores one. Check `_payload(inner_only=True)`: it includes the straddling building, so the
  inner area holds a copy.
- A boundary-scoped `/nearby` on the outer area composes too. Create a boundary over the inner box,
  as in `test_a_boundary_scope_composes_the_inner_area_filtered_by_the_boundary`.
- Querying the inner area itself is unchanged: it has no inner areas.

Guard tests are not mutation-checked (no local runs). Say so.

## Docs and specs

- `openspec/specs/spatial-query-api/spec.md`:
  - Modify `### Requirement: Spatial queries SHALL be scoped to an existing, completed import area`
    (line 59). It says queries "SHALL only return entities belonging to the named import area".
    Change this to: the named area, plus, for POIs, buildings and area features, the inner areas it
    composes, as `map-data` does.
  - Add `### Requirement: Spatial queries SHALL compose an import area's inner areas`. Radius and
    bounding-box queries for POIs, buildings and area features, and the footprint area, SHALL cover
    the completed inner areas the area composes in `map-data`, with the same precedence: a source
    id at most once, the area's own copy first. Nodes and segments SHALL be the area's own. Add
    scenarios for an inner area's building found from the outer area, and a shared building returned
    once as the outer copy.
- `docs/client-features.md` → "Spatial queries (whole import area)": in the `nearby`,
  `within-bbox` and footprint-area rows, note that they compose inner areas like `map-data`. Brief 12
  (#116) reconciles this file later, so keep the edit to those rows.
- `docs/architecture.md`: in the endpoint list (lines 89-91), add that spatial queries compose
  inner areas. In "Nested import areas" (the paragraph at lines 134-138), say that the spatial
  queries compose the same way as `map-data`.

## Outcome

Done. The brief's claims held: the three generic helpers and the footprint query filtered on
`import_area_id ==` only, `NearestKind` is `node | segment` (`schemas.py:54-56`), and `get_map_data`
computed `composed_area_ids` inline.

- **Service** (`app/persistence/spatial_queries.py`). New static `_owned(model, owners)`: an `or_`
  over the owners, each owner after the first `AND NOT EXISTS` a row of an `aliased(model)` with the
  same `source_id` owned by an earlier owner. One owner collapses to the plain
  `import_area_id ==` clause, so the single-area query is unchanged. `_within_radius`,
  `_intersecting_bbox`, `_contained_by_bbox` and `building_footprint_area_square_meters` take
  `composed_area_ids=()` and use `_owned`. Only the POI, building and area-feature public methods
  accept `composed_area_ids`; the node methods don't, so they can't be composed by mistake.
  `/nearest` is untouched. Checked the compiled SQL for three owners against the PostgreSQL dialect:
  the shadow subquery correlates to the outer row as intended.
- **Router.** A dependency `composed_import_area_ids(area, session)` in `app/api/dependencies.py`
  (named so it doesn't clash with the `composed_area_ids` locals). `nearby`, `within_bbox` and
  `footprint_area` use it, passing it to the feature-layer kinds only (`functools.partial` in the
  dispatch tables). I also switched `get_map_data` to it, so map-data and the queries share one
  lookup.
- **Boundary scope** needed no change: `_scope` loads the boundary by the outer area's id and its
  `ST_Intersects` applies to composed rows.
- **Tests** (`server/tests/api/test_nested_import_areas.py`): nine new cases (one parametrized over
  `intersects`/`contains`) covering every bullet in the brief, including the node guard (owners of
  the returned nodes looked up in the DB, since `node_feature` carries no `import_area_id`) and the
  404 for the inner area's shadowed copy of `STRADDLING_BUILDING`. Written, not run locally; CI is
  the gate. Guards not mutation-checked.
- **Verified.** `py_compile` on every changed file; `import app.main` succeeds (FastAPI resolves the
  new dependency signatures at import).
- **Docs.** `spatial-query-api` spec: the scoping requirement amended, plus a new "compose an import
  area's inner areas" requirement with three scenarios. `client-features.md`: the `nearby`,
  `within-bbox` and footprint-area rows only. `architecture.md`: the endpoint list and the "Nested
  import areas" paragraph.

## Tangents found

- None.
