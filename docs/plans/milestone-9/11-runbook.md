# 11 — Runbook and walkthrough for a real import (#70)

## Goal

Two documents that take someone from a clean checkout to exploring a real place in 3D and exporting it.

Read the issue: `GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 70`.

## Depends on

Everything else in this plan. Write it last, against the code as it actually landed: read each
brief's `## Outcome` first.

## Deliverables

1. `docs/runbook.md`, operational and terse. Each step is a command plus what success looks like:
   - prerequisites (Docker or Colima, Python 3.12, Node per `client/package.json`'s engines, or the CI version);
   - `./scripts/dev-up.sh` (services, venv, `.env`, migrations), and what it prints when healthy;
   - starting the API (`uvicorn app.main:app --port "$APP_PORT"` from `server/`, as in `HOW_TO_RUN.md`)
     and the client (`npm install && npm run dev` in `client/`), and the URLs;
   - importing a real area live from the UI, **and** with curl (synchronous, and background plus
     `curl -N …/events` to watch the stream);
   - querying (`GET /import-areas`, `/map-data`, one spatial query), routing (one `POST …/routes`
     curl), and exporting glTF (the UI button);
   - troubleshooting: Overpass busy (`upstream_unavailable`), an incomplete response
     (`source_incomplete`), ports in use, `DEBUG_ERRORS` (brief 04) for seeing the server's reason,
     and the benchmark script (brief 01);
   - teardown (`./scripts/dev-down.sh`, and its flags).
2. `docs/walkthrough.md`, narrative. One real area of ≤ 1 km². Use the Berlin Mitte rectangle from
   brief 01 (`13.3930821,52.526332 → 13.4090037,52.5344644`), or a smaller one if the import is still
   slow. Sections: pick the area on the 2D map → watch the staged build → fly over it → walk a street
   → trace a boundary and scope to it → route between two points → export and open in Blender.
   **Screenshots** go in `docs/walkthrough/` as PNGs: the 2D picker, the build animation mid-way,
   flying, walking, and the `.glb` in Blender.
   - An agent can't take these reliably. Put a placeholder line where each image goes:
     `![2D picker](walkthrough/01-picker.png) <!-- TODO(screenshot): … -->`, describing exactly what to
     capture. List them in the PR description as a human checklist.
3. `HOW_TO_RUN.md` and `README.md`: one line each, pointing to both documents.

## Verification

Follow the runbook from a fresh clone, in a temporary directory, as far as you can without a browser:
services up, migrations, the API answering `/health`, the client dev server serving `index.html`, and
a curl import of a small fixture via `payload`. Record which steps you verified under Outcome.
**Don't** run a live Overpass import more than once (fair use).

## Docs and specs

- `tasks.md`: tick `1.19 #70`.

## Outcome

## Tangents found
