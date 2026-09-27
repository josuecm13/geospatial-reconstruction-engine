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

1. **Choose.** Given an issue number, use it. Otherwise apply AGENTS.md → "Picking the next
   issue" exactly, taking the first match:
   1. Resume: `gh issue list --label in-progress --state open`, open PRs (`gh pr list`), and local
      or remote branches matching `*/<n>-*` for an open issue.
   2. Urgent: `gh issue list --label priority:urgent --state open`.
   3. Plan: find the current milestone, the lowest open GitHub milestone with open issues,
      comparing the leading numbers of titles as versions (7.1 < 7.2 < 8 < 10). Read its tracking
      issue's sub-issues in order
      (`gh api repos/{owner}/{repo}/issues/<tracking>/sub_issues`), and take the first open one
      whose blockers
      (`gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`) are all closed.
   4. Housekeeping: open issues with no milestone, only if nothing above matched or the user asked.

   State the pick and the step that chose it, and list the next one or two candidates so the user
   can override. If the current milestone has no tracking issue, or nothing is unblocked, say so
   and stop.
2. **Read it.** `gh issue view <n> --comments`.
3. **Validate** (same checks as `/issues:validate` for one issue). Re-check each load-bearing claim
   against the current source. Report which claims still hold. If the issue is already resolved,
   stop and offer to close it with a comment pointing to where it was fixed.
4. **Check scope.** Confirm the issue belongs to the current milestone. If it pulls in a later
   milestone's concerns, say so before starting.
5. **Branch and mark.** From an up-to-date `main`, create `<type>/<n>-<slug>` (type from the
   label: `bug` → `fix`, `enhancement` → `feat`, `documentation` → `docs`, `chore` → `chore`),
   and add the `in-progress` label to the issue. Skip both when resuming.
6. **Summarize** the plan: acceptance criteria to meet, files likely touched, tests to add, and
   whether an OpenSpec change is warranted (milestone deliverables and large issues: yes; small
   fixes: no).

Don't start implementing until the user confirms the plan. Inside `/run:start`, skip this stop:
the run is the confirmation.
