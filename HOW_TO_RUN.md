# How to run it

This project is a work-in-progress (Milestone 1 of `MILESTONES.md`). Right now you can run a
FastAPI skeleton backed by a local PostGIS database, apply migrations, and run the bounding-box
validation tests. There are no real API endpoints or domain data yet.

## Prerequisites

- Python 3.12 (check with `python3.12 --version`; on macOS with Homebrew: `brew install python@3.12`)
- Docker + Docker Compose (or Colima as the Docker runtime on macOS: `brew install colima docker
  docker-compose`)

## 1. Start the database container runtime

If you're using Docker Desktop, start it. If you're using **Colima**, start it instead:

```bash
colima start
```

## 2. Start PostgreSQL/PostGIS

```bash
docker compose up -d
```

This starts a `postgis/postgis` container on `localhost:5433` (not the default 5432, to avoid
clashing with any other local Postgres instance).

## 3. Create a virtual environment and install dependencies

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4. Configure environment variables

```bash
cp .env.example .env
```

The default `.env.example` values already match the `docker-compose.yml` service, so no edits
are needed for local development.

```bash
export $(grep -v '^#' .env | xargs)
```

## 5. Run database migrations

```bash
alembic upgrade head
```

## 6. Run the tests

```bash
pytest -q
```

## 7. Start the app

```bash
uvicorn app.main:app --reload
```

Then check:

```bash
curl localhost:8000/health
# {"status":"ok"}
```

## Stopping everything

```bash
docker compose down       # stop the database, keep its data
docker compose down -v    # stop the database and delete its data volume
```
