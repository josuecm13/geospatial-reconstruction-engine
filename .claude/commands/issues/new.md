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
   - Its place in the plan: which sub-issue of the milestone's tracking issue it goes after, and
     any real blockers ("blocked by #n"), including in other milestones. Also say if it blocks an
     existing issue. Suggest `priority:urgent` only for things like data loss or a broken `main`.
4. **Show the draft** and create it only after the user confirms (unless they've waived
   confirmation for this session):
   `gh issue create --title ... --label ... --milestone ... --body ...`
5. **Place it.** With a milestone, add it as a sub-issue of that milestone's tracking issue
   (`gh api -X POST repos/{owner}/{repo}/issues/<tracking>/sub_issues -F sub_issue_id=<issue id>`),
   and move it to its agreed position
   (`gh api -X PATCH repos/{owner}/{repo}/issues/<tracking>/sub_issues/priority -F sub_issue_id=<id> -F after_id=<id>`).
   Add each blocker (`gh api -X POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=<blocker id>`).
   These endpoints take the issue's `id`, not its number (`gh api repos/{owner}/{repo}/issues/<n> --jq .id`).
6. **Link it.** If it was found while working another issue, comment on that issue with a link.
   Report the new issue number and URL.
