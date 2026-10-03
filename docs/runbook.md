# Runbook

From a clean checkout to a real place explored in 3D and exported. Each step is a command and what
success looks like. `HOW_TO_RUN.md` has the longer explanations; `docs/walkthrough.md` is the same
trip as a narrative through the UI.

## 1. Prerequisites

- Docker, or Colima on macOS (`brew install colima docker docker-compose`)
- Python 3.12 (`python3.12 --version`)
- Node 22 (what CI uses; `node --version`)

## 2. Services, venv, `.env`, migrations

```bash
./scripts/dev-up.sh
```

Success: the script ends without an error after Alembic reports it is at head. PostGIS is healthy on
`localhost:55432`, `server/.venv` exists, and `server/.env` exists (copied from `.env.example`).
Safe to re-run.

In each new shell that talks to the server:

```bash
cd server
source .venv/bin/activate
set -a && source .env && set +a
```

## 3. Start the API

```bash
uvicorn app.main:app --port "$APP_PORT"      # from server/; APP_PORT defaults to 58000
```

Success:

```bash
curl localhost:$APP_PORT/health
# {"status":"ok"}
```

## 4. Start the client

In another terminal:

```bash
cd client
npm install        # first time only
npm run dev
```

Success: <http://localhost:55173> shows the landing page, and its header reads **API ok**. Change the
port with `CLIENT_PORT` in `client/.env`. The dev server forwards `/api/*` to the API, so start the
API first.

## 5. Import a real area

Keep it at or under 1 km² and import it once; the public Overpass instance is shared.

**From the UI.** Open `/explore`, press **Draw rectangle**, drag on the map, press **Import from
OpenStreetMap**. The 3D tab builds the place in stages as the server streams them. Success: the status
line reports the import as complete and the area appears under **Imported areas**.

**With curl, synchronous** (one request that returns when the import is done):

```bash
curl -s -X POST localhost:$APP_PORT/import-areas \
  -H 'Content-Type: application/json' \
  -d '{"bbox": {"min_latitude": 52.5285, "min_longitude": 13.3995, "max_latitude": 52.5310, "max_longitude": 13.4035}}'
# {"id": "...", "status": "completed", "road_count": ..., "building_count": ..., "block_count": ...}
```

**With curl, in the background**, watching the stream:

```bash
curl -s -X POST localhost:$APP_PORT/import-areas \
  -H 'Content-Type: application/json' \
  -d '{"background": true, "bbox": {"min_latitude": 52.5285, "min_longitude": 13.3995, "max_latitude": 52.5310, "max_longitude": 13.4035}}'
# 202 {"import_area_id": "...", "events_url": "/import-areas/<id>/events"}

curl -N localhost:$APP_PORT/import-areas/$AREA_ID/events
```

Success: one `event:` per stage, in the order `fetched`, `ground`, `roads`, `blocks`, `buildings`
(several, in rings from the centre), and then `completed` (or `failed`). The stream replays what
the job has published, so connecting late, or reconnecting with `Last-Event-ID`, loses nothing. A
second import of the same box while one is running answers 409.

To try the API without Overpass, send a recorded payload instead (see `HOW_TO_RUN.md`: "Calling the
API", with `server/tests/fixtures/osm_routing.json`).

## 6. Query, route, export

Save the area's `id` as `AREA_ID` (it is in every import response and in `GET /import-areas`).

```bash
curl -s localhost:$APP_PORT/import-areas                      # every area, with its status and counts
curl -s localhost:$APP_PORT/import-areas/$AREA_ID/map-data    # one GeoJSON FeatureCollection per layer
curl -s "localhost:$APP_PORT/import-areas/$AREA_ID/nearby?latitude=52.5297&longitude=13.4015&radius_meters=100&kind=building"
```

```bash
curl -s -X POST localhost:$APP_PORT/import-areas/$AREA_ID/routes \
  -H 'Content-Type: application/json' \
  -d '{"origin": {"latitude": 52.5290, "longitude": 13.4000}, "destination": {"latitude": 52.5305, "longitude": 13.4030}}'
# {"node_ids": [...], "geometry": {"type": "LineString", ...}, "total_distance_meters": ..., "strategy": "distance", ...}
```

Success: a LineString and a distance. The endpoints snap to the nearest road node; the response
says how far each moved. A request with a `strategy` the server doesn't know answers 422
`unknown_routing_strategy`, with `registered_strategies` in its details.

**Export glTF** is a UI action: open the area on `/explore`, switch to the 3D tab, press **Download
glTF**. Success: a `.glb` downloads. Open it in Blender (**File → Import → glTF 2.0**) and the scene
is in meters, y up.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| 503 `upstream_unavailable` | Overpass is busy or down. Wait a minute and retry, or set `OVERPASS_URL` in `server/.env` to another instance. |
| 502 `source_incomplete` | Overpass returned a partial response (timeout or out of memory) and nothing was stored. Retry, or use a smaller box. |
| 409 `import_in_progress` | That box is already importing. Follow its `/events`, or wait. |
| Port already in use | PostGIS is on 55432, the API on `APP_PORT` (58000), the client on 55173. Change `APP_PORT` in `server/.env` or `CLIENT_PORT` in `client/.env`. Don't point anything at 5432, 5433, or 8000. |
| Header says **API unreachable** | The API isn't running, or isn't on the `APP_PORT` the client reads. Start it first and reload. |
| The UI shows a generic error and you want the server's reason | Set `DEBUG_ERRORS = true` in `client/src/errors/errorReporter.ts` (off by default, the same in every build), and the error line then carries the server's message and any OSM references. |
| An import feels slow | Run `PYTHONPATH=. python scripts/benchmark_import.py` from `server/` (with `.env` loaded). It imports a recorded 1 km² Berlin Mitte payload, prints the time per step, and rolls everything back. |
| A pasted or reloaded `/explore/<id>` URL is a 404 | The static host lacks the single-page-app fallback to `index.html`. Vite's dev and preview servers already have it. |

## 8. Teardown

```bash
./scripts/dev-down.sh              # stop the database container, keep its data
./scripts/dev-down.sh --volumes    # also delete the database's data volume
./scripts/dev-down.sh --colima     # also stop Colima itself (affects other projects using it too)
```
