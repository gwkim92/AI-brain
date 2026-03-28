#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT_DEFAULT=$(CDPATH= cd -- "$BACKEND_DIR/.." && pwd)

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to run the delivery runner." >&2
  exit 1
fi

export RUNNER_ENABLED="${RUNNER_ENABLED:-true}"
export RUNNER_REPO_ROOT="${RUNNER_REPO_ROOT:-$REPO_ROOT_DEFAULT}"
export RUNNER_STALL_TERMINATE_ENABLED="${RUNNER_STALL_TERMINATE_ENABLED:-true}"

cd "$BACKEND_DIR"
exec pnpm runner
