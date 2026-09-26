# AGENTS.md

Conventions for anyone — human or agent — working in this repository.

## Project shape

This is a monorepo: `server/` (Python backend) and, eventually, `client/` (web map viewer) live
as siblings at the repo root. `docker-compose.yml` at the root orchestrates shared services (the
database today; possibly more once `client/` exists) rather than belonging to either side.

- `docs/architecture.md` — the domain model and system boundaries. Read this before adding
  anything that touches persistence, ingestion, the graph, or routing.
- `docs/schema.md` — the persistence schema design (ER diagrams, enums, constraints). Keep it in
  sync with the actual Alembic migrations; it's design intent, not generated from the DB.
- `MILESTONES.md` — the progressive delivery plan. Work is scoped to one milestone at a time;
  don't pull in a later milestone's concerns early just because the scaffolding exists.
- `server/app/domain/` — framework-agnostic domain value objects and entities. No FastAPI,
  SQLAlchemy, or OSM types leak in here.
- `server/app/config/` — environment-based settings and database engine setup.
- `server/app/api/` — HTTP layer (FastAPI). Thin; delegates to domain/repositories.
- `server/alembic/` — migrations. `server/alembic/env.py` reads `DATABASE_URL` from the
  environment; the connection string is never hardcoded in `alembic.ini`.
- `server/tests/` — mirrors the `server/app/` layout.

## Runtime

Python 3.12, plain `venv` + `requirements.txt` (no Poetry/pyenv).

- `./scripts/dev-up.sh` — brings up the container runtime, PostGIS, venv, `.env`, and migrations
  in one idempotent step. Safe to re-run any time.
- `./scripts/dev-down.sh` — tears the docker compose stack back down (`--volumes` to also delete
  PostGIS data, `--colima` to also stop Colima, which affects other projects using it too).

PostGIS and the app server run on non-default ports (`55432`, and `APP_PORT` from `.env`, default
`58000`) to avoid colliding with another local project — don't hardcode `5432`/`5433`/`8000`
elsewhere. See `HOW_TO_RUN.md` for the full setup and what to do in your shell afterward.

## Status

This project is intentionally incomplete. Through Milestone 7, it has domain persistence, OSM
fixture ingestion (with automatic block derivation and reconciling re-import), spatial queries,
road graph traversal, routing, and a full HTTP API in front of all of it. Milestones 7.1, 7.2, 8,
and 9 onward — street/lane modeling, buildable blocks, custom traced boundaries, live OSM
retrieval and visualization, and the generated-content milestones — remain unbuilt. Don't pull
those in prematurely; see `MILESTONES.md` for current status and what's next.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Run tests before committing: `pytest -q` (see `HOW_TO_RUN.md` for environment setup).
  `.github/workflows/ci.yml` runs the same tests plus `openspec validate --all --strict` against a
  fresh PostGIS on every push/PR to `main` — it's a safety net, not a substitute for running tests
  locally first.
- Domain code (`server/app/domain/`) must stay importable and testable without a database
  connection.
- New database access goes through SQLAlchemy/GeoAlchemy2, with schema changes made through an
  Alembic migration — never hand-edit the schema.

## Backlog and issues

GitHub Issues are the backlog, and they are part of every change — not bookkeeping done afterward.

- **`MILESTONES.md`** is the roadmap: why each milestone exists, its deliverables, acceptance checks,
  and order. It does not track individual items.
- **GitHub Issues**, each assigned to the GitHub milestone it belongs to (`7.1 Street
  cross-sections`, `9 Visualization and live OSM`, …), are every actionable item: milestone
  deliverables, bugs, chores, docs. Housekeeping that belongs to no milestone has none.
- **OpenSpec changes** are created only when a milestone or large issue actually starts, and are
  linked from that issue. Small fixes need an issue, not a proposal.

`gh` must run as the personal account: prefix every call with
`GH_TOKEN=$(gh auth token --user josuecm13)` (see `../AGENTS.md`). The `/issues:next`,
`/issues:new`, and `/issues:validate` commands in `.claude/commands/issues/` run the steps below.

### The cycle

1. **Pick.** Before starting work, check the open issues for the current milestone
   (`gh issue list --milestone "<title>"`) and work from one. If the work has no issue, file one
   first. A milestone's tracking issue is split into one issue per deliverable when the milestone
   starts.
2. **Validate.** An issue is a claim about the code at the time it was written. Before planning on
   it, re-check its load-bearing claims (file/line references, "X is missing", "Y fails") against
   the current source. If it's already fixed, close it with a comment saying where; if it's
   partly stale, comment with what changed before starting.
3. **Branch.** Name the branch `<type>/<issue-number>-<slug>`, e.g. `feat/13-stable-block-ids`.
4. **Work.** Stay inside the issue. Anything else found along the way — a bug next door, a stale
   doc, a missing guard — is not fixed in this branch; it becomes its own issue (step 5) and, if
   related, is mentioned in a comment on the current one. Never let a finding silently disappear:
   if it isn't worth an issue, say so explicitly.
5. **File.** New issues use the format below. Agents draft the issue (title, labels, milestone,
   body) and create it once the user confirms; the user may waive confirmation for a session.
6. **Close.** The PR description carries `Fixes #<n>` for each issue it resolves, so merging
   closes them. When a milestone's last issue closes, update that milestone's status and
   completion note in `MILESTONES.md` and close the GitHub milestone.

### Issue format

Title: `[area] <problem or outcome>`, where area is one of `api`, `ingestion`, `domain`, `blocks`,
`routing`, `persistence`, `client`, `docs`, `chore`, `test`, or `milestone` (tracking issues only).

Labels: exactly one of `bug`, `enhancement`, `documentation`, `chore`.

Body:

```
<one paragraph: the problem as currently understood, stated plainly>

### Acceptance criteria
- <observable, testable outcomes>

### Reference
<file:line, MILESTONES.md section, related issue or PR>
```

State the current understanding, not how it was discovered; the discovery context belongs in a
comment or in the linked issue.
