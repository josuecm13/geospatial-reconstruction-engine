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

This project is intentionally incomplete. As of Milestone 1, there is a running FastAPI skeleton,
a local PostGIS database, migrations, and bounding-box validation — no domain persistence, OSM
ingestion, graph, or routing yet. Don't add those prematurely; they belong to later milestones
documented in `MILESTONES.md`.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Run tests before committing: `pytest -q` (see `HOW_TO_RUN.md` for environment setup).
- Domain code (`server/app/domain/`) must stay importable and testable without a database
  connection.
- New database access goes through SQLAlchemy/GeoAlchemy2, with schema changes made through an
  Alembic migration — never hand-edit the schema.
