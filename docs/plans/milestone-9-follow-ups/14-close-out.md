# 14 — Close out the Milestone 9 follow-ups

Run only after briefs 01–13 are done (their `## Outcome` sections are filled in) and CI is green.

## Steps

1. **Collect tangents.** Gather every brief's `## Tangents found` lines into one list, and draft an
   issue for each in the house format (`AGENTS.md` → Issue format). **Don't file them.** Put the drafts
   in the PR description under "Out of scope: drafted, not filed". The user confirms before anything
   is created. A tangent not worth an issue is listed as such, with the reason.
2. **Specs.** Every living spec a brief edited stays valid in shape (`### Requirement:` with SHALL,
   at least one `#### Scenario:`). Don't run `openspec validate` locally: CI checks it.
3. **Delete `docs/plans/milestone-9-follow-ups/`** in its own commit
   (`chore: remove the Milestone 9 follow-up briefs`). Anything worth keeping from the briefs' design
   sections goes into `docs/architecture.md` or the relevant living spec first, in the brief's own commit.
4. **PR description:** one `Fixes #<n>` line per issue (#107–#119), a short "what changed" per
   brief with its commit sha, Verification from CI's results ("guards not mutation-checked"), and a
   human checklist for what only a browser shows: the scene layers at far and near cameras (#118),
   auto-rotation (#119), the camera after a staged build (#112).
5. **Don't merge.** The `Fixes` lines close the issues when the user merges.

## Outcome

## Tangents found
