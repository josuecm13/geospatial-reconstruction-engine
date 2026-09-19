#!/usr/bin/env bash
# Brings up everything needed for local backend development in one command:
# container runtime -> PostGIS -> venv -> env vars -> migrations.
#
# Usage: scripts/dev-up.sh
# Then:  cd server && source .venv/bin/activate && set -a && source .env && set +a && pytest -q

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_dir="$repo_root/server"

echo "==> Checking container runtime"
if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    echo "    docker daemon not reachable; starting colima"
    colima start
  else
    echo "error: docker daemon is not running and colima is not installed." >&2
    echo "       start Docker Desktop, or 'brew install colima docker docker-compose' and re-run." >&2
    exit 1
  fi
fi

echo "==> Starting PostGIS (docker compose)"
(cd "$repo_root" && docker compose up -d --wait)

echo "==> Ensuring server virtualenv"
if [ ! -d "$server_dir/.venv" ]; then
  (cd "$server_dir" && python3.12 -m venv .venv)
fi
# shellcheck disable=SC1091
source "$server_dir/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$server_dir/requirements.txt"

echo "==> Configuring environment"
if [ ! -f "$server_dir/.env" ]; then
  cp "$server_dir/.env.example" "$server_dir/.env"
fi
set -a
# shellcheck disable=SC1091
source "$server_dir/.env"
set +a

echo "==> Running migrations"
(cd "$server_dir" && alembic upgrade head)

echo "==> Ready. In this shell: cd server && source .venv/bin/activate && set -a && source .env && set +a"
