# How to run it

This project is a work-in-progress (see `MILESTONES.md` for status). You can run the FastAPI
application backed by a local PostGIS database, apply migrations, run the test suite, and call the
HTTP API to import a fixture area, query it, and plan a route.

For a terse, step-by-step path from a clean checkout to an exported real place, see [`docs/runbook.md`](docs/runbook.md); the UI tour is [`docs/walkthrough.md`](docs/walkthrough.md).

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

The tests never use the development database. They run against `TEST_DATABASE_URL` when it's set,
otherwise against `DATABASE_URL` with `_test` appended to the database name (`geodb_test` with
the default `.env`), which the test session creates and migrates on first run. Data you import
through the running app therefore can't affect the tests, and a test run leaves `geodb` untouched.

To see where an import's time goes, run `scripts/benchmark_import.py` from `server/` (with `.env` loaded
and `PYTHONPATH=.`). It imports a recorded 1 km² Berlin Mitte payload into the development database,
prints the time per step (parse, persist features, sweep, turns, block derivation, link buildings), and rolls
everything back. It is a measurement, not a test, and CI doesn't run it.

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

## Calling the API

Import a fixture payload for a bounding box, then request a route within it. The routing fixture
below (`server/tests/fixtures/osm_routing.json`) is a small five-node road network with no
buildings.

```bash
curl -s -X POST localhost:$APP_PORT/import-areas \
  -H 'Content-Type: application/json' \
  -d "{\"bbox\": {\"min_latitude\": 9.9995, \"min_longitude\": -84.003, \"max_latitude\": 10.002, \"max_longitude\": -83.999}, \"payload\": $(cat server/tests/fixtures/osm_routing.json)}"
# {"id": "...", "provider": "osm", "status": "completed", "road_count": 5, ...}
```

To import a real place instead, omit `payload`: the box is fetched live from Overpass
(`https://overpass-api.de` by default; set `OVERPASS_URL` to use another instance). Keep boxes
small while trying it out, since the public instance is shared and sometimes busy, which shows
up as a 503 `upstream_unavailable`.

```bash
curl -s -X POST localhost:$APP_PORT/import-areas \
  -H 'Content-Type: application/json' \
  -d '{"bbox": {"min_latitude": 52.5285, "min_longitude": 13.3995, "max_latitude": 52.5310, "max_longitude": 13.4035}}'
# {"id": "...", "status": "completed", "road_count": 61, "building_count": 147, "block_count": 15, ...}
```

Every response uses the same envelope: `{"error": {"code", "message", "details"}}` on failure, or
the resource's own shape on success. Save the returned `id` as `AREA_ID`, then:

```bash
curl -s -X POST localhost:$APP_PORT/import-areas/$AREA_ID/routes \
  -H 'Content-Type: application/json' \
  -d '{"origin": {"latitude": 10.0, "longitude": -84.000}, "destination": {"latitude": 10.0, "longitude": -84.002}}'
# {"node_ids": [...], "segment_ids": [...], "geometry": {"type": "LineString", ...},
#  "total_distance_meters": ..., "strategy": "distance", ...}
```

`GET /import-areas/$AREA_ID/map-data` returns every persisted entity as one GeoJSON
`FeatureCollection` per layer (road segments, navigable nodes, blocks, buildings, POIs, area
features); the spatial-query endpoints (`/nearby`, `/within-bbox`, `/nearest`,
`/buildings/{id}/footprint-area`) are scoped the same way, to one completed import area.

## Running the client

The client lives in `client/` (Node 22+). Its dev server forwards `/api/*` to the API on
`APP_PORT` from `server/.env`, so start the API first, in its own terminal:

```bash
cd server && source .venv/bin/activate && set -a && source .env && set +a
uvicorn app.main:app --port "$APP_PORT"
```

Then, in another terminal:

```bash
cd client
npm install        # first time only
npm run dev        # http://localhost:55173 (CLIENT_PORT in client/.env to change it)
```

The client has real paths (`/`, `/locations`, `/explore/<area id>`), so any path must serve
`index.html`. Vite's dev and preview servers already do (single-page-app mode). A static host
for `client/dist/` needs the same fallback rule, or a pasted or reloaded explore URL is a 404.

The header shows whether the API is reachable. `npm test` runs the client's unit tests, and
`npm run build` type-checks and bundles it into `client/dist/`.

## Stopping everything

```bash
./scripts/dev-down.sh              # stop the database container, keep its data
./scripts/dev-down.sh --volumes    # also delete the database's data volume
./scripts/dev-down.sh --colima     # also stop Colima itself (affects other projects using it too)
```
