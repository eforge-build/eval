#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DB="$SCRIPT_DIR/results/monitor.db"
EFORGE_BIN="${EFORGE_BIN:-eforge}"

if ! command -v "$EFORGE_BIN" >/dev/null 2>&1; then
  echo "Error: eforge not found. Install eforge or set EFORGE_BIN."
  exit 1
fi

export EFORGE_MONITOR_DB="$RESULTS_DB"

exec "$EFORGE_BIN" monitor "$@"
