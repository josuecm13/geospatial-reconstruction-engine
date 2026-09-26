---
name: "Issues: New"
description: "Draft a backlog issue in the house format and create it on confirmation"
allowed-tools: Bash(gh:*)
category: "Workflow"
tags: ["workflow", "issues", "backlog"]
---

File an issue following AGENTS.md → "Backlog and issues" → "Issue format".

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

**Input**: a description of the problem or work after `/issues:new`. With no input, use the
findings logged earlier in this session that haven't been filed yet.

1. **Check for duplicates.** `gh issue list --state all --search "<keywords>"`. If an issue
   already covers it, show it and offer to comment there instead.
2. **Confirm the problem.** Read the code the issue will reference, and cite real `file:line`
   locations. Don't file a claim you haven't confirmed against the source.
3. **Draft**:
   - Title `[area] <problem or outcome>`.
   - Exactly one label: `bug`, `enhancement`, `documentation`, or `chore`.
   - A milestone: the GitHub milestone whose `MILESTONES.md` scope it belongs to, or none for
     housekeeping. Say why.
   - A body with the problem paragraph, `### Acceptance criteria`, and `### Reference`.
4. **Show the draft** and create it only after the user confirms (unless they've waived
   confirmation for this session):
   `gh issue create --title ... --label ... --milestone ... --body ...`
5. **Link it.** If it was found while working another issue, comment on that issue with a link.
   Report the new issue number and URL.
