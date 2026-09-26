# AGENTS.md

Conventions for anyone — human or agent — working in this repository.

## Project shape

This is a monorepo: `server/` (Python backend) and, eventually, `client/` (web map viewer) live
as siblings at the repo root. `docker-compose.yml` at the root orchestrates shared services (the
database today; possibly more once `client/` exists) rather than belonging to either side.

- `docs/architecture.md` — the domain model and system boundaries. Read this before adding
  anything that touches persistence, ingestion, the graph, or routing.
- `docs/schema.md` — the persistence schema design (ER diagrams, enums, constraints). Keep it in
  sync with the actual Alembic migrations; it's design intent, not generated from the DB.
- `MILESTONES.md` — the progressive delivery plan. Work is scoped to one milestone at a time;
  don't pull in a later milestone's concerns early just because the scaffolding exists.
- `server/app/domain/` — framework-agnostic domain value objects and entities. No FastAPI,
  SQLAlchemy, or OSM types leak in here.
- `server/app/config/` — environment-based settings and database engine setup.
- `server/app/api/` — HTTP layer (FastAPI). Thin; delegates to domain/repositories.
- `server/alembic/` — migrations. `server/alembic/env.py` reads `DATABASE_URL` from the
  environment; the connection string is never hardcoded in `alembic.ini`.
- `server/tests/` — mirrors the `server/app/` layout.

## Runtime

Python 3.12, plain `venv` + `requirements.txt` (no Poetry/pyenv).

- `./scripts/dev-up.sh` — brings up the container runtime, PostGIS, venv, `.env`, and migrations
  in one idempotent step. Safe to re-run any time.
- `./scripts/dev-down.sh` — tears the docker compose stack back down (`--volumes` to also delete
  PostGIS data, `--colima` to also stop Colima, which affects other projects using it too).

PostGIS and the app server run on non-default ports (`55432`, and `APP_PORT` from `.env`, default
`58000`) to avoid colliding with another local project — don't hardcode `5432`/`5433`/`8000`
elsewhere. See `HOW_TO_RUN.md` for the full setup and what to do in your shell afterward.

## Status

This project is intentionally incomplete. Through Milestone 7, it has domain persistence, OSM
fixture ingestion (with automatic block derivation and reconciling re-import), spatial queries,
road graph traversal, routing, and a full HTTP API in front of all of it. Milestones 7.1, 7.2, 8,
and 9 onward — street/lane modeling, buildable blocks, custom traced boundaries, live OSM
retrieval and visualization, and the generated-content milestones — remain unbuilt. Don't pull
those in prematurely; see `MILESTONES.md` for current status and what's next.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Run tests before committing: `pytest -q` (see `HOW_TO_RUN.md` for environment setup).
  `.github/workflows/ci.yml` runs the same tests plus `openspec validate --all --strict` against a
  fresh PostGIS on every push/PR to `main` — it's a safety net, not a substitute for running tests
  locally first.
- Domain code (`server/app/domain/`) must stay importable and testable without a database
  connection.
- New database access goes through SQLAlchemy/GeoAlchemy2, with schema changes made through an
  Alembic migration — never hand-edit the schema.
