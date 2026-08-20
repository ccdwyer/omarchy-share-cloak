#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const JS = path.join(ROOT, "js")
const FIX = path.join(__dirname, "fixtures")

function loadEngine(file) {
  const src = fs
    .readFileSync(path.join(JS, file), "utf8")
    .replace(/^\.pragma library\s*\n/, "")
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    RegExp,
    Error,
    exports: {},
    module: { exports: {} }
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: file })
  const exported = {}
  for (const key of Object.keys(sandbox)) {
    if (
      [
        "console",
        "Date",
        "Math",
        "JSON",
        "String",
        "Number",
        "Array",
        "Object",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "RegExp",
        "Error",
        "exports",
        "module"
      ].indexOf(key) >= 0
    )
      continue
    exported[key] = sandbox[key]
  }
  return exported
}

const Events = loadEngine("Events.js")
const Clients = loadEngine("Clients.js")
const Marks = loadEngine("Marks.js")
const PwDump = loadEngine("PwDump.js")
const Hypr = loadEngine("Hypr.js")
const Binds = loadEngine("Binds.js")
const Mako = loadEngine("Mako.js")
const Session = loadEngine("Session.js")
const State = loadEngine("State.js")
const Config = loadEngine("Config.js")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    Config.reset()
    State.reset()
    fn()
    passed += 1
    process.stdout.write("ok  " + name + "\n")
  } catch (err) {
    failed += 1
    process.stderr.write("FAIL " + name + "\n" + (err && err.stack ? err.stack : err) + "\n")
  }
}

function fixture(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8")
}

function jsonFix(name) {
  return JSON.parse(fixture(name))
}

test("events: screencast monitor on", () => {
  const ev = Events.parseLine(fixture("socket2-screencast-on.txt").trim())
  assert.strictEqual(ev.name, "screencast")
  assert.strictEqual(ev.fields.state, 1)
  assert.strictEqual(ev.fields.owner, 0)
  assert.strictEqual(ev.fields.shareKind, "monitor")
  assert.strictEqual(ev.fields.active, true)
})

test("events: screencast window on", () => {
  const ev = Events.parseLine(fixture("socket2-screencast-window.txt").trim())
  assert.strictEqual(ev.fields.shareKind, "window")
  assert.strictEqual(ev.fields.owner, 1)
  assert.strictEqual(ev.fields.active, true)
})

test("events: screencast off", () => {
  const ev = Events.parseLine(fixture("socket2-screencast-off.txt").trim())
  assert.strictEqual(ev.fields.active, false)
  assert.strictEqual(ev.fields.state, 0)
})

test("events: openwindow splits class and title", () => {
  const ev = Events.parseLine(fixture("socket2-openwindow.txt").trim())
  assert.strictEqual(ev.fields.address, "0x64cea2525760")
  assert.strictEqual(ev.fields.class, "Signal")
  assert.ok(ev.fields.title.indexOf("Chris") >= 0)
  assert.strictEqual(ev.fields.workspace, "1")
})

test("events: workspacev2 safe and unsafe", () => {
  const safe = Events.parseLine(fixture("socket2-workspace-safe.txt").trim())
  const unsafe = Events.parseLine(fixture("socket2-workspace-unsafe.txt").trim())
  assert.strictEqual(safe.fields.workspaceId, 1)
  assert.strictEqual(unsafe.fields.workspaceId, 3)
  assert.strictEqual(unsafe.fields.workspace, "3")
})

test("events: unknown event is skipped, not thrown", () => {
  const ev = Events.parseLine("activelayout>>US,qwerty")
  assert.strictEqual(ev.kind, "unknown")
  assert.strictEqual(ev.name, "activelayout")
})

test("clients: capture messy desktop", () => {
  const clients = Clients.captureAll(Clients.parseClients(fixture("clients-messy.json")))
  assert.strictEqual(clients.length, 3)
  assert.strictEqual(clients[0].class, "Signal")
  assert.strictEqual(clients[2].floating, true)
  assert.strictEqual(Clients.focused(jsonFix("clients-messy.json")).class, "firefox")
})

test("clients: round-trip identical snapshots is empty diff", () => {
  const raw = fixture("clients-messy.json")
  const diffs = Clients.roundTripDiff(raw, raw)
  assert.strictEqual(diffs.length, 0)
})

test("clients: cloaked vs messy is a workspace change", () => {
  const diffs = Clients.roundTripDiff(fixture("clients-messy.json"), fixture("clients-cloaked.json"))
  assert.ok(diffs.length >= 2)
  const signal = diffs.filter((d) => d.address === "0x64cea2525760")[0]
  assert.ok(signal)
  assert.ok(signal.fields.indexOf("workspaceName") >= 0)
})

test("clients: safe workspaces from monitors", () => {
  const safe = Clients.safeWorkspacesFromMonitors(jsonFix("monitors-one.json"))
  assert.strictEqual(safe.length, 1)
  assert.strictEqual(safe[0].name, "1")
  assert.strictEqual(safe[0].id, 1)
})

test("marks: Signal class stays marked forever", () => {
  let rules = []
  rules = Marks.addClass(rules, "Signal", ".*")
  assert.strictEqual(Marks.classIsMarked("Signal", rules), true)
  assert.strictEqual(
    Marks.isMarked({ class: "Signal", title: "literally anything" }, rules),
    true
  )
  assert.strictEqual(Marks.isMarked({ class: "firefox", title: "Signal" }, rules), false)
})

test("marks: title regex and invalid regex degrade", () => {
  const rules = [{ class: "Code", title: "\\.env" }]
  assert.ok(Marks.isMarked({ class: "Code", title: ".env — secrets" }, rules))
  const bad = Marks.compileTitle("(")
  assert.strictEqual(bad.ok, false)
  assert.ok(Marks.isMarked({ class: "Code", title: "foo ( bar" }, [{ class: "Code", title: "(" }]))
})

