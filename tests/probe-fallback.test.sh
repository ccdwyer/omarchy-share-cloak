#!/bin/sh
# Exercise the POSIX cloak-probe fallback without requiring cargo.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SH="$ROOT/compat/cloak-probe.sh"
FIX="$ROOT/tests/fixtures"
chmod +x "$SH"

out=$("$SH" pw-dump "$FIX/pw-dump-webcam.json")
echo "$out" | grep -q '"screencasting":false'
echo "$out" | grep -q '"webcamOnly":true'

out=$("$SH" pw-dump "$FIX/pw-dump-screencast.json")
echo "$out" | grep -q '"screencasting":true'

out=$("$SH" clients-diff "$FIX/clients-messy.json" "$FIX/clients-messy.json")
echo "$out" | grep -q '"equal":true'

out=$("$SH" session-check "$FIX/session-v1.json")
echo "$out" | grep -q '"cloaked":true'

UNBIND="$ROOT/compat/unbind-owned.sh"
chmod +x "$UNBIND"
id="io.github.chris.share-cloak"
keys=$("$UNBIND" --binds "$FIX/binds-ours.json" --dry-run "$id" F9:toggle F10:markFocused)
echo "$keys" | grep -qx "F9"
echo "$keys" | grep -qx "F10"
mixed=$("$UNBIND" --binds "$FIX/binds-mixed-method.json" --dry-run "$id" F9:toggle F10:markFocused)
echo "$mixed" | grep -qx "F10"
if echo "$mixed" | grep -qx "F9"; then
  echo "unbind-owned: F9 should not unbind when status shares the combo" >&2
  exit 1
fi

echo "ok  probe-fallback"
