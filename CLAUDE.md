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