test("marks: Super+F10 class mark warns when siblings are tiled", () => {
  const clients = [
    { class: "foot", title: "a", floating: false },
    { class: "foot", title: "b", floating: false },
    { class: "foot", title: "c", floating: true },
    { class: "google-chrome", title: "x", floating: false }
  ]
  assert.strictEqual(Marks.tiledClassCount(clients, "foot"), 2)
  assert.strictEqual(Marks.tiledClassCount(clients, "google-chrome"), 1)
  assert.ok(Marks.markNotice("foot", 2).indexOf("2 tiled windows will vanish") >= 0)
  assert.ok(Marks.markNotice("foot", 2).indexOf("tiles them back") >= 0)
  assert.strictEqual(Marks.markNotice("Signal", 0), "marked Signal")
})

test("marks: toggle class is idempotent add/remove", () => {
  let rules = Marks.toggleClass([], "Signal")
  assert.strictEqual(rules.length, 1)
  rules = Marks.toggleClass(rules, "Signal")
  assert.strictEqual(rules.length, 0)
})

test("pwdump: webcam-only is a negative (no trigger)", () => {
  const d = PwDump.detect(fixture("pw-dump-webcam.json"))
  assert.strictEqual(d.screencasting, false)
  assert.strictEqual(d.webcamOnly, true)
  assert.strictEqual(d.webcamCount, 1)
})

test("pwdump: portal screencast triggers", () => {
  const d = PwDump.detect(fixture("pw-dump-screencast.json"))
  assert.strictEqual(d.screencasting, true)
  assert.strictEqual(d.windowShare, false)
  assert.strictEqual(d.webcamOnly, false)
})

test("pwdump: idle audio does not trigger", () => {
  const d = PwDump.detect(fixture("pw-dump-idle.json"))
  assert.strictEqual(d.screencasting, false)
  assert.strictEqual(d.webcamCount, 0)
})

test("pwdump: webcam + screencast still triggers", () => {
  const d = PwDump.detect(fixture("pw-dump-webcam-and-screencast.json"))
  assert.strictEqual(d.screencasting, true)
  assert.strictEqual(d.webcamOnly, false)
  assert.strictEqual(d.webcamCount, 1)
})

test("pwdump: window share flag from portal source", () => {
  const d = PwDump.detect(fixture("pw-dump-window-share.json"))
  assert.strictEqual(d.screencasting, true)
  assert.strictEqual(d.windowShare, true)
})

test("hypr: cloak batch vanishes every marked window onto special:cloak", () => {
  const clients = Clients.captureAll(jsonFix("clients-messy.json"))
  const marked = Marks.markedClients(clients, [
    { class: "Signal", title: ".*" },
    { class: "Code", title: ".*" }
  ])
  const unmarked = Marks.unmarkedClients(clients, [
    { class: "Signal", title: ".*" },
    { class: "Code", title: ".*" }
  ])
  const cmds = Hypr.cloakCommands(marked, unmarked, { dimOthers: true, dimAlpha: 0.85 })
  const batch = Hypr.formatBatch(cmds)
  assert.ok(batch.indexOf('hl.dsp.window.move({ workspace = "special:cloak", follow = false, window = "address:0x64cea2525760" })') >= 0)
  assert.ok(batch.indexOf('hl.dsp.window.move({ workspace = "special:cloak", follow = false, window = "address:0x64cea2526000" })') >= 0)
  assert.ok(batch.indexOf("movetoworkspacesilent") < 0)
  assert.ok(batch.indexOf("setprop address:0x64cea2525760 alpha 0") < 0)
  assert.ok(batch.indexOf("nofocus 1") < 0)
  assert.ok(batch.indexOf("setprop address:0x64cea2527000 alpha 0.85") >= 0)
  assert.ok(batch.indexOf('window = "address:0x64cea2527000"') < 0)
})

test("hypr: tiled restore is workspace + settiled, not pixel geometry", () => {
  const clients = Clients.captureAll(jsonFix("clients-messy.json"))
  const marked = Marks.markedClients(clients, [
    { class: "Signal", title: ".*" },
    { class: "Code", title: ".*" }
  ])
  assert.ok(Hypr.cannotRestoreTiled(marked))
  const floatingOnly = marked.filter((c) => c.floating)
  assert.strictEqual(Hypr.cannotRestoreTiled(floatingOnly), false)
  const cmds = Hypr.restoreCommands({
    steps: [
      {
        kind: "move",
        address: "0xaaa",
        fromWorkspace: "1",
        fromWorkspaceId: 1,
        floating: false,
        at: [40, 48],
        size: [720, 900]
      }
    ]
  })
  const batch = Hypr.formatBatch(cmds)
  assert.ok(batch.indexOf('hl.dsp.window.move({ workspace = "1", follow = false, window = "address:0xaaa" })') >= 0)
  assert.ok(batch.indexOf("hl.dsp.window.float({ action = \"disable\", window = \"address:0xaaa\" })") >= 0)
  assert.ok(batch.indexOf("x = 40") < 0)
  assert.ok(batch.indexOf("x = 720") < 0)
})

test("hypr: restore floating geometry after move", () => {
  const cmds = Hypr.restoreCommands({
    steps: [
      {
        kind: "move",
        address: "0xabc",
        fromWorkspace: "2",
        floating: true,
        at: [10, 20],
        size: [300, 200]
      }
    ]
  })
  const batch = Hypr.formatBatch(cmds)
  assert.ok(batch.indexOf('hl.dsp.window.move({ workspace = "2", follow = false, window = "address:0xabc" })') >= 0)
  assert.ok(batch.indexOf("hl.dsp.window.float({ action = \"enable\", window = \"address:0xabc\" })") >= 0)
  assert.ok(batch.indexOf("hl.dsp.window.move({ x = 10, y = 20, relative = false, window = \"address:0xabc\" })") >= 0)
  assert.ok(batch.indexOf("hl.dsp.window.resize({ x = 300, y = 200, relative = false, window = \"address:0xabc\" })") >= 0)
  assert.ok(batch.indexOf("movewindowpixel") < 0)
  assert.ok(batch.indexOf("resizewindowpixel") < 0)
})

