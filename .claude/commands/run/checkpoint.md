---
name: "Run: Checkpoint"
description: "Report where an autonomous run stands, from its ledger — the red-light report"
allowed-tools: Bash(git:*), Bash(gh:*)
category: "Workflow"
tags: ["workflow", "autonomous"]
---

Read-only. Render `.claude/run/ledger.md` into a short report; don't start or finish any work.

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

1. If the working tree is dirty, say which issue's branch it's on and whether the work is committed.
   Don't commit or stash it.
2. Report, in this order and leaving out empty sections:
   - **Shipped**: issue → PR link, one line each.
   - **In flight**: the `Now` line and the exact next step.
   - **Remaining**: the rest of `Plan`, in order.
   - **Blocked**: each item, and the answer that would unblock it.
   - **Tangents**: each draft, and whether it's filed or waiting for approval to file.
   - **Decisions**: design calls made without the user.
   - **Guard checks**: count, and any test that failed to go red.
3. End with how to resume: `/run:start <same scope>` picks up from `Now`.
