#!/bin/sh
# Loads the plugin under Quickshell when the binary exists. Does not fake a
# pass: missing Quickshell is a skip (exit 0) for this helper; CI does not
# advertise this as a required Ubuntu job.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! command -v quickshell >/dev/null 2>&1; then
  echo "quickshell-load-check: SKIP (quickshell not on PATH)"
  exit 0
fi

SMOKE="$ROOT/tests/qs-smoke"
if [ ! -f "$SMOKE/shell.qml" ]; then
  echo "quickshell-load-check: missing tests/qs-smoke/shell.qml"
  exit 1
fi

export QML2_IMPORT_PATH="${QML2_IMPORT_PATH:-}:$ROOT/tests/qml-stubs"
timeout 8 quickshell -p "$SMOKE" || {
  echo "quickshell-load-check: plugin load failed"
  exit 1
}
echo "quickshell-load-check: loaded"