test("hypr: restore moves every vanished window back", () => {
  const cmds = Hypr.restoreCommands({
    steps: [
      {
        kind: "move",
        address: "0xaaa",
        fromWorkspace: "1",
        fromWorkspaceId: 1,
        floating: false,
        at: [40, 48],
        size: [720, 900]
      }
    ]
  })
  const batch = Hypr.formatBatch(cmds)
  assert.ok(batch.indexOf('hl.dsp.window.move({ workspace = "1", follow = false, window = "address:0xaaa" })') >= 0)
  assert.ok(batch.indexOf("hl.dsp.window.float({ action = \"disable\", window = \"address:0xaaa\" })") >= 0)
  assert.ok(batch.indexOf("settiled") < 0)
})

test("hypr: luaString and dispatchMoveArgv emit 0.56 tables", () => {
  assert.strictEqual(Hypr.luaString('special:cloak'), '"special:cloak"')
  assert.strictEqual(Hypr.luaString('a"b\\c'), '"a\\"b\\\\c"')
  const argv = Hypr.dispatchMoveArgv("0xABC")
  assert.strictEqual(argv[0], "hyprctl")
  assert.strictEqual(argv[1], "dispatch")
  assert.strictEqual(
    argv[2],
    'hl.dsp.window.move({ workspace = "special:cloak", follow = false, window = "address:0xabc" })'
  )
  assert.strictEqual(
    Hypr.fullscreenStateCmd("0xabc", 2, 1),
    'dispatch hl.dsp.window.fullscreen_state({ internal = 2, client = 1, action = "set", window = "address:0xabc" })'
  )
})

test("binds: expectedArg is IpcHandler, not shell call", () => {
  const id = "io.github.chris.share-cloak"
  assert.strictEqual(Binds.expectedArg(id, "toggle"), "omarchy-shell io.github.chris.share-cloak toggle ''")
  assert.strictEqual(Binds.expectedArgDouble(id, "markFocused"), 'omarchy-shell io.github.chris.share-cloak markFocused ""')
  const argv = Binds.bindArgv("F9", "toggle")
  assert.strictEqual(argv[3], "SUPER,F9,exec,omarchy-shell io.github.chris.share-cloak toggle ''")
  assert.ok(argv[3].indexOf("shell call") < 0)
})

test("binds: conflict vs ours", () => {
  const binds = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "kitty" },
    { modmask: 64, key: "F10", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak markFocused ''" }
  ]
  const id = "io.github.chris.share-cloak"
  assert.ok(Binds.conflict(binds, 64, "F9", id, "toggle"))
  assert.strictEqual(Binds.conflict(binds, 64, "F10", id, "markFocused"), null)
  assert.ok(Binds.oursPresent(binds, 64, "F10", id, "markFocused"))
  assert.strictEqual(Binds.oursPresent(binds, 64, "F10", id, "toggle"), false)
})

test("binds: teardown unbinds only live plugin actions", () => {
  const owned = [{ key: "F9", method: "toggle" }, { key: "F10", method: "markFocused" }]
  const stillOurs = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak toggle ''" },
    { modmask: 64, key: "F10", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak markFocused ''" }
  ]
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind(owned, stillOurs, "io.github.chris.share-cloak")), JSON.stringify(["F9", "F10"]))
  const userRebound = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "kitty" },
    { modmask: 64, key: "F10", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak markFocused ''" }
  ]
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind(owned, userRebound, "io.github.chris.share-cloak")), JSON.stringify(["F10"]))
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind(owned, [], "io.github.chris.share-cloak")), JSON.stringify([]))
})

test("binds: mixed plugin+user combo is not unbound", () => {
  const owned = [{ key: "F9", method: "toggle" }, { key: "F10", method: "markFocused" }]
  const mixed = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak toggle ''" },
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "kitty" },
    { modmask: 64, key: "F10", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak markFocused ''" }
  ]
  const id = "io.github.chris.share-cloak"
  assert.ok(Binds.oursPresent(mixed, 64, "F9", id, "toggle"))
  assert.ok(Binds.conflict(mixed, 64, "F9", id, "toggle"))
  assert.strictEqual(Binds.exclusivelyOurs(mixed, 64, "F9", id, "toggle"), false)
  assert.strictEqual(Binds.exclusivelyOurs(mixed, 64, "F10", id, "markFocused"), true)
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind(owned, mixed, id)), JSON.stringify(["F10"]))
})

test("binds: same-plugin different method is not unbound", () => {
  const owned = [{ key: "F9", method: "toggle" }, { key: "F10", method: "markFocused" }]
  const id = "io.github.chris.share-cloak"
  const mixedMethod = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak toggle ''" },
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak status ''" },
    { modmask: 64, key: "F10", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak markFocused ''" }
  ]
  assert.ok(Binds.oursPresent(mixedMethod, 64, "F9", id, "toggle"))
  assert.ok(Binds.isOurs(mixedMethod[1], id, "status"))
  assert.strictEqual(Binds.isOurs(mixedMethod[1], id, "toggle"), false)
  assert.ok(Binds.conflict(mixedMethod, 64, "F9", id, "toggle"))
  assert.strictEqual(Binds.exclusivelyOurs(mixedMethod, 64, "F9", id, "toggle"), false)
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind(owned, mixedMethod, id)), JSON.stringify(["F10"]))
  const onlyStatus = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "omarchy-shell io.github.chris.share-cloak status ''" }
  ]
  assert.strictEqual(JSON.stringify(Binds.keysToUnbind([{ key: "F9", method: "toggle" }], onlyStatus, id)), JSON.stringify([]))
  const argv = Binds.unbindOwnedArgv("/plugin", id, owned)
  assert.strictEqual(argv[0], "sh")
  assert.ok(argv[1].indexOf("compat/unbind-owned.sh") >= 0)
  assert.strictEqual(argv[2], id)
  assert.ok(argv.indexOf("F9:toggle") >= 0)
  assert.ok(argv.indexOf("F10:markFocused") >= 0)
})

