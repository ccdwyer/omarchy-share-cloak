#!/bin/sh
# POSIX fallback for cloak-probe used when the compiled binary is missing.
# pw-dump parsing prefers python3 (present on Omarchy); otherwise a grep heuristic.

set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

default_state_dir() {
  if [ -n "${XDG_STATE_HOME:-}" ]; then
    printf '%s/share-cloak' "$XDG_STATE_HOME"
  else
    printf '%s/.local/state/share-cloak' "${HOME:-/tmp}"
  fi
}

secure_path() {
  path="$1"
  parent=$(dirname "$path")
  if [ -d "$parent" ]; then
    chmod 700 "$parent" 2>/dev/null || true
  fi
  if [ -e "$path" ]; then
    chmod 600 "$path" 2>/dev/null || true
  fi
}

cmd_init_state() {
  dir="${1:-$(default_state_dir)}"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  if [ ! -f "$dir/session.json" ]; then
    printf '{}\n' > "$dir/session.json"
  fi
  if [ ! -f "$dir/marks.json" ]; then
    printf '{\n  "version": 1,\n  "marks": []\n}\n' > "$dir/marks.json"
  fi
  chmod 600 "$dir/session.json" "$dir/marks.json" 2>/dev/null || true
  printf '{"ok":true,"dir":"%s"}\n' "$(json_escape "$dir")"
}

cmd_secure() {
  if [ -z "${1:-}" ]; then
    printf '{"ok":false,"error":"secure requires a path"}\n'
    return 1
  fi
  secure_path "$1"
  printf '{"ok":true}\n'
}

pwdump_python() {
  python3 - "$1" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
try:
    nodes = json.loads(raw)
except Exception as e:
    print('{"ok":false,"error":"%s"}' % str(e).replace('"', '\\"'))
    sys.exit(1)
if not isinstance(nodes, list):
    nodes = []

def props_of(n):
    info = n.get("info") or {}
    return info.get("props") or info.get("properties") or n.get("props") or {}

def lower(s):
    return str(s or "").lower()

def is_node(n):
    if not isinstance(n, dict):
        return False
    t = str(n.get("type") or "")
    if not t:
        return "info" in n
    return "Node" in t

def portal_screencast(p):
    t = lower(p.get("pipewire.access.portal.type"))
    if t == "screencast":
        return True
    role = lower(p.get("media.role"))
    return role in ("screen", "screencast")

def screencast_name(name):
    n = lower(name)
    keys = ("xdg-desktop-portal", "screencast", "hyprland-share", "wf-recorder",
            "wl-screenrec", "xdg-desktop-portal-wlr", "xdg-desktop-portal-hyprland")
    return any(k in n for k in keys) or ("obs" in n and "record" in n)

def webcam(p):
    if portal_screencast(p):
        return False
    api = lower(p.get("device.api"))
    if api in ("v4l2", "libcamera", "v4l2-utils"):
        return True
    role = lower(p.get("media.role"))
    if role in ("camera", "webcam"):
        return True
    t = lower(p.get("pipewire.access.portal.type"))
    if t in ("camera", "webcam"):
        return True
    name = "%s %s" % (p.get("node.name") or "", p.get("node.description") or "")
    nl = lower(name)
    if any(k in nl for k in ("v4l2", "webcam", "libcamera", "camera")) and "portal" not in nl and "screencast" not in nl:
        return True
    return False

def window_share(p):
    if p.get("window.x11.id") or p.get("window.x11.xid"):
        return True
    src = lower(p.get("pipewire.access.portal.source") or p.get("screencast.source"))
    if "window" in src:
        return True
    return "window" in lower(p.get("target.object"))

def screencast_node(n, p):
    if webcam(p):
        return False
    if portal_screencast(p):
        return True
    klass = str(p.get("media.class") or "")
    name = "%s %s" % (p.get("node.name") or "", p.get("node.description") or "")
    return screencast_name(name) and ("Video" in klass)

streams = []
screencasting = False
window = False
webcam_count = 0
for n in nodes:
    if not is_node(n):
        continue
    p = props_of(n)
    if webcam(p):
        webcam_count += 1
        continue
    if not screencast_node(n, p):
        continue
    screencasting = True
    win = window_share(p)
    if win:
        window = True
    streams.append({
        "id": n.get("id") or 0,
        "name": p.get("node.name") or "",
        "class": p.get("media.class") or "",
        "windowShare": win,
    })
out = {
    "screencasting": screencasting,
    "windowShare": window,
    "webcamOnly": webcam_count > 0 and not screencasting,
    "webcamCount": webcam_count,
    "streamCount": len(streams),
    "streams": streams,
    "source": "pw-dump",
}
print(json.dumps(out, separators=(",", ":")))
PY
}

