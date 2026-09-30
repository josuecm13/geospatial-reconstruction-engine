## Context

`OSMFixtureAdapter.parse` makes an `ImportPolygonFeature(source_id, node_ids, category)` for any
way with a `building` tag. The ingestion service upserts it into `buildings` on
`(import_area_id, source_id)`. `building_feature` in the API mappers emits `category` and
`block_id`. Nothing reads `height` or `building:levels`.

## Goals / Non-Goals

**Goals:** record what the source states about a building's height and level count, and carry it to
API consumers, with unknown kept distinct from any number.

**Non-Goals:** estimating a height from levels, or any per-category default. Both are inference
(Milestone 11), and the client marks defaulted heights itself. Also out of scope: `min_height`,
`building:min_level`, roof shapes, and `roof:levels`.

## Decisions

- **Buildings get their own import record type, `ImportBuilding`**, carrying `height_meters` and
  `levels`. Areas keep `ImportPolygonFeature`. Adding optional fields to the shared polygon record
  would give area features attributes they never have.
- **Height parsing** accepts a number optionally followed by `m` (`12`, `12.5`, `12 m`, `12m`), or
  feet written as `40'`, `40 ft`, or `40 feet`, converted at 0.3048 m per foot. A comma decimal
  (`12,5`) is read as a decimal point, since that's a common mapping mistake. Anything else
  (`tall`, `12;15`, a range) is unknown. So are values ≤ 0 and non-finite values. Parsing never
  raises.
- **Levels parsing** accepts a whole non-negative number (`3`, `3.0`). `0` is a valid observation:
  a roof or canopy with no full storey. Fractions like `2.5` and anything else are unknown, since
  a level count isn't fractional.
- **Columns** `buildings.height_meters DOUBLE PRECISION NULL` and `buildings.levels INTEGER NULL`,
  plus CHECKs `height_meters > 0` and `levels >= 0` as a backstop. The migration only adds
  columns, so existing rows get null and every count is unchanged.
- **Reconcile**: the building upsert updates both columns, so a changed tag updates in place under
  the same id, and a tag that disappears goes back to null.
- **API**: every building feature (map-data, spatial queries) carries `height_meters` and `levels`,
  null when unknown. There's no provenance field: null is the "unknown" signal. Provenance for
  inferred values arrives with Milestone 11.

## Risks / Trade-offs

- Feet-and-inches forms like `40'6"` are read as unknown rather than parsed. They're rare in OSM,
  and "unknown" is the safe failure.