test("binds: empty live list offers preferred combos", () => {
  const p = Binds.plan([])
  assert.strictEqual(p.needed, true)
  assert.strictEqual(p.toAdd.length, 2)
  assert.strictEqual(p.toAdd[0].keys, "SUPER + F9")
  assert.strictEqual(p.toAdd[1].keys, "SUPER + F10")
  const lua = Binds.luaBlock(p.toAdd)
  assert.ok(lua.indexOf("o.bind(\"SUPER + F9\"") === 0)
  assert.ok(lua.indexOf("omarchy-shell io.github.chris.share-cloak toggle ''") >= 0)
  assert.ok(lua.indexOf("omarchy-shell io.github.chris.share-cloak markFocused ''") >= 0)
  assert.ok(lua.indexOf("shell call") < 0)
})

test("binds: skips occupied combos and uses an alternate", () => {
  const live = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "other", description: "voxtype" }
  ]
  const p = Binds.plan(live)
  assert.strictEqual(p.needed, true)
  const toggle = p.toAdd.filter((x) => x.desc === "Share Cloak toggle")[0]
  assert.ok(toggle)
  assert.strictEqual(toggle.chosen, "SUPER + ALT + F9")
  assert.ok(p.note.indexOf("SUPER + ALT + F9") >= 0)
})

test("binds: already-ours hides the offer", () => {
  const live = [
    { modmask: 64, key: "F9", dispatcher: "__lua", arg: "15", description: "Share Cloak toggle" }
  ]
  const p = Binds.plan(live)
  assert.strictEqual(p.needed, false)
  assert.strictEqual(p.already, 1)
})

test("binds: service auto-assigns on first scan, does not keyword-bind", () => {
  const src = fs.readFileSync(path.join(ROOT, "Service.qml"), "utf8")
  assert.ok(src.indexOf("function scanBinds") >= 0)
  assert.ok(src.indexOf("Qt.callLater(root.scanBinds)") >= 0)
  assert.ok(src.indexOf("Binds.claimAuto()") >= 0)
  assert.ok(src.indexOf("notifyNewBinds") >= 0)
  assert.ok(src.indexOf("compat/install-binds.py") >= 0)
  assert.ok(src.indexOf("Binds.bindArgv") < 0)
  assert.ok(src.indexOf("function installBinds") >= 0)
  assert.ok(src.indexOf("teardownBinds") >= 0)
  const overlay = fs.readFileSync(path.join(ROOT, "Overlay.qml"), "utf8")
  assert.ok(overlay.indexOf("Add keybindings") < 0)
  const bar = fs.readFileSync(path.join(ROOT, "BarWidget.qml"), "utf8")
  assert.ok(bar.indexOf("Add keybindings") < 0)
  assert.ok(bar.indexOf("text: \"keys\"") < 0)
})

test("binds: notify body lists assigned keys", () => {
  const body = Binds.notifyBody([{ chosen: "SUPER + F9", desc: "Share Cloak toggle" }], [])
  assert.ok(body.indexOf("SUPER + F9 — Share Cloak toggle") === 0)
  const argv = Binds.notifyArgv("Share Cloak", "Share Cloak keybindings", body)
  assert.strictEqual(argv[0], "omarchy")
  assert.strictEqual(argv[1], "notification")
  assert.strictEqual(argv[2], "send")
  assert.ok(Binds.claimAuto())
  assert.strictEqual(Binds.claimAuto(), false)
})

test("binds: skip when preferred and alternate are taken", () => {
  const live = [
    { modmask: 64, key: "F9", dispatcher: "exec", arg: "a", description: "taken" },
    { modmask: 72, key: "F9", dispatcher: "exec", arg: "b", description: "also taken" }
  ]
  const p = Binds.plan(live)
  assert.strictEqual(p.needed, true)
  assert.strictEqual(p.toAdd.filter((x) => x.desc === "Share Cloak toggle").length, 0)
  assert.ok(p.skipped.some((s) => s.keys === "SUPER + F9"))
  assert.ok(p.note.indexOf("skipped SUPER + F9") >= 0)
})

test("hypr: workspace names with separators fall back to id", () => {
  const tok = Hypr.workspaceToken("foo,bar", 4)
  assert.strictEqual(tok, "4")
  const tokSafe = Hypr.workspaceToken("special:cloak", -98)
  assert.strictEqual(tokSafe, "special:cloak")
  const named = Hypr.workspaceToken("code", 2)
  assert.strictEqual(named, "name:code")
})

test("mako: guessed names without config are unmanaged", () => {
  const info = Mako.inspect(fixture("mako-modes-default.txt"), 0, "")
  assert.strictEqual(info.alreadyActive, false)
  assert.strictEqual(info.needsAdd, false)
  assert.strictEqual(info.manager, "unmanaged")
  assert.strictEqual(info.ok, false)
})

test("mako: configured suppression mode not current is a candidate to add", () => {
  const info = Mako.inspect(fixture("mako-modes-none.txt"), 0, fixture("mako-config-dnd.txt"))
  assert.strictEqual(info.ok, true)
  assert.strictEqual(info.alreadyActive, false)
  assert.strictEqual(info.needsAdd, true)
  assert.strictEqual(info.applyMode, "dnd")
  assert.ok(info.tryModes.indexOf("dnd") >= 0)
  assert.strictEqual(JSON.stringify(Mako.applyArgv("dnd")), JSON.stringify(["makoctl", "mode", "-a", "dnd"]))
  assert.strictEqual(JSON.stringify(Mako.restoreArgv("dnd")), JSON.stringify(["makoctl", "mode", "-r", "dnd"]))
})

test("mako: configured suppression already current is managed without add", () => {
  const info = Mako.inspect(fixture("mako-modes-default.txt"), 0, fixture("mako-config-dnd.txt"))
  assert.strictEqual(info.alreadyActive, true)
  assert.strictEqual(info.needsAdd, false)
  assert.strictEqual(info.ok, true)
  assert.strictEqual(info.manager, "mako")
})

test("mako: configured mode without invisible is not suppression", () => {
  const info = Mako.inspect(fixture("mako-modes-none.txt"), 0, fixture("mako-config-nosuppress.txt"))
  assert.strictEqual(info.ok, false)
  assert.strictEqual(info.needsAdd, false)
  assert.strictEqual(info.manager, "unmanaged")
})

