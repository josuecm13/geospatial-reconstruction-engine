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
`localhost:55432` (deliberately far from 5432/5433, to avoid clashing with any other local
Postgres instance) and waits for it to report healthy, creates `server/.venv` and installs
dependencies if needed, copies `server/.env.example` to `server/.env` if missing, and runs
`alembic upgrade head`. It's safe to re-run any time; each step is skipped or fast when already
done.

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
uvicorn app.main:app --reload --port "$APP_PORT"
```

`APP_PORT` (from `.env`, default `58000`) is likewise chosen away from common dev-server ports
(3000/5000/8000/8080/8888) so it won't collide with another project. Then check:

```bash
curl localhost:$APP_PORT/health
# {"status":"ok"}
```

## Stopping everything

```bash
./scripts/dev-down.sh              # stop the database container, keep its data
./scripts/dev-down.sh --volumes    # also delete the database's data volume
./scripts/dev-down.sh --colima     # also stop Colima itself (affects other projects using it too)
```
