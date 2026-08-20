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

echo "ok  probe-fallback"
