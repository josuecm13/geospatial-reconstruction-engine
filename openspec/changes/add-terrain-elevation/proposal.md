## Why

Every building and road is drawn at ground level, so a hill is a flat city and a building on a slope
either floats or sinks. Milestone 10 adds ground elevation from a public terrain model, decided and
recorded in `docs/architecture.md` ("Terrain elevation"). The decisions have to land before the
generated buildings of Milestone 11 are placed, because they all read the same ground.

See #105.

## What Changes

- **Open-way POIs and unclosed features (#136)**: a POI drawn as an open way imports as a point, and unclosed buildings and areas are skipped instead of failing the import.
- **Multipolygon rings outside the box (#137)**: a ring outside the box is dropped when another ring of its relation touches it, instead of failing the import.
- **Elevation decisions (#106)**: the source, storage, base-height and road rules, and re-analysis are recorded in `docs/architecture.md` and `docs/schema.md`.
- **Terrain elevation (#139)**: a per-area ground grid fetched from the terrain source, derived building bases and road heights stored from it, an `elevation` import stage, re-analysis of existing areas, the map-data and re-analysis API, and terrain in the scene and glTF export.

## Capabilities

### New Capabilities
- `terrain-elevation`: fetching, storing, and deriving ground elevation for an import area.

### Modified Capabilities
- `import-area-api`: map data carries the elevation grid and per-feature heights, and an area can be re-analysed.
- `live-osm-import`: background imports gain an `elevation` stage that never fails the import.
- `showcase-client`: the scene draws terrain, walk mode follows the ground, roads toggle between exact and smoothed heights, and the glTF export carries both.

## Impact

- Server: a terrain tile source, a pure grid and height module, three new tables (one Alembic migration), an analysis service, the import pipeline's elevation stage, and the map-data and re-analysis endpoints.
- Client: the scene's ground mesh, road height toggle, walk mode, attribution, and the `IMPORT_STAGES` list.
- Configuration: `ELEVATION_URL`.
- Docs: `docs/architecture.md`, `docs/schema.md`, `docs/client-features.md`.
