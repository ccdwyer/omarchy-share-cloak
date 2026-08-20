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

test("hypr: cloak batch moves marked, dims unmarked", () => {
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
  assert.ok(batch.indexOf("movetoworkspacesilent special:cloak,address:0x64cea2525760") >= 0)
  assert.ok(batch.indexOf("movetoworkspacesilent special:cloak,address:0x64cea2526000") >= 0)
  assert.ok(batch.indexOf("setprop address:0x64cea2527000 alpha 0.85") >= 0)
  assert.ok(batch.indexOf("0x64cea2527000") >= 0)
  assert.ok(batch.indexOf("special:cloak,address:0x64cea2527000") < 0)
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
  assert.ok(batch.indexOf("movetoworkspacesilent 2,address:0xabc") >= 0)
  assert.ok(batch.indexOf("movewindowpixel exact 10 20,address:0xabc") >= 0)
  assert.ok(batch.indexOf("resizewindowpixel exact 300 200,address:0xabc") >= 0)
})

test("mako: picks dnd when listed", () => {
  const info = Mako.inspect(fixture("mako-modes-default.txt"), 0)
  assert.strictEqual(info.ok, true)
  assert.strictEqual(info.manager, "mako")
  assert.strictEqual(info.applyMode, "dnd")
  assert.strictEqual(JSON.stringify(Mako.applyArgv("dnd")), JSON.stringify(["makoctl", "mode", "-a", "dnd"]))
  assert.strictEqual(JSON.stringify(Mako.restoreArgv("dnd")), JSON.stringify(["makoctl", "mode", "-r", "dnd"]))
})

test("mako: missing dnd mode is unmanaged note", () => {
  const info = Mako.inspect(fixture("mako-modes-none.txt"), 0)
  assert.strictEqual(info.ok, false)
  assert.ok(info.note.indexOf("unmanaged") >= 0)
})

test("mako: missing binary is unmanaged", () => {
  const info = Mako.inspect("", 127)
  assert.strictEqual(info.manager, "unmanaged")
  assert.strictEqual(info.ok, false)
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
  Session.recordDims(session, Marks.unmarkedClients(clients, jsonFix("marks.json").marks), 0.85, false)
  assert.ok(session.mutations.length >= 3)
  const live = Clients.captureAll(jsonFix("clients-cloaked.json"))
  const plan = Session.restorePlan(session, live)
  const moves = plan.steps.filter((s) => s.kind === "move")
  assert.strictEqual(moves.length, 2)
  assert.strictEqual(moves[0].fromWorkspace, "1")
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

test("round-trip soak sketch: cloak then restore plan yields original workspaces", () => {
  const original = Clients.captureAll(jsonFix("clients-messy.json"))
  const marks = jsonFix("marks.json").marks
  const session = Session.create({ clients: original, safeWorkspaces: [{ id: 1, name: "1" }] })
  Session.recordMoves(session, Marks.markedClients(original, marks))
  const cloaked = original.map((c) => {
    const copy = JSON.parse(JSON.stringify(c))
    if (Marks.isMarked(c, marks)) {
      copy.workspaceName = "special:cloak"
      copy.workspace = { id: -98, name: "special:cloak" }
    }
    return copy
  })
  const plan = Session.restorePlan(session, cloaked)
  const restoredName = {}
  plan.steps
    .filter((s) => s.kind === "move")
    .forEach((s) => {
      restoredName[s.address] = s.fromWorkspace
    })
  original.forEach((c) => {
    if (Marks.isMarked(c, marks))
      assert.strictEqual(restoredName[c.address], c.workspaceName)
  })
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

process.stdout.write("\n" + passed + " passed, " + failed + " failed\n")
process.exit(failed ? 1 : 0)