pwdump_grep() {
  # Last-resort heuristic when python3 is absent. Webcam names veto a match
  # unless a portal screencast token is also present.
  text=$(cat)
  has_cast=0
  has_cam=0
  printf '%s' "$text" | grep -q 'pipewire.access.portal.type.: *screencast\|xdg-desktop-portal-hyprland\|xdg-desktop-portal-wlr\|wf-recorder\|wl-screenrec' && has_cast=1
  printf '%s' "$text" | grep -q 'device.api.: *v4l2\|media.role.: *Camera\|libcamera' && has_cam=1
  if [ "$has_cast" -eq 1 ]; then
    printf '{"screencasting":true,"windowShare":false,"webcamOnly":false,"webcamCount":%s,"streamCount":1,"streams":[],"source":"pw-dump"}\n' "$has_cam"
  else
    printf '{"screencasting":false,"windowShare":false,"webcamOnly":%s,"webcamCount":%s,"streamCount":0,"streams":[],"source":"pw-dump"}\n' \
      "$([ "$has_cam" -eq 1 ] && echo true || echo false)" "$has_cam"
  fi
}

cmd_pwdump() {
  path="${1:-}"
  tmp=""
  if [ -z "$path" ]; then
    if ! command -v pw-dump >/dev/null 2>&1; then
      printf '{"screencasting":false,"windowShare":false,"webcamOnly":false,"webcamCount":0,"streamCount":0,"streams":[],"source":"none","error":"pw-dump missing"}\n'
      return 0
    fi
    tmp=$(mktemp)
    pw-dump > "$tmp" || true
    path="$tmp"
  elif [ "$path" = "-" ]; then
    tmp=$(mktemp)
    cat > "$tmp"
    path="$tmp"
  fi
  if command -v python3 >/dev/null 2>&1; then
    pwdump_python "$path"
  else
    pwdump_grep < "$path"
  fi
  if [ -n "$tmp" ]; then
    rm -f "$tmp"
  fi
}

cmd_session_check() {
  path="${1:-}"
  if [ -z "$path" ] || [ ! -f "$path" ]; then
    printf '{"ok":false,"error":"missing"}\n'
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
import json, sys
raw = open(sys.argv[1]).read().strip()
if not raw or raw == "{}":
    print('{"ok":true,"empty":true,"cloaked":false}')
    raise SystemExit
data = json.loads(raw)
phase = data.get("phase") or "idle"
cloaked = phase in ("cloaked", "uncloaking")
print('{"ok":true,"empty":false,"cloaked":%s,"phase":"%s","mutations":%d}' % (
    "true" if cloaked else "false", phase, len(data.get("mutations") or [])))
PY
  else
    printf '{"ok":true,"empty":false}\n'
  fi
}

cmd_clients_diff() {
  a="${1:-}"
  b="${2:-}"
  if [ -z "$a" ] || [ -z "$b" ]; then
    printf '{"ok":false,"error":"clients-diff requires two files"}\n'
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$a" "$b" <<'PY'
import json, sys
def norm(path):
    data = json.load(open(path))
    rows = []
    for c in data or []:
        ws = c.get("workspace") or {}
        at = c.get("at") or [0, 0]
        size = c.get("size") or [0, 0]
        addr = str(c.get("address") or "").lower()
        if addr and not addr.startswith("0x"):
            addr = "0x" + addr
        rows.append("|".join([
            addr, str(c.get("class") or ""), str(c.get("title") or ""),
            str(ws.get("id") or c.get("workspaceId") or 0),
            str(ws.get("name") or c.get("workspaceName") or ""),
            str(at[0] if at else 0), str(at[1] if at else 0),
            str(size[0] if size else 0), str(size[1] if size else 0),
            str(bool(c.get("floating"))), str(c.get("fullscreen") or 0),
            str(c.get("monitor") if c.get("monitor") is not None else 0),
        ]))
    rows.sort()
    return rows
before, after = norm(sys.argv[1]), norm(sys.argv[2])
print('{"ok":true,"equal":%s,"before":%d,"after":%d}' % (
    "true" if before == after else "false", len(before), len(after)))
PY
  else
    if cmp -s "$a" "$b"; then
      printf '{"ok":true,"equal":true}\n'
    else
      printf '{"ok":true,"equal":false}\n'
    fi
  fi
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ -z "${1:-}" ]; then
  printf 'usage:\n  cloak-probe pw-dump [path|-]\n  cloak-probe init-state [dir]\n  cloak-probe secure <path>\n  cloak-probe session-check <path>\n  cloak-probe clients-diff <before.json> <after.json>\n' >&2
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  printf 'cloak-probe 1.0.0\n'
  exit 0
fi

cmd="$1"
shift
case "$cmd" in
  pw-dump) cmd_pwdump "${1:-}" ;;
  init-state) cmd_init_state "${1:-}" ;;
  secure) cmd_secure "${1:-}" ;;
  session-check) cmd_session_check "${1:-}" ;;
  clients-diff) cmd_clients_diff "${1:-}" "${2:-}" ;;
  *)
    printf '{"ok":false,"error":"unknown command: %s"}\n' "$(json_escape "$cmd")"
    exit 2
    ;;
esac
