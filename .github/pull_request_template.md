## Summary

<!-- What this changes and why. Name the milestone (see MILESTONES.md) and the OpenSpec change, if any. -->

## Changes

<!-- Grouped by area (API, ingestion, persistence, routing, docs, specs). Bullets, not a file list. -->

-

## Out of scope

<!-- Later-milestone concerns or known follow-ups deliberately left out, and where they are recorded. -->

## Verification

- [ ] `pytest -q` from `server/` against live PostGIS: <!-- before → after counts -->
- [ ] `openspec validate --all --strict`
- [ ] New guard/regression tests mutation-checked (broke the protected code, saw red, restored, saw green)
- [ ] Schema changes go through an Alembic migration, and `docs/schema.md` is updated to match
- [ ] `docs/architecture.md`, `MILESTONES.md`, `HOW_TO_RUN.md` updated if behavior or setup changed

## Commits

<!-- `sha` — one line per commit -->