test("mako: criteria section between modes is not attributed to the previous mode", () => {
  const configured = Mako.parseSuppressionModes(fixture("mako-config-criteria-between.txt"))
  assert.ok(configured.indexOf("dnd") >= 0, "dnd keeps its own invisible=1")
  assert.ok(configured.indexOf("quiet") < 0, "quiet must not inherit urgency=low invisible")
})

test("mako: isVerifiedCurrent after remove", () => {
  assert.strictEqual(Mako.isVerifiedCurrent("default\ndnd\n", "dnd"), true)
  assert.strictEqual(Mako.isVerifiedCurrent("default\n", "dnd"), false)
})

test("mako: no config does not guess candidates", () => {
  const info = Mako.inspect(fixture("mako-modes-none.txt"), 0, "")
  assert.strictEqual(info.needsAdd, false)
  assert.strictEqual(info.tryModes.length, 0)
})

test("mako: missing binary is unmanaged", () => {
  const info = Mako.inspect("", 127)
  assert.strictEqual(info.manager, "unmanaged")
  assert.strictEqual(info.ok, false)
  assert.strictEqual(info.needsAdd, false)
})

test("mako: safeArgv wraps optional binaries through sh so Process always starts", () => {
  const argv = Mako.safeArgv(["makoctl", "mode", "-a", "dnd"])
  assert.ok(argv)
  assert.strictEqual(argv[0], "sh")
  assert.strictEqual(argv[1], "-c")
  assert.ok(argv[2].indexOf("command -v") >= 0)
  assert.ok(argv[2].indexOf("makoctl") >= 0)
  assert.ok(argv[2].indexOf("exit 127") >= 0)
  assert.strictEqual(JSON.stringify(Mako.modeArgv().slice(0, 2)), JSON.stringify(["sh", "-c"]))
  assert.strictEqual(Mako.safeArgv(null), null)
  assert.strictEqual(Mako.safeArgv([]), null)
})

test("mako: restore only a plugin-added mode", () => {
  const session = Session.create({ clients: [] })
  Session.recordMakoAdded(session, "dnd")
  const plan = Session.restorePlan(session, [])
  const mako = plan.steps.filter((s) => s.kind === "mako-mode")
  assert.strictEqual(mako.length, 1)
  assert.strictEqual(mako[0].pluginAdded, true)
  assert.strictEqual(mako[0].to, "dnd")
})

test("config: autoCloak default ON", () => {
  const snap = Config.snapshot()
  assert.strictEqual(snap.autoCloak, true)
  assert.strictEqual(snap.workspaceGuard, true)
  assert.strictEqual(snap.dimOthers, true)
})

test("config: settings from shell.json entry", () => {
  Config.applySettings({ autoCloak: false, dimAlpha: "0.5", safeWorkspaces: "1,2" })
  const snap = Config.snapshot()
  assert.strictEqual(snap.autoCloak, false)
  assert.strictEqual(snap.dimAlpha, 0.5)
  assert.strictEqual(JSON.stringify(snap.extraSafeWorkspaces), JSON.stringify(["1", "2"]))
})

test("config: load marks file", () => {
  Config.loadMarks(fixture("marks.json"))
  const snap = Config.snapshot()
  assert.strictEqual(snap.marks.length, 2)
  assert.strictEqual(snap.marks[0].class, "Signal")
})

test("state: autoCloak arms watching, cloak is ON AIR", () => {
  State.armFromAutoCloak(true)
  assert.strictEqual(State.barState(), "armed")
  assert.strictEqual(State.chipLabel(), "CLOAK")
  State.enterCloaked("screencast")
  assert.strictEqual(State.barState(), "onair")
  assert.strictEqual(State.chipLabel(), "ON AIR")
  State.enterUncloaking()
  State.enterResting(true)
  assert.strictEqual(State.barState(), "armed")
})

test("state: workspace guard uses event payload, no flicker on safe", () => {
  const safe = [{ id: 1, name: "1" }]
  assert.strictEqual(State.isSafeWorkspace(1, "1", safe), true)
  assert.strictEqual(State.isSafeWorkspace(3, "3", safe), false)
  assert.strictEqual(State.isSafeWorkspace(-98, "special:cloak", safe), true)
})

test("state: window-share headline is a warning", () => {
  State.enterCloaked("screencast")
  State.setShare(true, "window", "screencast")
  const line = State.overlayHeadline()
  assert.ok(line.indexOf("WINDOW SHARE") >= 0)
})

test("session: cloak records owned moves and restore reverses them", () => {
  const clients = Clients.captureAll(jsonFix("clients-messy.json"))
  const marked = Marks.markedClients(clients, jsonFix("marks.json").marks)
  const session = Session.create({
    reason: "screencast",
    share: { kind: "monitor", owner: 0, source: "screencast" },
    safeWorkspaces: [{ id: 1, name: "1" }],
    clients
  })
  Session.recordMoves(session, marked)
  const unmarked = Marks.unmarkedClients(clients, jsonFix("marks.json").marks).map((c) => {
    const copy = JSON.parse(JSON.stringify(c))
    copy.alpha = 1
    return copy
  })
  Session.recordDims(session, unmarked, 0.85, false)
  assert.ok(session.mutations.length >= 3)
  const live = marked.map((c) => {
    const copy = JSON.parse(JSON.stringify(c))
    copy.workspace = { id: -98, name: "special:cloak" }
    copy.workspaceName = "special:cloak"
    copy.workspaceId = -98
    return copy
  }).concat(unmarked)
  const plan = Session.restorePlan(session, live)
  const moves = plan.steps.filter((s) => s.kind === "move")
  assert.strictEqual(moves.length, 2)
  assert.strictEqual(plan.unrestorable.length, 0)
})

test("session: user move while cloaked is preserved (ownership drop)", () => {
  const session = Session.load(fixture("session-v1.json")).session
  const live = Clients.captureAll(jsonFix("clients-after-user-move.json"))
  const plan = Session.restorePlan(session, live)
  const moveAddrs = plan.steps.filter((s) => s.kind === "move").map((s) => s.address)
  assert.ok(moveAddrs.indexOf("0x64cea2526000") >= 0, "still-owned Code is restored")
  assert.ok(moveAddrs.indexOf("0x64cea2525760") < 0, "user-moved Signal is not yanked back")
})

