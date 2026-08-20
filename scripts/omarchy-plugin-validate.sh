#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin validate .
else
  node "$ROOT/scripts/validate-manifest.js"
fi
