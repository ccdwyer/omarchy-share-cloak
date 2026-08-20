#!/bin/sh
# Build cloak-probe. The plugin QML degrades to compat/cloak-probe.sh
# when bin/cloak-probe is missing, so a failed build is not fatal at runtime.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SRC="$ROOT/src/cloak-probe"
OUT="$ROOT/bin"

mkdir -p "$OUT"
chmod +x "$ROOT/compat/cloak-probe.sh" 2>/dev/null || true

if ! command -v cargo >/dev/null 2>&1; then
  echo "build.sh: cargo not found; installing POSIX fallback as bin/cloak-probe" >&2
  cp "$ROOT/compat/cloak-probe.sh" "$OUT/cloak-probe"
  chmod +x "$OUT/cloak-probe"
  echo "build.sh: wrote $OUT/cloak-probe (shell fallback)"
  exit 0
fi

if ! cargo build --release --manifest-path "$SRC/Cargo.toml"; then
  echo "build.sh: cargo build failed; installing POSIX fallback as bin/cloak-probe" >&2
  cp "$ROOT/compat/cloak-probe.sh" "$OUT/cloak-probe"
  chmod +x "$OUT/cloak-probe"
  echo "build.sh: wrote $OUT/cloak-probe (shell fallback)"
  exit 0
fi

BIN="$SRC/target/release/cloak-probe"
if [ ! -x "$BIN" ]; then
  echo "build.sh: release binary missing after cargo build" >&2
  exit 1
fi
cp "$BIN" "$OUT/cloak-probe"
chmod +x "$OUT/cloak-probe"
echo "build.sh: wrote $OUT/cloak-probe"
