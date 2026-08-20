# Share Cloak

One key builds a presenter desktop. Marked windows vanish onto `special:cloak`, notifications pause, a clean theme plate covers the wallpaper, and an ON AIR frame stays up until you uncloak.

This is an Omarchy shell plugin (service + overlay + bar-widget). It runs inside the long-lived `omarchy-shell` process. It does not start a second Quickshell instance.

Auto-cloak is **on by default**: start a full-output share (Zoom / Meet / OBS / wf-recorder) and the desktop dresses itself.

## Install

```sh
omarchy plugin add <git-url> --enable
```

Then, on the machine, you can build the optional helper (pw-dump parsing + `0600` session files). The plugin works without it:

```sh
~/.config/omarchy/plugins/io.github.chris.share-cloak/build.sh
```

Put the chip on the bar if `--enable` did not:

```sh
omarchy bar put io.github.chris.share-cloak --section right
```

Reload plugins if the shell was already running:

```sh
omarchy-shell shell rescanPlugins
```

## Usage

| Combo | Action |
|---|---|
| Super+F9 | Toggle cloak / uncloak (also restores an interrupted session) |
| Super+F10 | Mark the focused window's class (stays marked forever) |
| Bar chip, left click | Same as Super+F9 |
| Bar chip, right click | Open the mark list |

The plugin does **not** write these into `hyprland.conf`. Bind them yourself. The Omarchy Quattro IPC verb is `omarchy-shell shell call` / `summon`:

```
bind = SUPER, F9, exec, omarchy-shell shell call io.github.chris.share-cloak toggle
bind = SUPER, F10, exec, omarchy-shell shell call io.github.chris.share-cloak markFocused
```

If a bind collides, use the bar chip.

### What cloak does

1. Snapshot windows, workspaces, floating geometry, special workspaces, and notification mode to `~/.local/state/share-cloak/session.json`. Every mutation is recorded with **ownership**.
2. Move every *marked* window to `special:cloak` (hidden, unshareable). **This is the one protection claim.**
3. Catch new windows spawned by marked apps (dialogs, splashes) and send them to `special:cloak` too.
4. Optionally dim unmarked windows via per-address `setprop alpha` (no `windowrulev2` accumulation).
5. Cover the wallpaper with an owned below-windows layer plate (theme background + a slight gradient). Restore = destroy the surface.
6. Pause notifications with mako (`makoctl mode -a dnd` / `do-not-disturb` if that mode exists). If mako is not managing notifications, cloak still runs and the chip says `notifications: unmanaged`.
7. Draw a 3 px ON AIR frame and a `CLOAKED · Super+F9 to uncloak` chip on the overlay layer.

Uncloak replays owned mutations in reverse, verifies each window address still exists, and lists anything unrestorable in a toast. User changes made while cloaked (you moved a window off `special:cloak`) are preserved.

Bar chip states: **cloak** (idle) / **CLOAK** (armed, watching for a share) / **ON AIR**.

## Honest limitations

- **Vanish, not blur.** Hyprland has no per-client capture-blur primitive. Marked windows are moved to `special:cloak`. Cover cards on a full-output share are cosmetic presence indicators drawn over already-hidden windows — they cannot leak content if tracking is late.
- **Window-share bypass.** If you share a *single window*, Cloak cannot hide that window's own pixels, and layer surfaces (plate, ON AIR frame, cover cards) are not visible to viewers. The `screencast` event's owner field detects this: Cloak warns `WINDOW SHARE — Cloak protects full-screen shares` and still runs DND + the workspace guard + vanish of *other* marked windows. Demo with a full-output share.
- **One-frame flash on unsafe workspace switches.** While cloaked, a workspace event whose target is not in the safe list (the workspace(s) visible at cloak time) covers the output immediately. Safe-list switches never flicker. A one-frame flash of the unsafe workspace is possible; the zero-frame pattern is: share one output, keep unsafe workspaces on the other.
- **Notifications are mako-only.** No dunst path. If `makoctl mode` does not list `dnd` / `do-not-disturb` / similar, the step is a visible no-op.
- **Helper binary is optional.** `bin/cloak-probe` is built by `build.sh`. If it is missing, QML falls back to `compat/cloak-probe.sh` and, for share corroboration, to an in-process `pw-dump` JSON parse. Auto-cloak's primary trigger is Hyprland's `screencast` socket2 event, not the helper.
- **Keybinds are yours to add.** The plugin never writes `hyprland.conf`.
- **ON AIR frame tracks the layer-shell output the overlay landed on** (typically the focused / primary screen). The `screencast` event does not name which monitor is shared.
- **Crash mid-cloak** leaves windows on `special:cloak`. On the next shell start, Share Cloak offers one-key restore (Super+F9) rather than mutating the layout unattended.

## Settings

Inline on the `shell.json` bar-widget / plugins entry (no plugin-owned settings file):

| Key | Default | Meaning |
|---|---|---|
| `autoCloak` | `true` | Cloak when a share starts |
| `workspaceGuard` | `true` | Cover workspaces that were not visible at cloak time |
| `dimOthers` | `true` | `setprop alpha 0.85` on unmarked windows |
| `coverCards` | `true` | Cosmetic cards at hidden windows' last geometry (full-output only) |

Marks (class + title regex) persist in `~/.local/state/share-cloak/marks.json`. They are a growing list from Super+F10 / the popup, not widget settings.

## Tests (off-device)

```sh
node tests/run.js
sh tests/probe-fallback.test.sh
# optional, needs cargo:
cargo test --manifest-path src/cloak-probe/Cargo.toml
```

## License

MIT. See [LICENSE](LICENSE).
