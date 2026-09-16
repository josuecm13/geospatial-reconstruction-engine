## Context

This is a greenfield change: no application code exists yet. `docs/architecture.md` already fixes the domain shape (entities, PostGIS `geometry`/`geography` split, provider-neutral graph) and `MILESTONES.md` scopes this change to Milestone 1. The local machine has Docker 29.6/Compose v2 installed but the daemon is not currently running, the system `python3` is 3.9.6 (too old), and `python3.12` (3.12.13) is available at `~/.local/bin/python3.12`. No Poetry or pyenv is installed. See `proposal.md` for why this change exists now.

## Goals / Non-Goals

**Goals:**
- Get from zero to a running FastAPI process backed by a local PostGIS database with one documented command sequence.
- Make the `BoundingBox` value object and its validation rules (WGS84 range, 1 km × 1 km max area) real, tested code — the one piece of actual domain behavior in this milestone.
- Leave migrations in a state where Milestone 2 can add domain tables without restructuring the scaffold.

**Non-Goals:**
- No domain persistence models, repositories, OSM ingestion, graph, routing, or real API endpoints (Milestones 2–7).
- No CI pipeline, linting/formatting enforcement, or dependency-manager migration (e.g. to Poetry) — can be revisited later if it becomes a pain point.
- No production deployment concerns (secrets management, cloud infra).

## Decisions

- **Runtime: Python 3.12, plain `venv` + `requirements.txt`.** Chosen over Poetry/pyenv because neither is installed locally and the project explicitly wants simple setup steps; `venv` and `pip` are stdlib/ubiquitous. Chosen over the system `python3` (3.9.6) because SQLAlchemy 2.0's typing features and modern FastAPI/Pydantic v2 work best on 3.10+, and 3.12 is already present on this machine.
- **Web framework: FastAPI**, per `docs/architecture.md`'s API section — even though no real endpoints are added yet, the skeleton (app factory, health check) should use the framework the API milestone will build on, so Milestone 7 doesn't start from scratch.
- **DB access: SQLAlchemy 2.0 + GeoAlchemy2**, with `psycopg` (v3) as the driver. GeoAlchemy2 is the standard way to map PostGIS `geometry`/`geography` columns onto SQLAlchemy models, matching the dual `geometry`/`geography` usage in the architecture doc.
- **Migrations: Alembic.** Idiomatic default for SQLAlchemy projects. The first migration only enables the `postgis` extension — no domain tables yet, since those belong to Milestone 2.
- **Local database: Docker Compose service (`postgis/postgis` image)**, exposing a single `db` service on a documented port, with a named volume so data survives restarts. `.env.example` gains a real `DATABASE_URL` pointing at this service.
- **`BoundingBox` as a plain dataclass/value object** (not a Pydantic model) in a `domain` package, so it stays framework-agnostic and reusable once real persistence and API layers are added. Area is computed by projecting to a meter-accurate calculation (matching the architecture doc's `geography`-based, meter-based measurement) rather than a flat-earth approximation, so the 1 km × 1 km check is accurate near the equator and at higher latitudes alike.
- **Project layout**: a single top-level Python package (name TBD at implementation time, e.g. `app/`) with `domain/`, `api/`, and `config/` subpackages, plus `alembic/` and `docker-compose.yml` at the repo root. Keeps the structure flat enough to navigate for a portfolio project while still matching the boundaries in `docs/architecture.md`.
- **Docs: two root-level files.** `AGENTS.md` documents repo conventions for contributors (human or agent) — where code lives, how to run tests, commit conventions. `HOW_TO_RUN.md` is a narrower, copy-pasteable "clean checkout to running app" walkthrough (venv, Docker Compose, migrations, starting the app). Keeping them separate avoids one bloated file serving two audiences.

## Risks / Trade-offs

- [Docker daemon isn't running by default on this machine] → `HOW_TO_RUN.md` explicitly calls out starting Docker Desktop as step 1; the app fails fast with a clear connection error if the DB is unreachable rather than hanging.
- [System `python3` is 3.9.6, which would silently produce confusing errors if used by mistake] → `HOW_TO_RUN.md` pins the exact interpreter path/command (`python3.12`) for venv creation, and the design avoids any syntax/library feature that only works on 3.12+ elsewhere, so a contributor who only has 3.10/3.11 can still likely run it.
- [No CI or lint enforcement yet] → acceptable for a single-contributor portfolio project at this milestone; revisit if the project gains contributors.
- [`requirements.txt` without lockfile hashes gives weaker reproducibility than Poetry/pip-tools] → acceptable trade-off for setup simplicity now; can migrate later if dependency drift becomes a problem.

## Migration Plan

Not applicable — greenfield change, no existing deployment or data to migrate. First run: `docker compose up`, `alembic upgrade head`, start the app.
