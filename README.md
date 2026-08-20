# Share Cloak

One key builds a presenter desktop. Marked windows vanish onto `special:cloak`, notifications pause, a clean theme plate covers the wallpaper, and an ON AIR frame stays up until you uncloak.

This is an Omarchy shell plugin (service + overlay + bar-widget). It runs inside the long-lived `omarchy-shell` process. It does not start a second Quickshell instance.

Auto-cloak is **on by default**: start a full-output share (Zoom / Meet / OBS / wf-recorder) and the desktop dresses itself.

![Share Cloak preview](preview.png)

![Share Cloak cloak / uncloak cycle](demo.gif)

The GIF is a constructed six-beat storyboard of the real sequence (messy desktop → `screencast>>1,0` → vanish to `special:cloak` → ON AIR → restore). It is not a live Hyprland capture from this machine.

## Install

```sh
omarchy plugin add <git-url> --enable
```

Then, on the Omarchy machine, build the optional helper (pw-dump parsing + `0600` session files). There is no committed Linux binary from this Mac — `./build.sh` compiles it on the target, and GitHub Actions (`.github/workflows/ci.yml`) publishes a Linux `cloak-probe` artifact. The plugin QML works without the binary.

```sh
~/.config/omarchy/plugins/io.github.chris.share-cloak/build.sh
```

Install is the git clone above. `./scripts/pack-plugin.sh` can write a *gitignored* `dist/share-cloak.git.tar.gz` from `HEAD` for a one-off copy; that tarball is not committed (a checked-in archive goes stale). GitHub Actions uploads a fresh pack as a CI artifact.

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
| Super+F10 | Mark the focused window's class (stays marked forever). Tiled windows of that class vanish too. |
| Bar chip, left click | Same as Super+F9 |
| Bar chip, right click | Open the mark list |

On first load the plugin writes those binds to `~/.config/hypr/bindings.lua` if the combos are free, then pops an Omarchy notification with the keys it assigned. Occupied shortcuts (including stock Omarchy hotkeys) are skipped or replaced with Super+Alt variants. Super+F9 is fine next to voxtype PTT (F9 without Super). It never unbinds someone else's key, and it will not notify again once its binds are already live. Previously auto-installed `hyprctl keyword bind` Super+F9/F10 combos are still torn down on disable when they are exclusively this plugin's expected command.

Cloak toggle/mark hit the plugin's `IpcHandler` (the service). `omarchy-shell shell call … toggle` would invoke the overlay UI, not cloak. The handler requires a third argument (empty string when unused):

```
omarchy-shell io.github.chris.share-cloak toggle ''
omarchy-shell io.github.chris.share-cloak markFocused ''
```

If a bind collides with one you already have, the bar chip still works. Occupied preferred combos are skipped or replaced with Super+Alt variants.

### What cloak does

1. Snapshot windows, workspaces, floating geometry, special workspaces, and notification mode to `~/.local/state/share-cloak/session.json`. Every mutation is recorded with **ownership**.
2. **Marked floating windows** move to `special:cloak`. **Marked tiled windows stay in the layout**: Hyprland `no_screen_share` blacks them out of the screencast, `opacity 0` hides them on your display, `no_focus` keeps them from eating keys. Siblings do not reflow. Uncloak reverses those props. Cover cards can draw over the empty tile.
3. Catch new windows from marked apps the same way (tiled in place, floating to `special:cloak`).
4. Optionally dim unmarked windows via per-address `set_prop opacity` (no `windowrulev2` accumulation).
5. Cover the wallpaper with an owned below-windows layer plate (theme background + a slight gradient). Restore = destroy the surface.
6. Pause notifications with mako only when a **configured suppression mode** exists (`[mode=…]` with `invisible=1` or `inhibit=1`). Guessed names are never added. After `-a`, Cloak re-reads `makoctl mode` before claiming notifications are managed. Uncloak removes only a mode this plugin added.
7. Draw a 3 px ON AIR frame and a `CLOAKED · Super+F9 to uncloak` chip on the overlay layer.