test("session: gone window is unrestorable, not silent", () => {
  const session = Session.load(fixture("session-v1.json")).session
  const live = Clients.captureAll(jsonFix("clients-gone.json"))
  const plan = Session.restorePlan(session, live)
  assert.ok(plan.unrestorable.length >= 2)
  const reasons = plan.unrestorable.map((u) => u.reason)
  assert.ok(reasons.indexOf("gone") >= 0)
})

test("session: catch-all records new marked-class window", () => {
  const session = Session.create({ clients: [] })
  const ev = Events.parseLine(fixture("socket2-openwindow.txt").trim())
  Session.recordCatchAll(session, ev.fields)
  assert.strictEqual(session.mutations[0].kind, "catch-all-move")
  assert.strictEqual(session.mutations[0].address, "0x64cea2525760")
  assert.strictEqual(session.mutations[0].toWorkspace, "special:cloak")
})

test("session: invalid json does not throw", () => {
  const result = Session.load("not-json")
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.error, "invalid-json")
})

test("session: cover cards only for owned moves on the current workspace", () => {
  const session = Session.load(fixture("session-v1.json")).session
  const cards = Session.coverCards(session, "1")
  assert.strictEqual(cards.length, 2)
  assert.strictEqual(Session.coverCards(session, "9").length, 0)
})

test("settings: empty apply does not overwrite widget false", () => {
  Config.applySettings({ autoCloak: false, dimOthers: false, coverCards: false, workspaceGuard: false })
  Config.applySettings({})
  const snap = Config.snapshot()
  assert.strictEqual(snap.autoCloak, false)
  assert.strictEqual(snap.dimOthers, false)
  assert.strictEqual(snap.coverCards, false)
  assert.strictEqual(snap.workspaceGuard, false)
})

test("session: dim is skipped when getprop was not captured", () => {
  const unmarked = [{ address: "0xabc", class: "firefox", title: "x", workspaceName: "1" }]
  const session = Session.create({ clients: unmarked })
  Session.recordDims(session, unmarked, 0.85, false)
  assert.strictEqual(session.mutations.filter((m) => m.kind === "alpha").length, 0)
})

test("session: stillOnCloak detects stranded restore", () => {
  const session = Session.load(fixture("session-v1.json")).session
  const stuck = Session.stillOnCloak(session, jsonFix("clients-cloaked.json"))
  assert.ok(stuck.length >= 2)
  const restored = Session.stillOnCloak(session, jsonFix("clients-messy.json"))
  assert.strictEqual(restored.length, 0)
})

test("clients: parseClientsResult requires valid json array and exit 0", () => {
  const bad = Clients.parseClientsResult("nope", 0)
  assert.strictEqual(bad.ok, false)
  const fail = Clients.parseClientsResult(fixture("clients-messy.json"), 1)
  assert.strictEqual(fail.ok, false)
  const ok = Clients.parseClientsResult(fixture("clients-messy.json"), 0)
  assert.strictEqual(ok.ok, true)
  assert.ok(ok.clients.length >= 3)
})

test("session: dim snapshots prior alpha and drops ownership when live differs", () => {
  const unmarked = [{ address: "0xabc", class: "firefox", title: "x", alpha: 0.4, workspaceName: "1" }]
  const session = Session.create({ clients: unmarked })
  Session.recordDims(session, unmarked, 0.85, false)
  const dim = session.mutations.filter((m) => m.kind === "alpha")[0]
  assert.strictEqual(dim.from, 0.4)
  assert.strictEqual(dim.to, 0.85)
  const stillOurs = Session.restorePlan(session, [{ address: "0xabc", alpha: 0.85, workspace: { id: 1, name: "1" } }])
  assert.strictEqual(stillOurs.steps.filter((s) => s.kind === "alpha").length, 1)
  const session2 = Session.create({ clients: unmarked })
  Session.recordDims(session2, unmarked, 0.85, false)
  const userChanged = Session.restorePlan(session2, [{ address: "0xabc", alpha: 0.2, workspace: { id: 1, name: "1" } }])
  assert.strictEqual(userChanged.steps.filter((s) => s.kind === "alpha").length, 0)
})

test("clients: markedStillVisible catches a failed cloak move", () => {
  const marked = Clients.captureAll(jsonFix("clients-messy.json")).filter((c) => c.class === "firefox")
  const leaked = Clients.markedStillVisible(marked, jsonFix("clients-messy.json"))
  assert.strictEqual(leaked.length, 1)
  const hidden = Clients.markedStillVisible(
    marked,
    jsonFix("clients-messy.json").map((c) => {
      if (c.class !== "firefox")
        return c
      const copy = JSON.parse(JSON.stringify(c))
      copy.workspace = { id: -98, name: "special:cloak" }
      return copy
    })
  )
  assert.strictEqual(hidden.length, 0)
})

test("clients: tiledLayoutChanged is empty when geom is unchanged", () => {
  const tiled = Clients.captureAll(jsonFix("clients-messy.json")).filter((c) => !c.floating)
  assert.strictEqual(Clients.tiledLayoutChanged(tiled, jsonFix("clients-messy.json")).length, 0)
  assert.ok(Clients.tiledLayoutChanged(tiled, jsonFix("clients-cloaked.json")).length >= 1)
})

test("state: unrestorable toast survives enterResting(keepToast)", () => {
  State.setUnrestorable([{ address: "0x1", reason: "gone" }])
  var snap = State.snapshot()
  assert.ok(snap.toast.indexOf("could not be restored") >= 0)
  State.enterResting(true, true)
  snap = State.snapshot()
  assert.ok(snap.unrestorable.length === 1)
  assert.ok(snap.toast.length > 0)
  State.enterResting(true, false)
  snap = State.snapshot()
  assert.strictEqual(snap.unrestorable.length, 0)
})

test("hypr: parseGetprop and splitBatch", () => {
  assert.strictEqual(Hypr.parseGetprop("0.85"), 0.85)
  assert.strictEqual(Hypr.parseGetprop("alpha = 1"), 1)
  const parts = Hypr.splitBatch("dispatch a ; setprop b alpha 0.85")
  assert.strictEqual(parts.length, 2)
})

