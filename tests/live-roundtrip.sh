#!/bin/sh
# Live Hyprland cloak/uncloak round-trip.
# Uses hyprctl against the running compositor. Skips (exit 0) when Hyprland
# is not available unless SHARE_CLOAK_REQUIRE_LIVE=1.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CYCLES="${SHARE_CLOAK_LIVE_CYCLES:-200}"

if ! command -v hyprctl >/dev/null 2>&1; then
  echo "live-roundtrip: hyprctl not found"
  if [ "${SHARE_CLOAK_REQUIRE_LIVE:-}" = "1" ]; then
    exit 1
  fi
  echo "live-roundtrip: SKIP (no Hyprland on this machine)"
  exit 0
fi

if ! hyprctl -j version >/dev/null 2>&1; then
  echo "live-roundtrip: hyprctl cannot talk to Hyprland"
  if [ "${SHARE_CLOAK_REQUIRE_LIVE:-}" = "1" ]; then
    exit 1
  fi
  echo "live-roundtrip: SKIP"
  exit 0
fi

export SHARE_CLOAK_LIVE_CYCLES="$CYCLES"
exec node "$ROOT/tests/live-roundtrip.js"
