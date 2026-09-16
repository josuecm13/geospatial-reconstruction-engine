## 1. Runtime scaffold

- [x] 1.1 Create the Python package layout (`app/` with `domain/`, `api/`, `config/` subpackages) per design.md.
- [x] 1.2 Add `requirements.txt` with FastAPI, Uvicorn, SQLAlchemy 2.0, GeoAlchemy2, psycopg, Alembic, pytest.
- [x] 1.3 Document venv creation with `python3.12` explicitly (not the system `python3`).
- [x] 1.4 Add a minimal FastAPI app factory with a `/health` endpoint (no domain endpoints yet).

## 2. Local database

- [x] 2.1 Add `docker-compose.yml` with a `postgis/postgis` service, named volume, and documented port.
- [x] 2.2 Update `.env.example` with a real `DATABASE_URL` and any other required variables, with comments.
- [x] 2.3 Add config loading (env-based) that fails fast with a clear error if `DATABASE_URL` is missing or the DB is unreachable.

## 3. Migrations

- [x] 3.1 Initialize Alembic (`alembic/` + `alembic.ini`) wired to the env-based `DATABASE_URL`.
- [x] 3.2 Add the first migration enabling the `postgis` extension.
- [x] 3.3 Verify migrations apply cleanly against an empty database volume.

## 4. Bounding box validation

- [x] 4.1 Implement the `BoundingBox` value object per `specs/bounding-box-validation/spec.md` (WGS84 range/order checks).
- [x] 4.2 Implement meter-based area calculation and the 1 km × 1 km max-area check.
- [x] 4.3 Add unit tests covering: valid box, out-of-range coordinates, inverted min/max, within-limit area, oversized area.

## 5. Documentation

- [x] 5.1 Write `AGENTS.md`: repo layout, conventions, how to run tests, commit message style.
- [x] 5.2 Write `HOW_TO_RUN.md`: start Docker Desktop, `docker compose up`, create venv with `python3.12`, install requirements, run migrations, start the app, run tests — as copy-pasteable commands.
- [x] 5.3 Update `MILESTONES.md` Milestone 1 status once acceptance checks below pass.

## 6. Verification and commit

- [x] 6.1 Run the full test suite locally and confirm it passes.
- [x] 6.2 Follow `HOW_TO_RUN.md` from a clean state (stopped containers, no venv) to confirm the instructions are accurate.
- [x] 6.3 Commit the change using Conventional Commits (e.g. `feat: bootstrap python runtime, postgis compose, and bounding box validation`).
