## Why

Milestone 9's client and any renderer consuming an export need to work on a traced neighborhood
rather than the imported box, without losing anything imported. This also gives blocks' 7.2 fields
(buildable area, median, clipped) their first path out of the API.

See `MILESTONES.md` → "Milestone 8 — Custom traced import-area boundaries" and #21.

## What Changes

- **Traced boundaries (#47)**: named polygons over an import area, validated in the application and backstopped in the database.
- **Boundary endpoints (#48)**: create, list, fetch, and delete under `/import-areas/{id}/boundaries`.
- **Scoped spatial queries (#49)**: optional `boundary_id` on `nearby`, `within-bbox`, and `nearest`.
- **Scope export, filter mode (#50)**: `map-data` for a scope, with complete blocks and projection metadata.
- **Scope export, clip mode (#51)**: geometry cut at the boundary, for rendering.

## Capabilities

### New Capabilities
- `traced-boundaries`: persistence and validation of named boundaries over an import area.

### Modified Capabilities
- `spatial-queries`, `spatial-query-api`: an optional boundary scope (#49).
- `import-area-api`: boundary endpoints (#48) and scope export (#50, #51).

## Impact

- Domain, persistence (new table, CHECK, trigger), spatial query service, API routers, schemas, and mappers.
- `docs/schema.md`, `docs/architecture.md`, `docs/client-features.md`, `MILESTONES.md`.
