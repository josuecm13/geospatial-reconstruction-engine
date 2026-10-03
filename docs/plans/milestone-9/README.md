# Milestone 9 completion plan: delegation briefs

This folder holds the work plan for the rest of Milestone 9 (tracking issue #27, OpenSpec change
`add-live-import-and-showcase-client`). Each `NN-*.md` file is one self-contained brief, written so
a smaller model can carry it out without this conversation. Every brief lands on the same branch,
`feat/27-finish-milestone-9`, as **one commit per brief**, and the one PR closes them all.

Delete this folder in the close-out brief (`12-close-out.md`). It is a working plan, not documentation.

## Order and dependencies

| # | Brief | Issue | Depends on | Suggested model |
|---|-------|-------|------------|-----------------|
| 01 | [Block derivation under 15 s](01-block-derivation-perf.md) | #91 | — | Sonnet |
| 02 | [Staged background import over SSE](02-staged-sse-import.md) | #90 | 01 (soft: faster tests) | Opus |
| 03 | [Skip areas already imported inside the rectangle](03-skip-covered-areas.md) | #100 | 02 | Opus |
| 04 | [Error reporter with the server's reason](04-error-reporter.md) | #88 | — | Haiku |
| 05 | [Trace and manage boundaries](05-boundaries.md) | #64 | 04 | Sonnet |
| 06 | [Low-poly 3D scene from map-data](06-scene.md) | #65 | — | Sonnet |
| 07 | [Fly and walk](07-fly-walk.md) | #66 | 06 | Sonnet |
| 08 | [Staged build animation](08-staged-build.md) | #67 | 02, 06 | Sonnet |
| 09 | [Route between two points](09-route.md) | #68 | 04, 06 | Sonnet |
| 10 | [glTF export](10-gltf-export.md) | #69 | 06 | Sonnet |
| 11 | [Runbook and walkthrough](11-runbook.md) | #70 | everything above | Haiku (prose) + a human for screenshots |
| 12 | [Close-out](12-close-out.md) | #27 | everything above | Haiku |

Parallelizable: **01, 04, 06** have no dependencies and touch disjoint files. After 06 lands,
07, 09 and 10 can run in parallel. 02 → 03 and 02 + 06 → 08 are strict chains.

## Rules every brief follows

Read `AGENTS.md` and `CLAUDE.md` at the repo root first. The points that matter most:

1. **Stay inside the brief.** If you find something outside it (a bug next door, a stale doc),
   don't fix it. Add one line to the brief's `## Tangents found` section at the bottom: what,
   where, and why it matters. The coordinator turns these into issues.
2. **No local test suites.** Don't run `pytest`, `npm test`, `npm run build`, or `openspec validate`
   locally. CI runs them on the PR. Cheap single-file checks are fine (`npx tsc --noEmit -p client`,
   `python -m py_compile <file>`). Write the tests anyway. CI is the gate.
3. **`gh` runs as the personal account**: prefix every call with
   `GH_TOKEN=$(gh auth token --user josuecm13)`.
4. **Commit** in Conventional Commits form (`feat:`, `fix:`, `perf:`, `docs:`), with a body that says
   what changed and why, and `Refs #<issue>` (not `Fixes`: the PR description carries the `Fixes`
   lines). End with:
   ```
   Co-Authored-By: <your model> <noreply@anthropic.com>
   ```
   Push to `origin feat/27-finish-milestone-9`. Then check `gh pr checks` and fix any red check
   you caused before you call the brief done.
5. **Keep docs in step, in the same commit:**
   - tick the issue's box in `openspec/changes/add-live-import-and-showcase-client/tasks.md`;
   - edit that change's spec deltas (`openspec/changes/add-live-import-and-showcase-client/specs/…`)
     when observable behavior changes. Each brief names the requirement to add or modify. Keep the
     format: `### Requirement:` with SHALL wording, then at least one `#### Scenario:` written as
     WHEN/THEN bullets;
   - update the capability's row in `docs/client-features.md` (status, and where it lives in the client);
   - `docs/architecture.md` / `docs/schema.md` when persistence or system boundaries change.
6. **Client conventions** (`client/`): TypeScript, no framework, DOM built by hand like
   `client/src/importing/importPanel.ts`. Pure logic goes in its own module with a `*.test.ts`
   next to it (vitest). Anything needing WebGL or a real map stays out of tests. Errors come from
   `ApiError` (`client/src/api/client.ts`). Switch on `code`, never the HTTP status or the raw message.
7. **Server conventions** (`server/`): domain code in `app/domain/` imports no FastAPI or SQLAlchemy.
   Schema changes only through an Alembic migration. Errors use the envelope in `app/api/errors.py`,
   with a stable `code`. Tests mirror `app/` under `server/tests/`.
8. **Done means**: the acceptance criteria in the brief hold, the tests for them exist, docs are
   updated, the commit is pushed, and CI is green. Then fill in the brief's `## Outcome` section
   (what you did, any decision you made and why, anything left undone) and commit that with the work.
