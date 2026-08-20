# Assumptions

Conservative choices where the Omarchy / Quickshell / Hyprland API was not 100% certain. The rule: isolate the uncertainty behind a small adapter, prefer documented types (`Process`, `Socket`, `FileView`, `Hyprland`, `IpcHandler`, `PanelWindow`), and degrade.

## Plugin host

- **Entry points are `Item`s**, not `ShellRoot`. Overlay exposes `open(payloadJson)` and `close()` for `omarchy-shell shell summon` / `hide`. Taken from the Quattro shell reference and the first-party clipboard / image-picker pattern.
- **Injected properties** on load: `omarchyPath`, `shell`, `manifest`, `pluginRegistry` (and `bar` / `barWidgetRegistry` on bar widgets). Overlay and BarWidget still function if some of these are missing.
- **`keepLoaded: true`** so the overlay's layer-shell windows (plate + ON AIR frame) survive between summons, matching `omarchy.image-picker`. The spec JSON omitted this; the Quattro reference wins.
- **`barWidget` metadata block** (displayName / category / defaultSection / defaults / schema) is required by the reference when `kinds` includes `bar-widget`. The spec's example JSON omitted it; the reference wins.
- **Third-party service lookup is not first-party `shell.firstPartyServiceFor`.** Bar/overlay try, in order: `pluginRegistry.serviceFor`, `shell.serviceFor`, `shell.firstPartyServiceFor`, then `omarchy-shell shell call` / `shell.summon`. Display state is also shared via `.pragma library` JS in the same engine.
- **IPC verb** is `omarchy-shell shell call <id> <method> <arg>` and `shell summon <id> <payloadJson>`. README keybinds use that; we do not write `hyprland.conf`.
- **`IpcHandler` target** is the plugin id. A unique id avoids collisions with first-party short names. `shell call` is the primary path; IpcHandler is extra.
- **Settings are inline on the shell.json entry.** Widget booleans (`autoCloak`, `workspaceGuard`, `dimOthers`, `coverCards`) are declared as QML properties so the host can inject them. Marks are a growing list and live in `~/.local/state/share-cloak/marks.json` because a plugin cannot write `shell.json`. Seed `marks` on the entry is still accepted via `Config.applySettings`.

## Quickshell

- **`Hyprland.rawEvent`** is the documented socket2 feed (`event.name`, `event.data`). Used as the primary event source, including `screencast`.
- **`Socket { path; connected; parser: SplitParser }`** is opened only as a fallback if `Hyprland.rawEvent` has not fired within 2s. Connecting both would double-handle (Hyprland already holds socket2). SplitParser is the documented Quickshell.Io line reader (same family as Process stdout). If a host build rejects `parser` on Socket, auto-cloak still has the `pw-dump` 2s poll.
- **`Hyprland.eventSocketPath`** is preferred when building the Socket path; otherwise `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`.
- **`Hyprland.dispatch(request)`** is used for single catch-all moves. The cloak/uncloak transaction uses `hyprctl --batch` via `Process` as the spec requires. If `dispatch` throws, we fall back to a `Process` of `hyprctl dispatch`.
- **Layer surfaces.** Plate uses `WlrLayer.Background`; ON AIR frame / chip / cover cards / workspace-hidden plate use `WlrLayer.Overlay`. Click-through is an empty `mask: Region {}` plus `WlrKeyboardFocus.None`. If `PanelWindow.mask` is not that type on the pinned Quickshell, the frame may eat clicks; it still does not take keyboard focus.
- **One PanelWindow per role, no `Variants`.** The `screencast` event does not name a monitor. The overlay lands on the output Quickshell chooses when `screen` is unset (typically focused / primary). Multi-output framing is undisclosed as 1.0 scope.
- **Theme tokens** `Color.menu.*`, `Color.accent`, `Style.*`, `Border.*`, `WidgetButton`, `BarWidget`, `BorderSurface`, `PanelWindow`, `WlrLayershell` — copied from first-party clipboard / clock / desktop-undo. Reduced motion: `Style.reduceMotion` if present, else `OMARCHY_REDUCED_MOTION=1`.
- **`.pragma library` JS** is shared across Service, Overlay, and BarWidget in one engine. Tests strip the pragma and eval under Node.

## Hyprland

- **`screencast>>STATE,OWNER`** as documented on the 2026 wiki: state `0/1`, owner `0` = monitor / output share, `1` = window share. If a pinned build emits only `STATE`, owner defaults to monitor. Day-1 verification on Omarchy's Hyprland is still required; `pw-dump` polling auto-engages if the event never fires.
- Socket2 `openwindow`, `workspace` / `workspacev2`, `movewindow` / `movewindowv2`, `closewindow` match the wiki. The workspace guard decides **synchronously from the event payload** (no `hyprctl` round-trip), so safe-list switches do not flicker.
- Special workspace name is `special:cloak`. Restore uses `movetoworkspacesilent <original>,address:0x…`. Floating geometry restore uses `movewindowpixel exact` / `resizewindowpixel exact`.
- Dim-others is `hyprctl --batch` of `setprop address:0x… alpha 0.85`. `dimaround` is off by default (`Config.dimaround`); the spec listed it as an option next to alpha. Undo is `setprop … alpha 1` for owned addresses.
- Address spelling is normalized to lowercase `0x…`.
- `hyprctl -j clients`, `hyprctl -j monitors`, `hyprctl -j workspaces`, `hyprctl -j activewindow`, `hyprctl -j version` exist.

## Mako

- Syntax assumed: `makoctl mode` lists modes; `makoctl mode -a <name>` adds; `makoctl mode -r <name>` removes. Candidate names: `dnd`, `do-not-disturb`, `donotdisturb`, `away`, `silent`. If none of those appear, the notification step degrades to the visible `notifications: unmanaged` note. Exact Omarchy-shipped mode name is a day-1 check.

## Helper

- The spec and tribunal **deleted the Go PipeWire helper**. Detection is compositor IPC (`screencast`) with `pw-dump` as fallback, using the CLI already on PATH.
- The competition brief still asked for a helper binary + `build.sh` + missing-binary fallback. Both ship: Rust `src/cloak-probe` → `bin/cloak-probe`, POSIX `compat/cloak-probe.sh`. The helper is **not** a PipeWire daemon. It parses `pw-dump`, chmods session files to `0600`, and diffs `hyprctl clients -j` snapshots. QML never requires it.
- `FileView.setText` does not document mode 0600, so after each save we run `cloak-probe secure <path>`.

## Out of scope (intentional)

- Per-window live blur / pixelation (tribunal: vanish is the only protection claim).
- Wallpaper file swap (v1.1, feature-detected).
- Hyprland submap to disable unsafe workspace binds (tribunal rejected).
- Rehearse-mode screencopy preview (tribunal rejected).
- dunst / non-mako notification managers.
- A second Quickshell process.
- Writing Hyprland config.
- Network, accounts, telemetry.
- A live GIF of the demo (this machine cannot run Hyprland / Quickshell). `preview.png` is a still.
