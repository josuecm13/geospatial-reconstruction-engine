# Milestone 10: decisions and contract (#106, #139)

This is the shared reference for every Milestone 10 brief. It is the contract between the server and
client parts, which are built in parallel. Don't deviate from it: if something here is wrong
against the source, say so in your report instead of improvising.

## Decisions (made by the owner on 2026-10-10)

1. **Source: AWS Terrain Tiles** (Tilezen/Mapzen "terrarium").
   - URL: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. No key.
   - Max zoom 15 (zoom 16 returns 404). That's about 3.6 m per pixel at 40.76°N, but the underlying
     source is often coarser.
   - Decode: `height_m = (R * 256 + G + B / 256) - 32768`.
   - It's bare-earth where national LiDAR exists (US 3DEP and several European countries), and
     SRTM/GMTED/ETOPO elsewhere.
   - Licence: the sources are public domain or open licences that require attribution. The
     attribution list is at https://github.com/tilezen/joerd/blob/master/docs/attribution.md. The
     constant `TERRAIN_ATTRIBUTION` holds the short form:
     `"Terrain: AWS Terrain Tiles (Mapzen/Tilezen) — 3DEP, SRTM, GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1 NOAA; EU-DEM produced using Copernicus data; and others (github.com/tilezen/joerd/blob/master/docs/attribution.md)"`.
2. **Storage: a per-area grid plus stored derived heights.**
   - The grid is the single record of an area's ground. Building base heights and road vertex
     heights are computed from it once and stored.
   - Every consumer reads the stored values: the API, the scene, the glTF export, and Milestone 11's
     generated buildings. No consumer re-derives heights on its own.
   - Elevation lives in its own tables, apart from the OSM-observed tables (`docs/architecture.md`
     → "Raw layer and content layer"). No observed table gains a column.
3. **Building base: the lowest ground under the footprint.** It's the minimum of the exact grid
   sampled at the footprint's vertices and at every grid point inside it. Nothing floats. The same
   pure function will place Milestone 11's generated buildings.
4. **Roads: both exact and smoothed are stored, and the client toggles between them.**
   - Exact: the raw grid, sampled at each segment vertex.
   - Smoothed: a low-pass of the grid itself (a separable box blur with radius
     `SMOOTHING_METERS = 30`), sampled at each vertex.
   - Smoothing the field rather than each segment keeps heights continuous where segments meet.
   - Smoothed is the client's default. The glTF export uses whichever mode is on.
5. **Existing areas:**
   - Re-analysis runs per area (`POST /import-areas/{id}/elevation`) and over every completed area
     (a script).
   - It fetches no OSM data, changes no entity id or geometry, and running it twice changes
     nothing.
   - The area stays readable and draws flat until it finishes.
6. **Elevation never fails an import.** If the source is unavailable, the import completes flat
   and the area can be re-analysed later.

## Grid

- The grid is aligned to the area's bounding box in WGS84 degrees. The origin is the SW corner
  (`min_latitude`, `min_longitude`).
- `rows` × `cols` samples include both edges, so `lat_step = (max_lat - min_lat) / (rows - 1)`,
  and the same for longitude.
- Size: about 5 m spacing on each axis (metres per degree from the local projection's cosine of
  the latitude), clamped to between 2 and 256 samples per axis.
- Each sample is bilinear in the zoom-15 tile pixels at that coordinate (Web Mercator). Fetch
  every tile the box touches, plus a one-pixel margin.
- Heights are metres above sea level, stored as packed little-endian float32. They're row-major:
  row 0 is the south edge, and within a row, west to east.
- `version` is an integer per area. It starts at 1, and a re-analysis bumps it **only when the
  stored grid would change** (different heights, size or origin), so a second run changes nothing.
  Milestone 11 generation runs will record it.
- `algorithm`: `"terrarium-z15-bilinear-v1"`. `source`: `"aws-terrain-tiles"`.

## Tables (one Alembic migration)

- `area_elevation_grids`:
  - `import_area_id` UUID PK, FK `import_areas.id` **ON DELETE CASCADE**;
  - `origin_latitude`, `origin_longitude`, `lat_step`, `lon_step` (float8);
  - `rows`, `cols` (int);
  - `heights` (bytea);
  - `source`, `algorithm` (text);
  - `version` (int);
  - `smoothing_meters` (float8);
  - `analysed_at` (timestamptz).
- `building_elevations`: `building_id` UUID PK, FK `buildings.id` ON DELETE CASCADE;
  `base_elevation_meters` float8 not null.
- `road_segment_elevations`: `road_segment_id` UUID PK, FK `road_segments.id` ON DELETE CASCADE;
  `exact_meters` float8[] not null and `smoothed_meters` float8[] not null, each with one value per
  vertex of the segment's geometry, in order.

The cascades keep deleting an area (`ImportAreaRepository.delete`) and re-import's sweep working
without changing them.

## API contract

**`GET /import-areas/{id}/map-data`** (both modes, and with `boundary_id`) gains:

```jsonc
"elevation": null | {
  "source": "aws-terrain-tiles",
  "attribution": "<TERRAIN_ATTRIBUTION>",
  "version": 1,
  "smoothing_meters": 30.0,
  "grid": {
    "origin": { "latitude": 40.754, "longitude": -73.99 },   // SW corner
    "lat_step": 0.0000451, "lon_step": 0.0000593,
    "rows": 134, "cols": 136,
    "heights": [12.3, 12.4, ...]                              // rows*cols, row-major south→north, west→east, metres, rounded to 0.1
  }
}
```

- It's `null` when the area has no grid yet (not analysed, or the source was unavailable).
- The grid is the whole area's, even when the response is scoped to a boundary.
- In a composed area (inner areas inside the rectangle), the grid is the requested area's own.
- Building features gain `"base_elevation_meters": number | null`.
- Road-segment features gain `"elevation_exact": number[] | null` and
  `"elevation_smoothed": number[] | null`, each one value per vertex of the feature's geometry in
  order. In clip mode, a clipped segment's arrays are re-sampled from the stored grid at the clipped
  vertices: exact from the raw grid, smoothed from the smoothed grid.
- The existing top-level `attribution` (OSM) is unchanged.

**`POST /import-areas/{id}/elevation`**: re-analysis in the background.
- `202 {"import_area_id", "events_url"}`, the same shape as a background import. The events
  stream on the existing `/import-areas/{id}/events`: one `elevation` event, then `completed` or
  `failed`.
- `404 import_area_not_found`.
- `409 import_area_not_ready` when the area isn't `completed`.
- `409 import_in_progress` when a job for the area is running. That's the same registry and the
  same error as imports.
- `503 elevation_unavailable` only for the synchronous case below. In the background, a source
  failure is a `failed` event with code `elevation_unavailable`.

**Background import stages**: a new stage, `elevation`, runs after the import has committed and
the area is named, and before `completed`.
- Its data is `{"projection": ..., "elevation": <the map-data elevation object or null>,
  "error": null | "<code>"}`.
- On a source failure, the stage still emits with `elevation: null` and `error:
  "elevation_unavailable"`, and the import completes.
- The client's `IMPORT_STAGES` becomes
  `["fetched", "ground", "roads", "blocks", "buildings", "elevation", "generated", "completed", "failed"]`.

**Synchronous `POST /import-areas`** (`background: false`) also runs elevation after the import.
A source failure is logged, and the import still answers as before.

**Configuration**: `ELEVATION_URL` sets the tile URL template. `off` or an empty string disables
elevation, like `GEOCODER_URL`. Tests override the `get_elevation_source` dependency, so CI never
reaches the network.
