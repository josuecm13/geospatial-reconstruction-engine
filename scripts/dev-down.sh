#!/usr/bin/env bash
# Tears down what scripts/dev-up.sh brought up: the docker compose services for
# this project, and optionally their data volume and Colima itself.
#
# Usage: scripts/dev-down.sh [--volumes] [--colima]
#   --volumes  also delete the PostGIS data volume (destructive: loses local data)
#   --colima   also stop Colima (shared across any other project using it)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

remove_volumes=false
stop_colima=false
for arg in "$@"; do
  case "$arg" in
    --volumes) remove_volumes=true ;;
    --colima) stop_colima=true ;;
    *)
      echo "error: unknown argument '$arg' (expected --volumes and/or --colima)" >&2
      exit 1
      ;;
  esac
done

echo "==> Stopping this project's docker compose services"
if [ "$remove_volumes" = true ]; then
  echo "    (--volumes: also deleting the PostGIS data volume)"
  (cd "$repo_root" && docker compose down --volumes)
else
  (cd "$repo_root" && docker compose down)
fi

if [ "$stop_colima" = true ]; then
  if command -v colima >/dev/null 2>&1; then
    echo "==> Stopping colima (this affects any other project using it)"
    colima stop
  else
    echo "note: --colima given but colima is not installed; nothing to stop" >&2
  fi
fi

echo "==> Done."
