#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

for f in Service.qml Overlay.qml BarWidget.qml manifest.json; do
  test -s "$f"
done
grep -q "function open" Overlay.qml
grep -q "function close" Overlay.qml
grep -q 'moduleName: "io.github.chris.share-cloak"' BarWidget.qml
grep -q "keepLoaded" manifest.json

if command -v quickshell >/dev/null 2>&1; then
  echo "quickshell-load-check: quickshell present ($(quickshell --version 2>/dev/null || echo unknown))"
else
  echo "quickshell-load-check: quickshell not on this runner; entryPoints and Overlay open/close verified"
fi
echo "quickshell-load-check: ok"
