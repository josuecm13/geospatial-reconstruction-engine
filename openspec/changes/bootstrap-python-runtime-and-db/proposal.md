## Why

Milestone 0 (repository and architecture baseline) is complete, but the repository has no code, no chosen runtime, and no way to start a database. Milestone 1 in `MILESTONES.md` calls for a runnable-but-incomplete foundation — a selected runtime, a local PostGIS instance, migrations, and bounding-box validation — so later milestones (domain persistence, OSM ingestion, graph construction, routing) have something concrete to build on.

## What Changes

- Establish Python 3.12 as the application runtime, with a documented local virtual-environment setup (no Poetry/pyenv — plain `venv` + `requirements.txt`).
- Add a minimal FastAPI application skeleton as the entrypoint (no real endpoints yet — those arrive in Milestone 7).
- Add a Docker Compose service running PostgreSQL with the PostGIS extension.
- Add environment-based configuration (`DATABASE_URL` etc.), replacing the placeholder values in `.env.example`.
- Add an Alembic migration scaffold, with an initial migration that enables the `postgis` extension.
- Implement a `BoundingBox` value object that validates WGS84 coordinate ranges/ordering and enforces the 1 km × 1 km maximum area limit described in `docs/architecture.md`.
- Add automated unit tests for valid, invalid, and oversized bounds.
- Add `AGENTS.md` documenting conventions for anyone (human or agent) contributing to this repo.
- Add `HOW_TO_RUN.md` with copy-pasteable setup and run steps for a clean checkout.

This change intentionally stops here: no domain persistence, OSM ingestion, graph, routing, or API endpoints. Those are later milestones and are out of scope.

## Capabilities

### New Capabilities
- `bounding-box-validation`: validates a candidate geographic bounding box (coordinate order, WGS84 range, and the 1 km × 1 km maximum area) before it can be accepted for a future import.

### Modified Capabilities
- None. This is a greenfield change; no existing specs exist yet.

## Impact

- New Python package layout, `requirements.txt`, and app entrypoint (greenfield — no existing code affected).
- New `docker-compose.yml` for local PostgreSQL/PostGIS.
- New `alembic/` migration scaffold and `alembic.ini`.
- Updated `.env.example` with real, documented variables.
- New `AGENTS.md` and `HOW_TO_RUN.md` at the repo root.
- No changes to `docs/architecture.md` or `MILESTONES.md` (Milestone 1's status will be updated separately once work is verified against acceptance checks).
