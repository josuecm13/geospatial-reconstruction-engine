---
name: "Run: Start"
description: "Autonomously work a set of issues end to end — validate, implement, ship — until done or told to stop"
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pytest:*), Bash(openspec:*)
category: "Workflow"
tags: ["workflow", "issues", "autonomous"]
---

Drive the cycle in AGENTS.md → "Backlog and issues" over several issues without stopping for
per-step confirmation. Starting the run *is* the confirmation.

Prefix every `gh` call with `GH_TOKEN=$(gh auth token --user josuecm13)`.

**Input**: a milestone (`7.1`), issue numbers (`9 10 8`), or nothing (`next`).

## The ledger

`.claude/run/ledger.md` (gitignored) is the run's only state. Update it at **every** transition,
not at the end — the user can stop the run at any moment and `/run:checkpoint` renders whatever is
there. If a ledger exists with the same scope, resume from its `Now` line instead of starting over.

```
# Run <date> — scope: <…> — authorizations: open PRs yes | file issues no | merge never
## Plan          ordered issues, branch layout, OpenSpec change
## Status        #n <todo|validating|implementing|shipping|PR #x|blocked(<why>)|dropped(<why>)>
## Now           the step in progress, and the next one — enough to resume cold
## Guard checks  <test> — broke <what> — red ✓/✗ — green ✓/✗
## Tangents      <what, where, why> → draft: <title> / <label> / <milestone> → filed #n | not worth an issue: <why>
## Decisions     <design call made without the user> — <one-line reason>
```

Authorizations default as shown; only the user widens them (e.g. "you may file issues").

## Steps

1. **Scope.** With a milestone, take its tracking issue's open sub-issues in order. With nothing,
   apply `/issues:next` step 1 and extend to the rest of that milestone's sub-issues. Tracking
   issues are never in scope. Write the ledger header and `Plan`.
2. **Validate in batch**, once, before any branch exists (the `/issues:validate` checks, one pass
   over the code for all issues). Resolved → `dropped`, with a closing comment offered as a
   tangent. Partly stale → comment on the issue with what changed, then proceed.
3. **Kick off.** If the scope starts a milestone (no OpenSpec change for it yet), run
   `/run:milestone`. Otherwise record the branch layout by its rule.
4. **Loop** over `Plan` in order:
   1. `/issues:next <n>` steps 2–5, skipping its confirmation stop.
   2. Implement within the acceptance criteria. Every finding outside them goes to `Tangents`
      immediately, and the work continues.
   3. Each new guard or regression test → `/run:guard`.
   4. `/run:ship`.
5. **Stop** when:
   - the user says stop (red light) → `/run:checkpoint`, nothing else;
   - the scope is done → `/run:checkpoint`;
   - a decision genuinely belongs to the user → mark `blocked(<question>)` and continue with the
     next issue that doesn't depend on it. Everything else is a `Decisions` line, not a stop.

## Budget

- Read each file once per issue; use `grep -n` and `sed -n` ranges, not whole files.
- An Explore agent only when the location of the code is genuinely unknown.
- Delegate by `CLAUDE.md`'s model rule: `haiku` for docs and mechanical edits, `sonnet` for code and
  tests, never `opus` to implement; at most two subagents at once.
- Pure logic: table-driven unit tests. The new DB/API path: one integration test per issue.
- While iterating, run only the targeted test file; the full suite runs once, in `/run:ship`.
- Don't re-validate what step 2 validated unless the code under it changed.
