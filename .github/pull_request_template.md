## Summary

<!-- What this changes and why. Name the milestone (its tracking issue) and the OpenSpec change, if any. -->

Fixes #<!-- issue number; one line per issue this PR resolves -->

## Changes

<!-- Grouped by area (API, ingestion, persistence, routing, docs, specs). Bullets, not a file list. -->

-

## Out of scope

<!-- Later-milestone concerns or findings deliberately left out, each with the issue it was filed as. -->

## Verification

- [ ] `pytest -q` from `server/` against live PostGIS: <!-- before → after counts -->
- [ ] `openspec validate --all --strict`
- [ ] New guard/regression tests mutation-checked (broke the protected code, saw red, restored, saw green)
- [ ] Schema changes go through an Alembic migration, and `docs/schema.md` is updated to match
- [ ] `docs/architecture.md`, `HOW_TO_RUN.md` updated if behavior or setup changed; `MILESTONES.md` row if a milestone completed

## Commits

<!-- `sha` — one line per commit -->
