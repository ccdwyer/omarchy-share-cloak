#!/bin/sh
# Optional tarball of git-tracked files only. Not the install path —
# Omarchy clones the git URL. dist/ is gitignored so this cannot go stale
# in the repo. After writing, the archive file list must match HEAD.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "pack-plugin.sh: not a git checkout; refusing to pack the working tree" >&2
  exit 1
fi

if git ls-files --error-unmatch dist/share-cloak.git.tar.gz >/dev/null 2>&1; then
  echo "pack-plugin.sh: dist/share-cloak.git.tar.gz is git-tracked; untrack it" >&2
  exit 1
fi

OUTDIR="$ROOT/dist"
mkdir -p "$OUTDIR"
OUT="$OUTDIR/share-cloak.git.tar.gz"

git archive --format=tar.gz --prefix=share-cloak/ -o "$OUT" HEAD

HEAD_LIST=$(mktemp)
TAR_LIST=$(mktemp)
trap 'rm -f "$HEAD_LIST" "$TAR_LIST"' EXIT
git ls-files | sort >"$HEAD_LIST"
tar tzf "$OUT" | sed 's|^share-cloak/||' | grep -v '/$' | grep -v '^$' | sort >"$TAR_LIST"
if ! diff -u "$HEAD_LIST" "$TAR_LIST" >/dev/null; then
  echo "pack-plugin.sh: archive file list diverges from HEAD" >&2
  diff -u "$HEAD_LIST" "$TAR_LIST" >&2 || true
  exit 1
fi
for need in compat/unbind-owned.sh tests/fixtures/binds-mixed-method.json Service.qml; do
  grep -qx "$need" "$TAR_LIST" || {
    echo "pack-plugin.sh: archive missing $need" >&2
    exit 1
  }
done

echo "pack-plugin.sh: wrote $OUT (matches HEAD; gitignored, not a submission artifact)"
echo "pack-plugin.sh: install path is omarchy plugin add <git-url>. Linux cloak-probe is CI / ./build.sh."
