#!/bin/sh
# Detached teardown helper. Re-reads hyprctl -j binds, then unbinds a combo
# only when EVERY live binding on it is the exact owned plugin command
# (plugin-id + expected method + empty argument). Completes after QML dies.
set -eu

PLUGIN_ID=""
BINDS_FILE=""
DRY_RUN=0
SPECS=""

usage() {
  echo "usage: unbind-owned.sh [--binds FILE] [--dry-run] <plugin-id> <KEY:METHOD>..." >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --binds)
      [ $# -ge 2 ] || usage
      BINDS_FILE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage
      ;;
    *)
      break
      ;;
  esac
done

[ $# -ge 1 ] || usage
PLUGIN_ID="$1"
shift

while [ $# -gt 0 ]; do
  SPECS="${SPECS}${SPECS:+ }$1"
  shift
done

[ -n "$SPECS" ] || exit 0

export SHARE_CLOAK_UNBIND_PLUGIN="$PLUGIN_ID"
export SHARE_CLOAK_UNBIND_SPECS="$SPECS"
export SHARE_CLOAK_UNBIND_BINDS="${BINDS_FILE:-}"
export SHARE_CLOAK_UNBIND_DRY="$DRY_RUN"

if ! command -v python3 >/dev/null 2>&1; then
  echo "unbind-owned: python3 missing; refusing to unbind" >&2
  exit 1
fi

python3 - <<'PY'
import json, os, subprocess, sys

plugin = os.environ.get("SHARE_CLOAK_UNBIND_PLUGIN") or ""
specs_raw = os.environ.get("SHARE_CLOAK_UNBIND_SPECS") or ""
binds_file = os.environ.get("SHARE_CLOAK_UNBIND_BINDS") or ""
dry = os.environ.get("SHARE_CLOAK_UNBIND_DRY") == "1"
SUPER = 64

def fail(msg):
    sys.stderr.write("unbind-owned: %s\n" % msg)
    sys.exit(1)

def expected_args(method):
    return (
        "omarchy-shell %s %s ''" % (plugin, method),
        'omarchy-shell %s %s ""' % (plugin, method),
    )

def key_of(bind):
    return str((bind or {}).get("key") or (bind or {}).get("keycode") or "").upper()

def mod_of(bind):
    if not bind:
        return 0
    if "modmask" in bind:
        return int(bind.get("modmask") or 0)
    return int(bind.get("modMask") or 0)

def is_ours(bind, method):
    if not bind or not method:
        return False
    if str(bind.get("dispatcher") or "") != "exec":
        return False
    arg = str(bind.get("arg") or "")
    return arg in expected_args(method)

specs = []
for spec in specs_raw.split():
    if ":" not in spec:
        continue
    key, method = spec.split(":", 1)
    key = key.strip().upper()
    method = method.strip()
    if not key or not method:
        continue
    if not key.replace("_", "").isalnum() or not method.replace("_", "").isalnum():
        continue
    specs.append((key, method))

if not specs:
    sys.exit(0)

if binds_file:
    try:
        with open(binds_file, encoding="utf-8") as f:
            binds = json.load(f)
    except Exception as e:
        fail("could not read binds file: %s" % e)
else:
    try:
        raw = subprocess.check_output(["hyprctl", "-j", "binds"], text=True)
        binds = json.loads(raw)
    except Exception as e:
        fail("could not read hyprctl binds: %s" % e)

if not isinstance(binds, list):
    fail("binds is not a list")

def hits_for(key):
    out = []
    for b in binds:
        if not isinstance(b, dict):
            continue
        if mod_of(b) != SUPER:
            continue
        if key_of(b) != key:
            continue
        out.append(b)
    return out

to_unbind = []
for key, method in specs:
    hits = hits_for(key)
    if not hits:
        continue
    if all(is_ours(b, method) for b in hits):
        to_unbind.append(key)

# unique, preserve order
seen = set()
ordered = []
for key in to_unbind:
    if key in seen:
        continue
    seen.add(key)
    ordered.append(key)

if dry:
    for key in ordered:
        print(key)
    sys.exit(0)

for key in ordered:
    subprocess.call(["hyprctl", "keyword", "unbind", "SUPER," + key])
PY
