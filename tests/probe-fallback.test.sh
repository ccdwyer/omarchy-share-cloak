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

INSTALL="$ROOT/compat/install-binds.py"
chmod +x "$INSTALL"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export XDG_CONFIG_HOME="$tmp/config"
mkdir -p "$XDG_CONFIG_HOME/hypr"
printf '%s\n' '-- user binds' >"$XDG_CONFIG_HOME/hypr/bindings.lua"
python3 "$INSTALL" "$id" 'o.bind("SUPER + F9", "Share Cloak toggle", "omarchy-shell io.github.chris.share-cloak toggle '\'''\''")'
grep -q -- "-- BEGIN $id" "$XDG_CONFIG_HOME/hypr/bindings.lua"
grep -q "o.bind" "$XDG_CONFIG_HOME/hypr/bindings.lua"
if grep -q "hl.unbind" "$XDG_CONFIG_HOME/hypr/bindings.lua"; then
  echo "install-binds: must not write hl.unbind" >&2
  exit 1
fi
python3 "$INSTALL" --remove "$id"
if grep -q -- "-- BEGIN $id" "$XDG_CONFIG_HOME/hypr/bindings.lua"; then
  echo "install-binds: --remove left the plugin block" >&2
  exit 1
fi
grep -q -- "-- user binds" "$XDG_CONFIG_HOME/hypr/bindings.lua"

echo "ok  probe-fallback"
