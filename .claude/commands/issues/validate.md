---
name: "Issues: Validate"
description: "Re-check open issues against the current code and flag stale, resolved, or misfiled ones"
allowed-tools: Bash(gh:*), Bash(git:*)
category: "Workflow"
tags: ["workflow", "issues", "backlog", "triage"]
---

Triage the backlog so issues keep describing the code as it is today.

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

**Input**: an optional issue number, milestone title, or `all` after `/issues:validate`. The
default is the current milestone plus issues with no milestone.

For each issue in scope (`gh issue view <n> --comments`):

1. **Re-check its claims** against the current source: do the referenced files and lines still
   exist and say what the issue says? Is the described gap still there? Use `git log` to find
   changes since the issue was opened.
2. **Classify**:
   - **valid**: every claim still holds.
   - **stale**: still needed, but references or details have moved. Draft a comment with the
     corrections.
   - **resolved**: already fixed. Name the commit or PR.
   - **misfiled**: wrong milestone, label, or format per AGENTS.md.
   - **unclear**: can't be confirmed either way. Say what's missing.
3. **Report** a table: issue, classification, evidence (file:line or commit), proposed action.

Then apply the proposed actions (comments, closes with a reason, relabels, milestone moves) only
after the user confirms. Never close an issue on a claim you haven't confirmed in the source.

Also check the plan's structure:

- Every milestoned, non-tracking issue is a sub-issue of its milestone's tracking issue, and each
  milestone has exactly one tracking issue.
- Blockers still make sense: flag closed blockers that no longer matter and dependencies the
  issue text mentions but GitHub doesn't record.
- `in-progress` labels are live: flag any with no branch, PR, or activity in the last 14 days.
- If a milestone has no open sub-issues left, flag that its tracking issue (with its completion note), GitHub
  milestone, and `MILESTONES.md` row need closing out.
