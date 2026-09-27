---
name: "Run: Guard"
description: "Mutation-check a guard or regression test: break the code, see red, restore, see green"
allowed-tools: Bash(git:*), Bash(pytest:*)
category: "Workflow"
tags: ["workflow", "testing"]
---

A guard test counts only once it has failed. Run this for every test written to enforce an
invariant: an acceptance criterion, a regression, or an assertion over config or structure.

**Input**: the test id (`tests/domain/test_x.py::test_y`).

1. **Name the break.** State the invariant and the smallest edit to **production code** that
   violates it. Never edit the test itself.
2. **Red.** Apply it and run only that test. It must fail on its assertion. An import error or
   fixture crash doesn't count; pick a better break.
3. **Green.** Restore (`git checkout -- <file>` if the file had no other unstaged work, else the
   reverse edit), rerun, and confirm the pass. Check `git diff` shows no leftover of the break.
4. **Record** a ledger `Guard checks` line: test — broke what — red ✓ — green ✓.

If the test stays green under the break, it's rewritten before it counts. Say so in the ledger.
