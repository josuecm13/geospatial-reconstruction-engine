---
name: "Run: Ship"
description: "Close out one issue: gate, scope check, docs, commit, PR"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pytest:*), Bash(openspec:*)
category: "Workflow"
tags: ["workflow", "issues", "pr"]
---

Finish the issue on the current branch per AGENTS.md → "The cycle", step 6.

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

1. **Gate, once.** `cd server && pytest -q`, then `openspec validate --all --strict` from the repo
   root. Red → fix, or mark the issue `blocked(<failure>)` in the ledger. Never commit red. Note the
   before → after test counts.
   - Decide on each tool's **own** exit status, in its own command: `pytest -q > /tmp/pytest.out;
     echo $?`. Never chain `commit` after `pytest … | tail` — the pipe reports `tail`'s success.
   - Tests share the dev database and expect it empty. Any end-to-end check against a running
     server comes **before** the gate and deletes what it imported; if the gate then fails on
     leftover rows rather than on code, clean up and rerun rather than debugging the code.
2. **Guards.** Every new guard or regression test has a ledger `Guard checks` line from
   `/run:guard`. Missing → run it now.
3. **Scope.** Read `git diff main...` (or the stack base). Every hunk must serve an acceptance
   criterion; anything else is reverted and logged under `Tangents`.
4. **Docs.** Update what the change made stale: `docs/architecture.md`, `docs/schema.md` (must
   match migrations), `MILESTONES.md` status when it's the milestone's last issue, and this
   issue's task checkboxes in the OpenSpec change.
5. **Commit** in Conventional Commits form with the attribution trailer. Push with `-u`.
   - When this issue ticks the OpenSpec change's **last** task, archive it in this PR, as its own
     commit: `openspec archive <change> --yes`, replace the `TBD` Purpose of any newly created spec
     with a real one, rerun `openspec validate --all --strict`, and commit
     `spec: archive <change>`. For a milestone stack, that's the last PR.
6. **PR** from `.github/pull_request_template.md`, base per the ledger's branch layout:
   - Summary: milestone, OpenSpec change, and the ledger `Decisions` for this issue.
   - `Fixes #<n>`.
   - Out of scope: this issue's tangents, with filed numbers or "drafted, not filed".
   - Verification: test counts, `openspec validate`, and the guard checks.
7. **Record.** Comment the PR link on the milestone's tracking issue. Set the ledger status to
   `PR #x` and advance `Now`. Leave `in-progress` on — merging is the user's call.
