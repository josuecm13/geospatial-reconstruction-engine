# 01 — The decision record (#106) and the Milestone 10 OpenSpec change

Model: haiku. Branch: `work/m10-docs`, from the tip of `origin/fix/136-dense-city-imports`. One
commit, don't push. Docs only, with no code. Don't run `openspec validate`, because CI runs it. You
may run `openspec --help` or `openspec list` to learn the CLI.

Everything below comes from `docs/plans/milestone-10/00-decisions-and-contract.md` (the
"contract"). Read it first. Don't add decisions it doesn't make.

## Part 1: the decision record (closes #106)

Add a section `## Terrain elevation` to `docs/architecture.md`, after "Raw layer and content layer".
It must state each item below plainly, with the reason. #106's acceptance criteria require all of
them.
- **Source:** AWS Terrain Tiles. Give the licence and attribution (link the joerd attribution page,
  and say the short attribution string ships in the API). No key. Max zoom 15, about 3.6 m per pixel
  at 40.76°N, with the underlying source often coarser. Vertical accuracy depends on the region's
  source: LiDAR-derived 3DEP in the US is decimetre to metre class, and SRTM/GMTED elsewhere is
  metres. Note that it's bare earth where national LiDAR exists, which is why it beat Copernicus
  GLO-30, a surface model with rooftops baked in.
- **Storage:** a per-area grid plus stored derived heights, in their own tables apart from the
  OSM-observed ones. Why: every consumer, including Milestone 11's generated buildings and the glTF
  export, must show the same elevation. The grid's `version` lets generation runs detect staleness.
- **Building base rule:** the lowest ground under the footprint. The case that decided it: a
  building on a slope must never float. The uphill side sinks into the ground instead.
- **Road rule:** both exact and smoothed are stored, and the client toggles between them. The case
  that decided it: about 30 m effective sampling makes a flat street bumpy. Smoothing is a box blur
  of the field (radius 30 m), not per segment, so heights stay continuous at junctions. Smoothed is
  the default.
- **Re-analysis of existing areas:** what triggers it (`POST /import-areas/{id}/elevation` and a
  script over every completed area). It re-fetches no OSM data, changes no entity id or geometry,
  and is idempotent (the version only bumps when the grid changes). The area stays readable, drawn
  flat, while it runs.
- **Elevation never fails an import.**

Also add the three new tables to `docs/schema.md`. Follow the file's existing style for tables and
ER diagrams, using the "Tables" section of the contract.

## Part 2: the OpenSpec change `add-terrain-elevation`

Create it under `openspec/changes/add-terrain-elevation/`, using the project schema
`openspec/schemas/milestone-driven/` (read `schema.yaml` and `templates/`). Mirror the structure and
tone of `openspec/changes/archive/2026-10-03-add-live-import-and-showcase-client/`.
- **`proposal.md`:** Why (link #105 rather than restating it). What Changes, with one bullet per
  issue: #136, #137, #106, #139. Capabilities: new `terrain-elevation`, and modified
  `import-area-api`, `live-osm-import`, `osm-fixture-ingestion` and `showcase-client`.
- **`design.md`:** the decisions, with a short rationale each (point to `docs/architecture.md` →
  "Terrain elevation" rather than copying it). Also the grid layout, the tables, the API shape and
  stage, and the alternatives rejected: Copernicus GLO-30 (a surface model), USGS 3DEP (US only),
  PostGIS raster (an extension with nothing it adds that the requirement needs), centroid and pad
  bases, and exact-only or smoothed-only roads.
- **`tasks.md`:** `## 1. Issues`, with one checkbox per issue in plan order:
  `- [ ] 1.1 #136 [ingestion] Import a POI drawn as an open way instead of failing the import`,
  `1.2 #137 …`, `1.3 #106 …`, `1.4 #139 …`, using the exact issue titles from GitHub (shown below).
  Tick 1.1 and 1.2 (`[x]`), because they're already done on the branch.
- **`specs/`:** delta specs in the format the archived change uses (`## ADDED Requirements` /
  `## MODIFIED Requirements`, each requirement with `#### Scenario:` blocks using WHEN/THEN). Look
  at `openspec/specs/<capability>/spec.md` for what exists before writing a MODIFIED block.
  - `specs/terrain-elevation/spec.md` (new capability), with ADDED requirements for:
    - grid fetch and decode;
    - grid layout and versioning (a re-analysis bumps the version only on change);
    - the building base rule;
    - road exact and smoothed heights;
    - storage apart from the observed tables;
    - idempotent re-analysis;
    - elevation never failing an import;
    - CI making no live call.
  - `specs/import-area-api/spec.md`: ADDED `elevation` on map-data (null when absent; the building
    and segment properties; clip-mode re-sampling) and the `POST /import-areas/{id}/elevation`
    endpoint, with every status in the contract.
  - `specs/live-osm-import/spec.md`: ADDED the `elevation` background stage and the
    source-unavailable case.
  - `specs/osm-fixture-ingestion/spec.md`: the open-way POI, unclosed-feature and multipolygon-ring
    rules from #136 and #137 are already in the living spec on this branch. Only add a delta if
    the archived-change format requires the change to carry them, and check the living spec first.
  - `specs/showcase-client/spec.md`: ADDED terrain in the scene (a ground mesh, roads, blocks and
    buildings on it), walk mode following the ground, the exact/smoothed road toggle (smoothed by
    default), the glTF export carrying the terrain and the current road mode, the attribution shown,
    and an area without elevation rendering flat.

Issue titles:
- #136 `[ingestion] Import a POI drawn as an open way instead of failing the import`
- #137 `[ingestion] Drop multipolygon rings outside the box instead of failing the import`
- #106 `[domain] Decide the elevation source, storage, and base-height rules`
- #139 `[domain] Terrain elevation: grid, derived heights, import and re-analysis, API, and scene`

Commit message:
```
docs: record the terrain decisions and open the Milestone 10 OpenSpec change (#106)

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
```

Report: the SHA, `git show --stat HEAD`, and anything in the contract you found ambiguous.
