## Context

Import areas hold OSM-observed buildings and road segments, all at ground level. Milestone 9 has no
height for the ground under them. The raw/content split (`docs/architecture.md`, "Raw layer and
content layer") forbids writing derived heights into observed rows, and Milestone 11 will generate
buildings that must sit on the same ground. See proposal.md, Why.

The decisions themselves are recorded in `docs/architecture.md` ("Terrain elevation") and the tables
in `docs/schema.md` ("Terrain elevation (Milestone 10)"). This document covers only how they are built.

## Goals / Non-Goals

**Goals:**
- One stored ground record per area that every consumer reads: API, scene, glTF export, generation.
- Buildings never float on a slope; roads read as flat streets.
- Elevation never fails an import, and an existing area can be analysed later without changing its ids or geometry.

**Non-Goals:**
- Generated buildings, and the generation run that records the grid version (Milestone 11).
- Changing OSM ingestion, reconcile, or the observed tables.
- A PostGIS raster or any new database extension.
- Caching tiles across areas, or a second elevation source.

## Decisions

- **Source: AWS Terrain Tiles, Terrarium encoding, zoom 15.** Bare earth where national LiDAR exists,
  so the ground is the ground, not a roof. Copernicus GLO-30 was rejected because it is a surface
  model. USGS 3DEP alone was rejected because it covers the US only. Zoom 15 is the maximum the
  source serves.
- **Grid per area, aligned to the bounding box in WGS84.** Origin at the south-west corner, samples
  including both edges, about 5 m spacing, clamped to 2–256 per axis. Each sample is bilinear in the
  zoom-15 pixels at its coordinate, with one pixel of margin around the box. Heights are packed
  little-endian float32, row-major, south to north. This keeps the grid a single blob per area and
  makes the stored version a clear staleness signal.
- **Versioned grid, bumped on change only.** `version` starts at 1 and increases only when heights,
  size, or origin change. Re-analysis is therefore idempotent, and Milestone 11 can record which
  version it used.
- **Building base is the minimum of the grid under the footprint.** Sampled at the footprint's
  vertices and at every grid point inside it. The uphill side sinks rather than the downhill side
  floating. A centroid base was rejected for leaving the downhill side in the air.
- **Roads store both exact and smoothed heights.** Exact is the raw grid at each vertex. Smoothed is
  a separable box blur of the grid (radius 30 m) sampled at each vertex. Smoothing the field rather
  than each segment keeps heights continuous at junctions. Exact-only was rejected because a flat
  street looks bumpy at 30 m effective sampling. Smoothed-only was rejected because the client toggles
  between the two, so both must be stored.
- **Storage in three tables outside the observed ones.** `area_elevation_grids` (one per import
  area), `building_elevations` (one `base_elevation_meters` per building), and
  `road_segment_elevations` (two `float8[]` arrays parallel to the segment's vertices). All foreign
  keys cascade, so area deletion and re-import's sweep need no change. Derived heights are stored
  rather than computed on read, so every consumer sees the same values.
- **Stage and re-analysis.** An `elevation` stage runs after the import has committed and the area is
  named, before `completed`. A source failure there emits the stage with `elevation: null` and
  `error: "elevation_unavailable"`, and the import completes. `POST /import-areas/{id}/elevation` runs
  the same analysis for one completed area in the background, using the existing job registry and
  event stream. A script runs it over every completed area.
- **Map data.** The `elevation` object is the area's whole grid, rounded to 0.1 m for transport. Per-feature
  arrays and base heights are read from storage. In clip mode, a clipped segment's arrays are
  re-sampled from the stored grid at its clipped vertices. The grid is the requested area's own, even
  when the response is scoped to a boundary or the area has inner areas.
- **Tests never reach the network.** The tile source is a dependency that tests override, so CI runs
  the whole pipeline on a stub source.

## Risks / Trade-offs

- **Coarse regional sources.** Where only SRTM or GMTED covers an area, heights are metre class, so a
  building can still sit slightly off its real ground. → Mitigation: the attribution and the source
  name ship in the API, and the accuracy note is in `docs/architecture.md`.
- **Tile source outage during import.** → Mitigation: the import completes flat, and re-analysis
  recovers the area later.
- **Grid size on the largest allowed box.** A 1 km² box at about 5 m spacing is about 200 by 200
  samples, with the map-data response carrying roughly 40 000 heights. → Mitigation: heights are
  rounded to 0.1 m, and the grid is returned once per response, not per feature.
- **Versioned staleness is only as good as the bump rule.** If the rule were wrong, generation could
  silently reuse old heights. → Mitigation: the spec has scenarios for both a changed and an
  unchanged re-analysis, so the implementation PR has to test both.
