# How to run it

This project is a work-in-progress (see `MILESTONES.md` for status). You can run the FastAPI
application backed by a local PostGIS database, apply migrations, run the test suite, and call the
HTTP API to import a fixture area, query it, and plan a route.

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

## Stopping everything

```bash
./scripts/dev-down.sh              # stop the database container, keep its data
./scripts/dev-down.sh --volumes    # also delete the database's data volume
./scripts/dev-down.sh --colima     # also stop Colima itself (affects other projects using it too)
```
