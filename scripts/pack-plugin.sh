#!/bin/sh
# Build a submission tarball from git-tracked files only.
# Excludes src/cloak-probe/target, review harness dotfiles, and other debris.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "pack-plugin.sh: not a git checkout; refusing to pack the working tree" >&2
  exit 1
fi

OUTDIR="$ROOT/dist"
mkdir -p "$OUTDIR"
OUT="$OUTDIR/share-cloak.git.tar.gz"

git archive --format=tar.gz --prefix=share-cloak/ -o "$OUT" HEAD
echo "pack-plugin.sh: wrote $OUT"
echo "pack-plugin.sh: Linux cloak-probe is built in CI (.github/workflows/ci.yml) or via ./build.sh on Omarchy."
