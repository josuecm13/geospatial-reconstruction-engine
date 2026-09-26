---
name: "Issues: Next"
description: "Pick the next issue to work on, validate it against the code, and set up its branch"
allowed-tools: Bash(gh:*), Bash(git:*)
category: "Workflow"
tags: ["workflow", "issues", "backlog"]
---

Pick up an issue following the cycle in AGENTS.md → "Backlog and issues".

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

**Input**: an optional issue number or milestone title after `/issues:next`.

1. **Choose.**
   - Given an issue number, use it.
   - Otherwise find the current milestone: the lowest-numbered GitHub milestone with open issues
     that `MILESTONES.md` doesn't mark complete. List its open issues
     (`gh issue list --milestone "<title>" --state open`) plus open issues with no milestone.
     Recommend one with a one-line reason (dependency order first: e.g. 7.2's buildable area
     needs 7.1's street widths), and let the user choose.
2. **Read it.** `gh issue view <n> --comments`.
3. **Validate** (same checks as `/issues:validate` for one issue). Re-check each load-bearing claim
   against the current source. Report which claims still hold. If the issue is already resolved,
   stop and offer to close it with a comment pointing to where it was fixed.
4. **Check scope.** Confirm the issue belongs to the current milestone. If it pulls in a later
   milestone's concerns, say so before starting.
5. **Branch.** From an up-to-date `main`, create `<type>/<n>-<slug>` (type from the label:
   `bug` → `fix`, `enhancement` → `feat`, `documentation` → `docs`, `chore` → `chore`).
6. **Summarize** the plan: acceptance criteria to meet, files likely touched, tests to add, and
   whether an OpenSpec change is warranted (milestone deliverables and large issues: yes; small
   fixes: no).

Don't start implementing until the user confirms the plan.