function randInt(n) {
  return Math.floor(Math.random() * n)
}

function randomClients(seed, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const addr = "0x" + (0x1000 + seed * 50 + i).toString(16)
    const ws = 1 + (i % 3)
    out.push({
      address: addr,
      class: i % 4 === 0 ? "Signal" : i % 4 === 1 ? "Code" : "firefox",
      title: "win-" + i,
      workspace: { id: ws, name: String(ws) },
      workspaceId: ws,
      workspaceName: String(ws),
      at: [i * 10, i * 8],
      size: [400, 300],
      floating: i % 5 === 0,
      fullscreen: 0,
      monitor: 0,
      pinned: false,
      alpha: 1,
      dimaround: 0
    })
  }
  return out
}

function applyCloakSim(clients, session) {
  const byAddr = {}
  clients.forEach((c) => {
    byAddr[c.address] = JSON.parse(JSON.stringify(c))
  })
  session.mutations.forEach((m) => {
    if (!m.owned)
      return
    const live = byAddr[m.address]
    if (!live)
      return
    if (m.kind === "move" || m.kind === "catch-all-move") {
      live.workspace = { id: -98, name: "special:cloak" }
      live.workspaceName = "special:cloak"
      live.workspaceId = -98
    }
    if (m.kind === "alpha")
      live.alpha = m.to
    if (m.kind === "dimaround")
      live.dimaround = m.to
  })
  return Object.keys(byAddr).map((k) => byAddr[k])
}

function applyRestoreSim(clients, plan) {
  const byAddr = {}
  clients.forEach((c) => {
    byAddr[c.address] = JSON.parse(JSON.stringify(c))
  })
  plan.steps.forEach((s) => {
    const live = byAddr[s.address]
    if (!live)
      return
    if (s.kind === "move" || s.kind === "catch-all-move") {
      live.workspace = { id: s.fromWorkspaceId || Number(s.fromWorkspace) || 1, name: s.fromWorkspace }
      live.workspaceName = s.fromWorkspace
      live.workspaceId = s.fromWorkspaceId || Number(s.fromWorkspace) || 1
      if (s.at)
        live.at = s.at.slice()
      if (s.size)
        live.size = s.size.slice()
      live.floating = !!s.floating
    }
    if (s.kind === "alpha")
      live.alpha = s.from
    if (s.kind === "dimaround")
      live.dimaround = s.from
  })
  return Object.keys(byAddr).map((k) => byAddr[k])
}

test("round-trip soak: 200 randomized cloak/uncloak cycles with ownership", () => {
  const marks = [
    { class: "Signal", title: ".*" },
    { class: "Code", title: ".*" }
  ]
  for (let cycle = 0; cycle < 200; cycle++) {
    const n = 3 + (cycle % 6)
    const original = randomClients(cycle + 1, n)
    const session = Session.create({
      clients: original,
      safeWorkspaces: [{ id: 1, name: "1" }]
    })
    const marked = Marks.markedClients(original, marks)
    const unmarked = Marks.unmarkedClients(original, marks)
    Session.recordMoves(session, marked)
    Session.recordDims(session, unmarked, 0.85, false)
    if (cycle % 7 === 0 && marked.length) {
      Session.recordCatchAll(session, {
        address: "0xcafe" + cycle.toString(16),
        class: "Signal",
        title: "dialog",
        workspace: "1",
        floating: true
      })
    }
    let live = applyCloakSim(original, session)
    const leaked = Clients.markedStillVisible(marked, live)
    assert.strictEqual(leaked.length, 0, "cycle " + cycle + " leaked marked windows")

    if (cycle % 5 === 0 && marked.length) {
      const victim = marked[0]
      live = live.map((c) => {
        if (c.address !== victim.address)
          return c
        const copy = JSON.parse(JSON.stringify(c))
        copy.workspace = { id: 2, name: "2" }
        copy.workspaceName = "2"
        copy.workspaceId = 2
        return copy
      })
    }
    if (cycle % 6 === 0 && unmarked.length) {
      const u = unmarked[0]
      live = live.map((c) => {
        if (c.address !== u.address)
          return c
        const copy = JSON.parse(JSON.stringify(c))
        copy.alpha = 0.11
        return copy
      })
    }
    if (cycle % 11 === 0 && live.length) {
      live = live.filter((_, i) => i !== 0)
    }

    const plan = Session.restorePlan(session, live)
    const restored = applyRestoreSim(live, plan)
    const restoredMap = {}
    restored.forEach((c) => {
      restoredMap[c.address] = c
    })
    original.forEach((c) => {
      const now = restoredMap[c.address]
      if (!now)
        return
      const wasUserMoved = cycle % 5 === 0 && marked[0] && c.address === marked[0].address
      const wasUserDimmed = cycle % 6 === 0 && unmarked[0] && c.address === unmarked[0].address
      if (wasUserMoved) {
        assert.strictEqual(now.workspaceName, "2", "cycle " + cycle + " user move preserved")
        return
      }
      if (Marks.isMarked(c, marks)) {
        assert.strictEqual(now.workspaceName, c.workspaceName, "cycle " + cycle + " marked round-trip")
        assert.strictEqual(!!now.floating, !!c.floating, "cycle " + cycle + " floating flag")
        if (c.floating) {
          assert.strictEqual(JSON.stringify(now.at), JSON.stringify(c.at), "cycle " + cycle + " float geom x/y")
          assert.strictEqual(JSON.stringify(now.size), JSON.stringify(c.size), "cycle " + cycle + " float geom size")
        }
      }
      if (wasUserDimmed)
        assert.strictEqual(now.alpha, 0.11, "cycle " + cycle + " user dim preserved")
      else if (!Marks.isMarked(c, marks))
        assert.strictEqual(now.alpha, 1, "cycle " + cycle + " dim restored")
    })
  }
})

