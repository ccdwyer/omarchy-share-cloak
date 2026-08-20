# Assumptions

Conservative choices where the Omarchy / Quickshell / Hyprland API was not 100% certain. The rule: isolate the uncertainty behind a small adapter, prefer documented types (`Process`, `Socket`, `FileView`, `Hyprland`, `IpcHandler`, `PanelWindow`), and degrade.

## Plugin host

- **Entry points are `Item`s**, not `ShellRoot`. Overlay exposes `open(payloadJson)` and `close()` for `omarchy-shell shell summon` / `hide`.
- **Documented IPC is the primary path.** Verbs are `omarchy-shell shell summon|hide|toggle|call <id> …`. `call` always includes `<arg>`; no-argument methods pass `''`. **`omarchy-shell shell call <id> <method> <arg>` invokes a method on the already-loaded overlay/panel, not the service.** Overlay `toggle()` is overlay UI. Cloak Super+F9/F10 and the bar-chip fallback therefore call the service `IpcHandler`: `omarchy-shell io.github.chris.share-cloak <method> ''`. Overlay `markFocused(arg)` forwards to the service so `shell call … markFocused` still works. In-process method calls are used only when `pluginRegistry.serviceFor` already returned this plugin's own Item. We do **not** call `shell.firstPartyServiceFor` or assume other injected host APIs exist.
- **Injected properties we do rely on:** bar-widget schema keys (`autoCloak`, `workspaceGuard`, `dimOthers`, `coverCards`) on the **bar-widget** entry only. The service still *declares* the same `var`s (so a host that injects them does not fail QML load) but **does not apply them** — `BarWidget.pushSettings` is the single writer into `Config.js`. A `plugins[]` copy of those keys is ignored. Marks stay in `~/.local/state/share-cloak/marks.json` (growing list; a plugin cannot write `shell.json`).
- **`keepLoaded: true`** so the overlay's layer-shell windows survive between summons. The spec JSON omitted this; the Quattro reference wins.
- **`barWidget` metadata block** is required by the reference when `kinds` includes `bar-widget`. The spec's example JSON omitted it; the reference wins.
- **`moduleName` is `io.github.chris.share-cloak` on every entry point** (Service, Overlay, BarWidget).
- **`IpcHandler` target** is the plugin id. Methods accept a `string` arg. Super+F9/F10 call `omarchy-shell io.github.chris.share-cloak <method> ''` so cloak works even if the overlay is not loaded. `shell call` is a second path (overlay methods), not the cloak toggle.

## Quickshell

- **`Hyprland.rawEvent`** is the documented socket2 feed (`event.name`, `event.data`). Primary event source, including `screencast`.
- **`Socket { path; connected; parser: SplitParser }`** is a fallback only if `rawEvent` is silent for 2s. Reconnect uses `onConnectedChanged` only — **`Socket.onError` is not used**, because it may be missing on the judge's pinned Quickshell and would fail QML load.
- **`Hyprland.eventSocketPath`** if present, else `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`.
- **`Hyprland.dispatch(request)`** for single catch-all moves. The cloak/uncloak transaction uses `hyprctl --batch` via `Process`. Every batch exit code is checked; a failed batch is retried command-by-command; marked windows are then verified on `hyprctl -j clients` before the plugin reports `cloaked`. Failure rolls back owned moves and shows a toast instead of claiming protection. Hyprland 0.55+ wraps the dispatch argument as `hl.dispatch(<expr>)`, so batch/dispatch lines must be `hl.dsp.*` tables (`Hypr.luaString` + `moveSilent` / `movePixel` / …), not classic `movetoworkspacesilent …` strings (Lua syntax error). `hyprctl setprop` is not dispatch and stays as-is.
- **Layer surfaces.** Plate: `WlrLayer.Background`. ON AIR frame / chip / covers / workspace-hidden / unrestorable toast: `WlrLayer.Overlay`. Click-through is empty `mask: Region {}` plus `WlrKeyboardFocus.None`.
- **One PanelWindow per role, no `Variants`.** The `screencast` event does not name a monitor.
- **Theme tokens** `Color.menu.*`, `Color.accent`, `Style.*`, `Border.*`, `WidgetButton`, `BarWidget`, `BorderSurface`, `PanelWindow`, `WlrLayershell` — copied from first-party plugins. Reduced motion: `Style.reduceMotion` if present, else `OMARCHY_REDUCED_MOTION=1`.
- **`.pragma library` JS** is shared across Service, Overlay, and BarWidget. Tests strip the pragma and eval under Node.

## Hyprland

