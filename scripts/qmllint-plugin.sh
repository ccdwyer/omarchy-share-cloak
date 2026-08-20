#!/bin/sh
# Strict QML gate. Never converts a failed linter into success.
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

if [ "${SHARE_CLOAK_QMLLINT:-}" != "1" ]; then
  echo "qmllint-plugin: structure check is the required gate (set SHARE_CLOAK_QMLLINT=1 to run host qmllint)"
  exit 0
fi

if [ -z "$QMLLINT" ]; then
  echo "qmllint-plugin: SHARE_CLOAK_QMLLINT=1 but qmllint is not installed"
  exit 1
fi

STUB="$ROOT/tests/qml-stubs"
echo "qmllint-plugin: running $QMLLINT"
"$QMLLINT" -I "$STUB" Service.qml Overlay.qml BarWidget.qml
echo "qmllint-plugin: qmllint ok"