test("round-trip soak: 200 floating vanish/restore cycles", () => {
  const marks = [
    { class: "Signal", title: ".*" },
    { class: "Code", title: ".*" }
  ]
  for (let cycle = 0; cycle < 200; cycle++) {
    const n = 3 + (cycle % 6)
    const original = randomClients(cycle + 1, n).map((c) => {
      const copy = JSON.parse(JSON.stringify(c))
      copy.floating = true
      return copy
    })
    const session = Session.create({
      clients: original,
      safeWorkspaces: [{ id: 1, name: "1" }]
    })
    const marked = Marks.markedClients(original, marks)
    const unmarked = Marks.unmarkedClients(original, marks)
    assert.strictEqual(Hypr.cannotRestoreTiled(marked), false)
    Session.recordMoves(session, marked)
    Session.recordDims(session, unmarked, 0.85, false)
    let live = applyCloakSim(original, session)
    const leaked = Clients.markedStillVisible(marked, live)
    assert.strictEqual(leaked.length, 0, "float cycle " + cycle + " leaked")
    const plan = Session.restorePlan(session, live)
    const restored = applyRestoreSim(live, plan)
    const restoredMap = {}
    restored.forEach((c) => {
      restoredMap[c.address] = c
    })
    original.forEach((c) => {
      const now = restoredMap[c.address]
      if (!now)
        return
      if (Marks.isMarked(c, marks)) {
        assert.strictEqual(now.workspaceName, c.workspaceName, "float cycle " + cycle + " marked round-trip")
        assert.strictEqual(JSON.stringify(now.at), JSON.stringify(c.at))
        assert.strictEqual(JSON.stringify(now.size), JSON.stringify(c.size))
      } else {
        assert.strictEqual(now.alpha, 1, "float cycle " + cycle + " dim restored")
      }
    })
  }
})

test("clients: markedStillVisible catches tiled windows left on the shared workspace", () => {
  const tiled = Clients.captureAll(jsonFix("clients-messy.json")).filter((c) => !c.floating)
  const leaked = Clients.markedStillVisible(tiled, jsonFix("clients-messy.json"))
  assert.strictEqual(leaked.length, 2)
})

function runProbe(args, stdin) {
  const sh = path.join(ROOT, "compat", "cloak-probe.sh")
  const res = spawnSync("sh", [sh].concat(args), {
    encoding: "utf8",
    input: stdin || undefined
  })
  return res
}

test("compat probe: pw-dump webcam negative", () => {
  const res = runProbe(["pw-dump", path.join(FIX, "pw-dump-webcam.json")])
  assert.strictEqual(res.status, 0, res.stderr)
  const json = JSON.parse(res.stdout.trim().split("\n").pop())
  assert.strictEqual(json.screencasting, false)
  assert.strictEqual(json.webcamOnly, true)
})

test("compat probe: pw-dump screencast positive", () => {
  const res = runProbe(["pw-dump", path.join(FIX, "pw-dump-screencast.json")])
  assert.strictEqual(res.status, 0, res.stderr)
  const json = JSON.parse(res.stdout.trim().split("\n").pop())
  assert.strictEqual(json.screencasting, true)
})

test("compat probe: clients-diff equal / unequal", () => {
  const same = runProbe([
    "clients-diff",
    path.join(FIX, "clients-messy.json"),
    path.join(FIX, "clients-messy.json")
  ])
  assert.strictEqual(same.status, 0, same.stderr)
  assert.strictEqual(JSON.parse(same.stdout.trim().split("\n").pop()).equal, true)
  const diff = runProbe([
    "clients-diff",
    path.join(FIX, "clients-messy.json"),
    path.join(FIX, "clients-cloaked.json")
  ])
  assert.strictEqual(JSON.parse(diff.stdout.trim().split("\n").pop()).equal, false)
})

test("compat probe: session-check cloaked", () => {
  const res = runProbe(["session-check", path.join(FIX, "session-v1.json")])
  assert.strictEqual(res.status, 0, res.stderr)
  const json = JSON.parse(res.stdout.trim().split("\n").pop())
  assert.strictEqual(json.ok, true)
  assert.strictEqual(json.cloaked, true)
})

test("compat probe: init-state + secure", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "share-cloak-"))
  const init = runProbe(["init-state", dir])
  assert.strictEqual(init.status, 0, init.stderr)
  assert.ok(fs.existsSync(path.join(dir, "session.json")))
  assert.ok(fs.existsSync(path.join(dir, "marks.json")))
  const sec = runProbe(["secure", path.join(dir, "session.json")])
  assert.strictEqual(sec.status, 0, sec.stderr)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("pack: dist tarball is not git-tracked", () => {
  const res = spawnSync("git", ["ls-files", "--", "dist/"], {
    encoding: "utf8",
    cwd: ROOT
  })
  assert.strictEqual(res.status, 0, res.stderr)
  assert.strictEqual(String(res.stdout || "").trim(), "", "do not commit dist/; Omarchy installs via git clone")
})

test("pack: on-disk archive must match HEAD if present", () => {
  const archive = path.join(ROOT, "dist", "share-cloak.git.tar.gz")
  if (!fs.existsSync(archive))
    return
  const tar = spawnSync("tar", ["tzf", archive], { encoding: "utf8" })
  assert.strictEqual(tar.status, 0, tar.stderr)
  const archived = tar.stdout
    .split("\n")
    .map((line) => line.replace(/^share-cloak\//, ""))
    .filter((line) => line && !line.endsWith("/"))
  const required = [
    "compat/unbind-owned.sh",
    "tests/fixtures/binds-mixed-method.json",
    "Service.qml"
  ]
  required.forEach((name) => {
    assert.ok(archived.indexOf(name) >= 0, "stale archive missing " + name)
  })
  const head = spawnSync("git", ["ls-files"], { encoding: "utf8", cwd: ROOT })
  assert.strictEqual(head.status, 0, head.stderr)
  const tracked = head.stdout.trim().split("\n").filter(Boolean)
  tracked.forEach((name) => {
    assert.ok(archived.indexOf(name) >= 0, "stale archive missing HEAD file " + name)
  })
})

process.stdout.write("\n" + passed + " passed, " + failed + " failed\n")
process.exit(failed ? 1 : 0)
