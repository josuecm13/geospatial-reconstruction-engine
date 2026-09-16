# AGENTS.md

Conventions for anyone — human or agent — working in this repository.

## Project shape

- `docs/architecture.md` — the domain model and system boundaries. Read this before adding
  anything that touches persistence, ingestion, the graph, or routing.
- `MILESTONES.md` — the progressive delivery plan. Work is scoped to one milestone at a time;
  don't pull in a later milestone's concerns early just because the scaffolding exists.
- `app/domain/` — framework-agnostic domain value objects and entities. No FastAPI, SQLAlchemy,
  or OSM types leak in here.
- `app/config/` — environment-based settings and database engine setup.
- `app/api/` — HTTP layer (FastAPI). Thin; delegates to domain/repositories.
- `alembic/` — migrations. `alembic/env.py` reads `DATABASE_URL` from the environment; the
  connection string is never hardcoded in `alembic.ini`.
- `tests/` — mirrors the `app/` layout.

## Runtime

Python 3.12, plain `venv` + `requirements.txt` (no Poetry/pyenv). See `HOW_TO_RUN.md` for setup.

## Status

This project is intentionally incomplete. As of Milestone 1, there is a running FastAPI skeleton,
a local PostGIS database, migrations, and bounding-box validation — no domain persistence, OSM
ingestion, graph, or routing yet. Don't add those prematurely; they belong to later milestones
documented in `MILESTONES.md`.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Run tests before committing: `pytest -q` (see `HOW_TO_RUN.md` for environment setup).
- Domain code (`app/domain/`) must stay importable and testable without a database connection.
- New database access goes through SQLAlchemy/GeoAlchemy2, with schema changes made through an
  Alembic migration — never hand-edit the schema.
