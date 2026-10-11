## Why

Blocks are the unit people read a place by, but today they carry no buildings: the built world is
only what OSM maps, which is sparse where it is most interesting to see. Milestone 11 fills each
eligible block with generated buildings, placed on the ground the Milestone 10 grid describes, and
lets a person correct a block by hand. The featured place lets the showcase open on a chosen area.

See #23.

## What Changes

- **Generation (#23)**: each import area gets one deterministic run that places buildings on its eligible blocks, from reference blocks, default settlement styles, and the stored ground. Runs are stored, regenerated with a new seed, deleted to restore OSM-only, and reported stale when roads or terrain change.
- **Block feedback (#23)**: a block's actual building count, or "no buildings here", is stored and applied on the next run, with calibration of similar blocks nearby and orphaned feedback reported.
- **Land-use kinds (#23)**: forest, farmland, cemetery, railway and industrial area features are imported and drawn, and they exclude land from generation.
- **Block outlines and selection (#23)**: inset dashed outlines by eligibility, a block panel with real and generated counts and the feedback controls, and zones shaded by reason under Show blocks, which replaces Show buildable area.
- **Generate and show generated (#23)**: the scene offers Generate or Regenerate with progress on the event stream, a Show generated toggle, and a generated-building colour distinct from measured and defaulted buildings.
- **Set point tool (#23)**: a Set point tool and double-click drop a pin on the terrain that both fly and walk modes work from.
- **Featured place (#23)**: a site setting names the area the landing page features, set from the location cards with Show on landing.

The owner chose no sub-issues for this milestone: everything ships in PR #140 under #23.

## Capabilities

### New Capabilities
- `block-generation`: eligibility, suitability, references, matching, and the deterministic generated buildings of an import area, with their storage and staleness.
- `block-feedback`: storing, clearing and listing the owner's correction of a block, and how it steers the next run.
- `site-settings`: the featured area setting that the landing page reads.

### Modified Capabilities
- `import-area-api`: generation endpoints, generation and generated-building layers on map data, and new block properties.
- `osm-fixture-ingestion`: five land-use area-feature kinds and their tags.
- `showcase-client`: Generate and Show generated, the generated colour, block outlines and selection with feedback, zone shading, export following visibility, the Set point tool, and Show on landing; Show buildable area becomes Show blocks.

## Impact

- Server: pure eligibility and fingerprint rules in `app/domain/generation.py`, a shapely `app/generation/` package, persistence for four tables and a settings table (Alembic migrations), a feedback and generation API, a background generation job on the existing event stream, and the land-use kinds in the OSM adapter.
- Client: the generation controls, the generated colour, the block outlines and panel, zone shading, the Set point tool, and the featured badge on location cards.
- Docs: `docs/architecture.md` ("Generated block content"), `docs/schema.md`, `docs/client-features.md`.