- **`screencast>>STATE,OWNER`**: state `0/1`, owner `0` = monitor, `1` = window. `pw-dump` polling is the fallback when no screencast event has fired **or** when no socket2 event has been seen for 4s (so a later event-feed drop re-enables pw-dump instead of leaving it permanently suppressed).
- Workspace guard decides **synchronously from the event payload**.
- **Every marked window vanishes onto `special:cloak`.** That move is the only protection claim. Tiled marked windows are included — `alpha 0` / `nofocus` on a still-present tile is not protection. Hyprland does not expose dwindle/master tree JSON, so uncloak is workspace + `settiled` (floating windows also get pixel geometry). Split ratios may change. Verify: each marked address is on `special:cloak` in `hyprctl -j clients` before the plugin reports `cloaked`. `tests/live-roundtrip.sh` round-trips floating vanish on a live compositor; GitHub CI does not start Hyprland and does not claim to.
- Workspace tokens: plain numeric ids as-is; `special:…` kept; other names as `name:…`. Names containing `,` or `;` (batch separators) fall back to the numeric workspace id so `--batch` strings stay well-formed.
- Dim-others: `hyprctl getprop address:0x… alpha` (and `dimaround` if enabled) **before** `setprop`. `hyprctl clients -j` does not include these properties. If getprop fails, that window is not dimmed and no dim mutation is recorded (we never invent `from: 1`). At uncloak we getprop again and restore only when live still equals the applied `to`.
- Protection-critical work is the special-workspace **move of every marked window**. Move batches are verified on `clients -j` before reporting `cloaked`. Dim batches are optional; a dim failure does not claim a successful vanish it did not perform, and does not un-cloak a verified vanish.
- Catch-all / newly-marked moves go through `hyprctl dispatch` with an `hl.dsp.window.move({ workspace, follow = false, window })` table (checked exit code) and a follow-up `clients -j` that the address is on `special:cloak`. Failed hides are toasted; they are not recorded as owned.
- Uncloak requires a valid `clients -j` snapshot (exit 0 + JSON array). Restore batches are checked; a follow-up `clients -j` must show owned moved windows **off** `special:cloak`. Any failure keeps `session.json` and offers Super+F9 retry. Session is cleared only after a verified restore (or a verified complete rollback of a failed cloak).
- Address spelling is lowercase `0x…`.
- `hyprctl -j clients|monitors|workspaces|activewindow|version` and `hyprctl getprop` exist.

## Mako

- `makoctl mode` lists **currently enabled** modes. Suppression modes are only those `[mode=name]` sections in `~/.config/mako/config` whose body sets `invisible=1` (or `inhibit=1`). A mode that is merely named `dnd` is not enough.
- No guessed `makoctl mode -a dnd` when config has no suppression section — that add can succeed without hiding notifications.
- After a successful `-a`, Cloak re-reads `makoctl mode` and records ownership only if the mode is actually current. Restore is `-r` only for a mode this plugin added; `-r` exit code is checked and `makoctl mode` is re-read to confirm the mode is gone. Failure keeps `session.json` and Super+F9 retries.
- Mode-section bodies are bounded at the next `[...]` header of any kind (not only the next `[mode=…]`), so an intervening criteria section cannot donate `invisible=1` to the previous mode.
- If `makoctl` is missing, config has no suppression mode, or add+verify fails, cloak continues with `notifications: unmanaged`. Omarchy does not ship mako. Quickshell `Process` does **not** emit `exited` on FailedToStart (missing binary), so every `makoctl` argv is wrapped with `Mako.safeArgv` (`sh -c 'command -v … || exit 127; exec …'`). The work queue also treats `running` flipping false without `exited` as 127, and `recoverStaleCloak` clears leftover `cloaking`+`transactionBusy` so the bar cannot stay stuck ON AIR.

## Helper

- Tribunal deleted the Go PipeWire daemon. Detection is compositor IPC + `pw-dump`.
- The competition brief still asked for a helper binary: Rust `cloak-probe` + POSIX `compat/cloak-probe.sh`. QML never requires it. This Mac has no Linux cross-toolchain, so no Linux binary is committed. `.github/workflows/ci.yml` builds and uploads `cloak-probe` on Ubuntu; Omarchy users run `./build.sh`.
- The install path is `omarchy plugin add <git-url>` (a git clone of HEAD). A prebuilt `dist/*.tar.gz` is **not** committed — it goes stale. `scripts/pack-plugin.sh` writes a gitignored archive from current HEAD and fails if the file list diverges or if the tarball is git-tracked. Review-harness debris stays on disk (do not delete review logs).

## Demo GIF

- This packager cannot run Hyprland or Quickshell, so `demo.gif` is a constructed six-beat storyboard of the real IPC sequence (messy desktop → screencast event → vanish → ON AIR → restore), not a compositor screencast. README embeds both `preview.png` and `demo.gif`.

## Out of scope (intentional)

- Per-window live blur / pixelation.
- Wallpaper file swap (v1.1).
- Hyprland submap to disable unsafe workspace binds.
- Rehearse-mode screencopy preview.
- dunst / non-mako notification managers.
- A second Quickshell process.
- Writing Hyprland config except a first-load auto-assign that appends a marked `o.bind` block to `~/.config/hypr/bindings.lua` after checking `hyprctl -j binds`. If any of this plugin's binds is already live, skip (no notify spam). Occupied combos are skipped or replaced with Super+Alt variants. Never `hl.unbind` of someone else's shortcut. Notify with `omarchy notification send` only after a successful write. Previously owned runtime Super+F9/F10 keyword binds (from an older auto-install) are still torn down on disable via `Quickshell.execDetached` of `compat/unbind-owned.sh`, which re-reads `hyprctl -j binds` and unbinds only exact owned exec commands (plugin id + expected method + empty arg). The helper outlives `Component.onDestruction`. Python3 missing or hyprctl failure → no unbind.
- Network, accounts, telemetry.
- Capturing a live compositor GIF on this Mac. Engine tests compare the full normalized client set after vanish/restore. `tests/live-roundtrip.sh` is for a Hyprland machine, not GitHub CI.