Uncloak replays owned mutations in reverse, verifies vanished floating windows are off `special:cloak`, and lists anything unrestorable in a toast. If `hyprctl` or a restore batch fails, `session.json` is kept and Super+F9 retries. User changes made while cloaked (you moved a vanished floating window off `special:cloak`) are preserved.

Bar chip states: **cloak** (idle) / **CLOAK** (armed, watching for a share) / **ON AIR**.

## Honest limitations

- **Tiled hide is in-place.** Hyprland 0.56 `no_screen_share` draws a black rectangle in the screencast instead of the window buffer. Local `opacity 0` hides the tile without leaving the layout. Cover cards are optional placeholders over that hole.
- **Floating windows still vanish** onto `special:cloak`. That does not reflow tiles.
- **Window-share bypass.** If you share a *single window*, Cloak cannot hide that window's own pixels, and layer surfaces (plate, ON AIR frame, cover cards) are not visible to viewers. The `screencast` event's owner field detects this: Cloak warns `WINDOW SHARE — Cloak protects full-screen shares` and still runs DND + the workspace guard + vanish of *other* marked windows. Demo with a full-output share.
- **One-frame flash on unsafe workspace switches.** While cloaked, a workspace event whose target is not in the safe list (the workspace(s) visible at cloak time) covers the output immediately. Safe-list switches never flicker. A one-frame flash of the unsafe workspace is possible; the zero-frame pattern is: share one output, keep unsafe workspaces on the other.
- **Notifications are mako-only.** No dunst path. Omarchy does not ship mako, so cloak continues with `notifications: unmanaged` instead of stalling. Only a mako config section that actually suppresses notifications is used. If none is configured, or add+re-read fails, the chip says `notifications: unmanaged`. A suppression mode the user already had on is left alone. Missing `makoctl` must not freeze the bar chip or Super+F9/F10.
- **Helper binary is optional.** `bin/cloak-probe` is built by `build.sh`. If it is missing, QML falls back to `compat/cloak-probe.sh` and, for share corroboration, to an in-process `pw-dump` JSON parse. Auto-cloak's primary trigger is Hyprland's `screencast` socket2 event, not the helper.
- **Keybinds auto-assign on first load.** Super+F9 / F10 are written to `~/.config/hypr/bindings.lua` if they are free, then an Omarchy notification lists what was assigned. Occupied combos (including stock Omarchy hotkeys) are skipped or replaced with Super+Alt variants. Never `hl.unbind` of someone else's shortcut. If any of this plugin's binds is already live, it does nothing and does not notify again. Previously owned `hyprctl keyword bind` Super+F9/F10 combos are still torn down on disable via a detached helper (`compat/unbind-owned.sh`) that re-reads live binds and unbinds only exact owned exec commands. Mixed plugin+user or same-plugin/different-method combos are left untouched. **Writing `bindings.lua` and keyword teardown need `python3`** (Omarchy ships it). The bar chip is always the control.
- **ON AIR frame tracks the layer-shell output the overlay landed on** (typically the focused / primary screen). The `screencast` event does not name which monitor is shared.
- **Crash mid-cloak** leaves windows on `special:cloak`. On the next shell start, Share Cloak offers one-key restore (Super+F9) rather than mutating the layout unattended.

## Settings

These keys are read **only** from the bar-widget layout entry in `shell.json`. The same keys on a `plugins[]` service entry are ignored, so load order cannot fight the widget.

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
sh scripts/omarchy-plugin-validate.sh
sh tests/live-roundtrip.sh          # Omarchy only: full-set hyprctl round-trip (not run in GitHub CI)
# optional:
./scripts/pack-plugin.sh            # gitignored dist/ tarball from HEAD; not the install path
# optional, needs cargo:
cargo test --manifest-path src/cloak-probe/Cargo.toml
```

## License

MIT. See [LICENSE](LICENSE).
