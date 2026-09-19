# How to run it

This project is a work-in-progress (Milestone 1 of `MILESTONES.md`). Right now you can run a
FastAPI skeleton backed by a local PostGIS database, apply migrations, and run the bounding-box
validation tests. There are no real API endpoints or domain data yet.

## Prerequisites

- Python 3.12 (check with `python3.12 --version`; on macOS with Homebrew: `brew install python@3.12`)
- Docker + Docker Compose (or Colima as the Docker runtime on macOS: `brew install colima docker
  docker-compose`)

## 1. Bring up the container runtime, database, venv, env vars, and migrations

```bash
./scripts/dev-up.sh
```

This starts Colima (if Docker isn't already running), starts a `postgis/postgis` container on
`localhost:5433` (not the default 5432, to avoid clashing with any other local Postgres instance)
and waits for it to report healthy, creates `server/.venv` and installs dependencies if needed,
copies `server/.env.example` to `server/.env` if missing, and runs `alembic upgrade head`. It's
safe to re-run any time; each step is skipped or fast when already done.

The script runs in its own subshell, so it can't leave your virtualenv activated or env vars
exported in *your* shell. Do that once per new shell:

```bash
cd server
source .venv/bin/activate
set -a && source .env && set +a
```

## 2. Run the tests

```bash
pytest -q
```

## 3. Start the app

```bash
uvicorn app.main:app --reload
```

Then check:

```bash
curl localhost:8000/health
# {"status":"ok"}
```

## Stopping everything

From the repo root:

```bash
docker compose down       # stop the database, keep its data
docker compose down -v    # stop the database and delete its data volume
```
