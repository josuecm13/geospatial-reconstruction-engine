# CLAUDE.md

@AGENTS.md

Claude-specific notes:

- The issue workflow in "Backlog and issues" above is part of every task: start from an issue,
  validate it against the current code, and file what you find along the way as new issues.
  Use `/issues:next`, `/issues:new`, and `/issues:validate`. For an autonomous run over several
  issues, use `/run:start`; `/run:checkpoint` reports where it stands whenever the user says stop.
- Your Bash tool is a non-interactive shell, so the direnv hook in `../.envrc` doesn't fire. Always
  prefix `gh` with `GH_TOKEN=$(gh auth token --user josuecm13)`, and check with
  `gh api user --jq .login` (it must print `josuecm13`) before creating anything.
- **Don't run the test suites locally** (`pytest`, `npm test`, `npm run build`, `openspec validate`).
  CI runs them on every PR, and that is the gate: push, open the PR, and wait on
  `gh pr checks`. A red check means fix and push again. This overrides AGENTS.md's "run tests
  before committing", `/run:ship`'s local gate (step 1), and `/run:guard`'s local red/green runs.
  Without local runs a guard test can't be mutation-checked, so a PR says "guards not
  mutation-checked" rather than claiming it. Cheap, single-file checks while editing (a type
  check, a syntax check) are fine.
