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

Also check milestone state: if a GitHub milestone has no open issues left, flag that its
`MILESTONES.md` status and completion note need updating.
