#!/bin/sh
# Strict QML gate. Structure check always runs. Real qmllint is required in
# CI (and whenever SHARE_CLOAK_QMLLINT=1). A present qmllint binary is never
# optional — its failures fail this script.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

node "$ROOT/scripts/qml-structure-check.js"

QMLLINT=""
if command -v qmllint >/dev/null 2>&1; then
  QMLLINT=qmllint
elif [ -x /usr/lib/qt6/bin/qmllint ]; then
  QMLLINT=/usr/lib/qt6/bin/qmllint
elif [ -x /usr/lib/qt6/libexec/qmllint ]; then
  QMLLINT=/usr/lib/qt6/libexec/qmllint
fi

require_qmllint=0
if [ "${SHARE_CLOAK_QMLLINT:-}" = "1" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  require_qmllint=1
fi

if [ -z "$QMLLINT" ]; then
  if [ "$require_qmllint" -eq 1 ]; then
    echo "qmllint-plugin: qmllint is required (install qt6-declarative-dev-tools)"
    exit 1
  fi
  echo "qmllint-plugin: qmllint not installed; structure check is the local gate"
  exit 0
fi

STUB="$ROOT/tests/qml-stubs"
echo "qmllint-plugin: running $QMLLINT"
"$QMLLINT" -I "$STUB" Service.qml Overlay.qml BarWidget.qml
echo "qmllint-plugin: qmllint ok"
