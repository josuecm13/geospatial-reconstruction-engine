## Why

An import area can only be the rectangle it was imported with. To work on a neighborhood rather
than a box (for example, to trace the blocks that matter and export only those), a user needs to
draw an arbitrary shape over an imported area. Nothing imported may be lost in the process, and
several different cuts must be able to coexist over the same import. Milestone 9's client needs
this, and so does any renderer that consumes an export.

## What Changes

- **Traced boundaries (#47)**: a persisted, named polygon that belongs to one import area. The
  application validates it at write time, with the failed rule in the error, and the database
  enforces the same rules as a backstop. It never changes imported data.
- **CRUD endpoints (#48)**: create, list, fetch, and delete an import area's boundaries.
- **Scoped spatial queries (#49)**: `nearby`, `within-bbox`, and `nearest` take an optional
  boundary scope.
- **Scope export, filter mode (#50)**: `map-data` exports a scope (the whole area or one boundary)
  with complete blocks (buildable area, median and clipped flags) and local projection metadata.
- **Scope export, clip mode (#51)**: geometry cut at the boundary, for rendering only.

## Capabilities

### New Capabilities
- `traced-boundaries`: persistence and validation of named boundaries over an import area.

### Modified Capabilities
- `spatial-queries`, `spatial-query-api`: an optional boundary scope (#49).
- `import-area-api`: boundary endpoints (#48) and scope export (#50, #51).

## Impact

- New `server/app/domain/traced_boundary.py` and `server/app/persistence/repositories/traced_boundary.py`,
  `server/app/persistence/models.py`, and an Alembic migration with a CHECK constraint and a
  containment trigger.
- `server/app/persistence/spatial_queries.py` and the API routers, schemas, and mappers.
- `docs/schema.md`, `docs/client-features.md`, and `MILESTONES.md` (Milestone 8 status).
