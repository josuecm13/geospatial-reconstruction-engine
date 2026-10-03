# Milestone 9 follow-ups: delegation briefs

This folder holds the plan for the issues filed after Milestone 9 shipped (PR #99): the gaps found
while building it, plus two scene improvements. Each `NN-*.md` file is one self-contained brief,
written so a smaller model can carry it out without the conversation that produced it. Every brief
lands on the branch `fix/107-milestone-9-follow-ups` as **one commit per brief**, and one PR closes
them all.

These issues have no GitHub milestone (Milestone 9 is closed, and none of them is a later
milestone's deliverable). There is no OpenSpec change: these are small fixes, so a brief that
changes observable behavior edits the living spec in `openspec/specs/` directly (`AGENTS.md` →
"Backlog and issues").

Delete this folder in the last brief (`14-close-out.md`). It is a working plan, not documentation.

## Order and dependencies

| # | Brief | Issue | Depends on | Suggested model |
|---|-------|-------|------------|-----------------|
| 01 | [Scene layers stop overlapping](01-scene-layers.md) | #118 | — | Sonnet |
| 02 | [Rotate the scene automatically](02-auto-rotate.md) | #119 | — | Sonnet |
| 03 | [Keep the camera when a staged build ends](03-keep-camera.md) | #112 | 02 (soft: same file) | Sonnet |
| 04 | [Dispose listeners and the stream on leaving explore](04-dispose-on-leave.md) | #113 | 02 (soft: `cameraModes.ts`) | Sonnet |
| 05 | [No popups while tracing](05-no-popups-while-tracing.md) | #114 | — | Haiku |
| 06 | [List routing strategies](06-routing-strategies.md) | #109 | — | Sonnet |
| 07 | [Spatial queries compose nested areas](07-compose-spatial-queries.md) | #108 | — | Opus |
| 08 | [Inner areas' roads drawn once during a staged build](08-roads-stage-once.md) | #110 | 01 (soft: `stagedScene.ts`) | Sonnet |
| 09 | [No duplicate blocks in two-level nesting](09-nested-blocks-once.md) | #111 | — | Opus |
| 10 | [Audit raw-SQL writes followed by ORM reads](10-raw-sql-audit.md) | #115 | — | Sonnet |
| 11 | [Faster feature persistence and turn generation](11-persist-and-turns-perf.md) | #107 | 10 (soft: same repositories) | Opus |
| 12 | [client-features.md matches the code](12-client-features-doc.md) | #116 | 06, 07 (their rows) | Haiku |
| 13 | [Landing copy mentions heights](13-landing-copy.md) | #117 | — | Haiku |
| 14 | [Close-out](14-close-out.md) | — | everything above | Haiku |

Parallelizable: at most **two briefs run at once**. The client briefs (01–05, 08) and the server
briefs (07, 09–11) touch separate trees, so one of each can run side by side; 06 touches both (a
server endpoint, then the client's picker). Within the client, 05 is independent of everything; 01
and 08 both touch `stagedScene.ts`, and 02, 03 and 04 all touch `sceneView.ts` or `cameraModes.ts`,
so run each group in order. Within the server, 07 and 09 both touch nested-area composition, and 10
and 11 both touch the repositories, so run each pair one after the other. Brief 08's issue (#110) was
written as a server fix; the cause is on the client (see the brief).

## Rules every brief follows

Read `AGENTS.md` and `CLAUDE.md` at the repo root first. The points that matter most:

1. **Stay inside the brief.** If you find something outside it (a bug next door, a stale doc), don't
   fix it. Add one line to the brief's `## Tangents found` section: what, where, and why it matters.
   The coordinator turns these into issues.
2. **Validate first.** The brief is a claim about the code when it was written. Re-check its
   load-bearing claims (file and line references, "X is missing") before you build on them. If one
   is wrong, say so under `## Outcome` and adapt.
3. **No local test suites.** Don't run `pytest`, `npm test`, `npm run build`, or `openspec validate`
   locally. CI runs them on the PR. Cheap single-file checks are fine (`npx tsc --noEmit -p client`,
   `python -m py_compile <file>`). Write the tests anyway; CI is the gate. Guard tests can't be
   mutation-checked without local runs, so say "not mutation-checked" rather than claiming it.
4. **`gh` runs as the personal account**: prefix every call with
   `GH_TOKEN=$(gh auth token --user josuecm13)`.
5. **Commit** in Conventional Commits form (`fix:`, `feat:`, `perf:`, `docs:`), with a body that says
   what changed and why, and `Refs #<issue>` (the PR description carries the `Fixes` lines). End with
   `Co-Authored-By: <your model> <noreply@anthropic.com>`. Push to
   `origin fix/107-milestone-9-follow-ups`, then check `gh pr checks` and fix any red check you
   caused before you call the brief done.
6. **Keep docs in step, in the same commit:** the living spec in `openspec/specs/<capability>/spec.md`
   when observable behavior changes (`### Requirement:` with SHALL wording, then at least one
   `#### Scenario:` with WHEN/THEN bullets); the capability's row in `docs/client-features.md`; and
   `docs/architecture.md` or `docs/schema.md` if the brief changes what they describe.
7. **Fill in `## Outcome`** before committing: what you did, the decisions you made that the brief
   left open, what you verified and how, and what you didn't do.
