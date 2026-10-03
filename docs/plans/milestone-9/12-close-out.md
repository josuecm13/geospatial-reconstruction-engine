# 12 — Close out Milestone 9 (#27)

Run only after briefs 01–11 are done (their `## Outcome` sections are filled in) and CI is green.

## Steps

1. **Collect tangents.** Gather every brief's `## Tangents found` lines into one list, and draft an
   issue for each in the house format (`AGENTS.md` → Issue format). **Don't file them.** Put the drafts
   in the PR description under "Out of scope: drafted, not filed". The user confirms before anything
   is created. Also include brief 03's issue draft if it hasn't been filed yet.
2. **MILESTONES.md** → Milestone 9: set the status to complete, and write a completion note in the
   same style as earlier milestones' notes (what shipped, the key decisions with a pointer to
   `design.md`, and anything deferred).
3. **OpenSpec.** Fold the briefs' decisions that matter for the future into
   `openspec/changes/add-live-import-and-showcase-client/design.md` (the background job registry,
   single-transaction stages, rings, the World contract, the strategy probe, and brief 03's chosen
   option). Tick `1.20` in `tasks.md`. Then archive the change in its own commit:
   `openspec archive add-live-import-and-showcase-client --yes`. Replace the `TBD` Purpose of any newly
   created living spec (`openspec/specs/showcase-client/spec.md`, `openspec/specs/live-osm-import/spec.md`)
   with a real one-paragraph purpose. Commit as `spec: archive add-live-import-and-showcase-client`.
   (Running `openspec validate` locally is not allowed: CI checks it.)
4. **AGENTS.md** → Status: Milestone 9 is built. The next milestones are 11 and 12.
5. **Delete `docs/plans/milestone-9/`** in its own commit (`chore: remove the Milestone 9 delegation briefs`).
   Its useful content now lives in `design.md`, the specs, and the PR.
6. **PR description**: update the "Status" table (every row done, with its commit sha), and fill in
   Verification from CI's results.
7. **Don't merge, and don't close issues or milestones by hand.** The PR's `Fixes` lines close the
   issues when the user merges. After the merge (the user's call), the tracking issue #27 and the
   GitHub milestone get closed. Leave a note for that in the PR.

## Outcome
