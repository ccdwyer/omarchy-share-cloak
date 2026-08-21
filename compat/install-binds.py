#!/usr/bin/env python3
"""Append, replace, or remove a marked o.bind block in ~/.config/hypr/bindings.lua.

Never writes hl.unbind. Occupied combos are skipped by the caller before
the block is produced.
"""

import os
import stat
import tempfile
import sys



def _refuse_symlink(path: str) -> None:
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(st.st_mode):
        raise OSError("refusing symlink: %s" % path)
    if not stat.S_ISREG(st.st_mode):
        raise OSError("not a regular file: %s" % path)


def read_text_nofollow(path: str) -> str:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        data = os.read(fd, 4_000_000)
    finally:
        os.close(fd)
    return data.decode("utf-8")


def write_text_atomic(path: str, text: str) -> None:
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    pst = os.lstat(parent)
    if stat.S_ISLNK(pst.st_mode):
        raise OSError("refusing symlink directory: %s" % parent)
    _refuse_symlink(path)
    fd, tmp = tempfile.mkstemp(prefix=".bindings.", suffix=".tmp", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        st = os.lstat(path)
        if stat.S_ISLNK(st.st_mode):
            raise OSError("refusing to leave a symlink at %s" % path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def bindings_path() -> str:
    config_home = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
        os.path.expanduser("~"), ".config"
    )
    return os.path.join(config_home, "hypr", "bindings.lua")


def markers(plugin_id):
    return "-- BEGIN %s" % plugin_id, "-- END %s" % plugin_id


def write_text(path: str, text: str) -> None:
    write_text_atomic(path, text)


def remove_block(plugin_id: str) -> int:
    path = bindings_path()
    begin, end = markers(plugin_id)
    if not os.path.isfile(path):
        print("ok")
        return 0
    text = read_text_nofollow(path)
    if begin not in text or end not in text:
        print("ok")
        return 0
    pre = text[: text.index(begin)]
    post = text[text.index(end) + len(end) :].lstrip("\n")
    out = pre.rstrip()
    if post:
        out = out + "\n" + post
        if not out.endswith("\n"):
            out += "\n"
    elif out:
        out += "\n"
    write_text(path, out)
    print("ok")
    return 0


def install_block(plugin_id: str, block: str) -> int:
    if not block.endswith("\n"):
        block += "\n"
    path = bindings_path()
    begin, end = markers(plugin_id)
    chunk = f"{begin}\n{block}{end}\n"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = ""
    if os.path.islink(path):
        print("error: refusing symlink %s" % path, file=sys.stderr)
        return 1
    if os.path.isfile(path):
        text = read_text_nofollow(path)
    if begin in text and end in text:
        pre = text[: text.index(begin)]
        post = text[text.index(end) + len(end) :].lstrip("\n")
        text = pre.rstrip() + "\n\n" + chunk
        if post:
            text = text.rstrip() + "\n" + post
            if not text.endswith("\n"):
                text += "\n"
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text = text.rstrip() + "\n\n" + chunk
        if not text.endswith("\n"):
            text += "\n"
    write_text(path, text)
    print("ok")
    return 0


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] in ("-h", "--help"):
        print(
            "usage: install-binds.py PLUGIN_ID LUA_BLOCK\n"
            "       install-binds.py --remove PLUGIN_ID",
            file=sys.stderr,
        )
        return 0
    if len(sys.argv) >= 2 and sys.argv[1] == "--remove":
        if len(sys.argv) < 3:
            print("usage: install-binds.py --remove PLUGIN_ID", file=sys.stderr)
            return 2
        return remove_block(sys.argv[2])
    if len(sys.argv) < 3:
        print(
            "usage: install-binds.py PLUGIN_ID LUA_BLOCK\n"
            "       install-binds.py --remove PLUGIN_ID",
            file=sys.stderr,
        )
        return 2
    return install_block(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    raise SystemExit(main())
