## Why

Everything the engine builds is reachable only by posting a hand-made payload and reading JSON.
This change makes a real place importable by selecting it, and gives the result a client worth
showing. Real Overpass data is the first input the parser hasn't been shaped around, so the
adapter gaps it exposes are fixed first.

See `MILESTONES.md` → "Milestone 9 — Live import and the showcase client" and #27.

## What Changes

- **Reject incomplete responses (#15)**: a payload carrying an Overpass `remark` never reaches reconcile.
- **Out-of-box way nodes (#14)**: ways whose nodes Overpass emits only as inline geometry import.
- **Link and living-street classes (#16)**: those ways join the graph instead of being dropped.
- **Roundabouts (#17)**: `junction=roundabout` implies one-way.
- **Reversible one-way (#18)**: `oneway=reversible`/`alternating` no longer fail the import.
- **Vehicle-scoped restrictions (#19)**: `restriction:<vehicle>` no longer fails the import.
- **Multipolygons (#20)**: multipolygon buildings and areas import.
- **POI areas on the edge (#74)**: a POI area crossing the box edge is accepted.
- **Street id on map data (#35)**: road segments carry their logical street's id.
- **Live Overpass import (#61)**: `POST /import-areas` without a payload fetches the box live.
- **Client scaffold (#62)**, **rectangle import (#63)**, **boundary tracing (#64)**, **3D scene (#65)**, **fly and walk (#66)**, **build animation (#67)**, **route in the scene (#68)**, **glTF export (#69)**, **walkthrough and runbook (#70)**.

## Capabilities

### New Capabilities
- `live-osm-import` (#61): fetching a bounding box from Overpass.
- `showcase-client` (#62–#69): what the client lets a user do.

### Modified Capabilities
- `osm-fixture-ingestion`: completeness, the real-data tag cases, multipolygons, and POI areas.
- `import-area-api`: optional payload, new error codes, and the street id on map data.

## Impact

- Ingestion adapter and service, a new Overpass client, the import router, and error mapping.
- New `client/` (TypeScript, Vite, MapLibre GL, Three.js). CI gains a Node job.
- `docs/architecture.md`, `docs/client-features.md`, `HOW_TO_RUN.md`, `MILESTONES.md`.
