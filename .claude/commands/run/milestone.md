---
name: "Run: Milestone"
description: "Kick off a milestone: its issues, one OpenSpec change, and the branch layout"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(openspec:*)
category: "Workflow"
tags: ["workflow", "milestone", "openspec"]
---

Start a milestone per AGENTS.md → "The cycle", step 1.

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

**Input**: the tracking issue number, or the milestone title.

1. **Issues.** Read the tracking issue (why, deliverables, acceptance checks, open questions)
   and its sub-issues. For any deliverable without an issue, draft one with `/issues:new`. Create it only
   if the run authorizes filing; otherwise put the draft under the ledger's `Tangents`.
2. **One OpenSpec change** for the whole milestone via `openspec-propose` — not one per issue. It
   uses the project schema (`openspec/schemas/milestone-driven/`): the proposal links to the
   milestone section and tracking issue, the design records the decisions the issues leave open,
   and `tasks.md` has one checkbox per issue number, so `/run:ship` ticks one issue at a time.
   Comment the change path on the tracking issue.
3. **Branch layout.** One branch per issue, `<type>/<n>-<slug>`.
   - From `main` by default.
   - Stacked on another issue's branch **only** when GitHub records a "blocked by" between them;
     the PR's base is then the blocker's branch.
   - The milestone's OpenSpec change lands with the first issue's PR, so any later issue that
     edits the change's artifacts (ticking its tasks, its specs) stacks on the branch that
     introduces it. In practice a milestone's issues form one linear stack in plan order.
   - Overlapping *code* alone is not a reason to stack — order the work instead.
   Write the layout and the change name into the ledger `Plan`.
