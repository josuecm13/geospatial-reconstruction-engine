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
- `docs/client-features.md` — every API capability the client must surface, plus a UI brainstorm.
  A PR that adds or changes an API capability updates its row there.
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

This project is intentionally incomplete. Through Milestone 7.2, it has domain persistence, OSM
fixture ingestion (with automatic block derivation and reconciling re-import), spatial queries,
road graph traversal, routing, a full HTTP API in front of all of it, logical streets with
generated cross-sections (lanes, lane type, width), and buildable blocks (buildable area, median
and edge-block flags, stable ids). Milestones 8 and 9 onward — custom traced boundaries, live OSM
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
`/issues:new`, and `/issues:validate` commands in `.claude/commands/issues/` run the steps below;
the `/run:*` commands in `.claude/commands/run/` chain them into an autonomous run over several
issues, with its state in the gitignored `.claude/run/ledger.md`.

### How the order is recorded

The pick order lives in GitHub, not in anyone's head, so every agent picks the same issue:

- **Milestone order**: GitHub milestone titles start with the roadmap number, compared as version
  numbers (7.1 < 7.2 < 8 < 9 < 10 < 11). The current milestone is the lowest one with open issues.
- **Order within a milestone**: each milestone has one tracking issue (`[milestone] … (tracking)`).
  Its **sub-issues, in order, are the plan**. Reorder them in the GitHub UI to change the plan.
- **Dependencies**: GitHub's native "blocked by" relationship, for real prerequisites only
  (e.g. buildable area needs street widths), including across milestones.
- **Labels**: `in-progress` marks an issue that's been started; `priority:urgent` marks one that
  jumps the queue (e.g. data loss).

### Picking the next issue

Take the first match:

1. **Resume**: an open issue labeled `in-progress`, or with an open PR or an existing
   `*/<n>-*` branch.
2. **Urgent**: an open issue labeled `priority:urgent`, in any milestone.
3. **Plan**: in the current milestone's tracking issue, the first open sub-issue whose blockers are
   all closed. Tracking issues themselves are never picked.
4. **Housekeeping**: issues with no milestone are picked only when labeled urgent, when the user
   asks, or when the current milestone has nothing unblocked.

If nothing matches, say so rather than guessing. Always state the pick and the rule that chose it;
the user can override.

### The cycle

1. **Pick** by the rule above. If the work has no issue, file one first. When a milestone starts,
   split its deliverables into one issue each and add them as sub-issues of its tracking issue.
   Add `in-progress` when starting, and remove it if the work is abandoned.
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
   body, where it goes in the milestone's sub-issue order, and any blockers) and create it once
   the user confirms; the user may waive confirmation for a session. An issue with a milestone is
   always added as a sub-issue of that milestone's tracking issue.
6. **Close.** The PR description carries `Fixes #<n>` for each issue it resolves, so merging
   closes them. When a milestone's last sub-issue closes, close its tracking issue and the GitHub
   milestone, and update that milestone's status and completion note in `MILESTONES.md`.

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
