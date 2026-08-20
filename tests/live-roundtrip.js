#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const JS = path.join(ROOT, "js")
const CYCLES = Number(process.env.SHARE_CLOAK_LIVE_CYCLES || 200)

function loadEngine(file) {
  const src = fs.readFileSync(path.join(JS, file), "utf8").replace(/^\.pragma library\s*\n/, "")
  const sandbox = {
    console, Date, Math, JSON, String, Number, Array, Object,
    parseInt, parseFloat, isNaN, isFinite, RegExp, Error
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: file })
  const exported = {}
  for (const key of Object.keys(sandbox)) {
    if (["console", "Date", "Math", "JSON", "String", "Number", "Array", "Object", "parseInt", "parseFloat", "isNaN", "isFinite", "RegExp", "Error"].indexOf(key) >= 0)
      continue
    exported[key] = sandbox[key]
  }
  return exported
}

const Clients = loadEngine("Clients.js")
const Session = loadEngine("Session.js")
const Hypr = loadEngine("Hypr.js")

function hyprctl(args) {
  const res = spawnSync("hyprctl", args, { encoding: "utf8" })
  return { code: res.status, text: res.stdout || "", err: res.stderr || "" }
}

function clientsNow() {
  const res = hyprctl(["-j", "clients"])
  if (res.code !== 0)
    throw new Error("hyprctl clients failed: " + res.err)
  return Clients.parseClientsResult(res.text, 0)
}

function applyBatches(batches) {
  for (let i = 0; i < batches.length; i++) {
    const res = hyprctl(["--batch", batches[i]])
    if (res.code !== 0)
      throw new Error("hyprctl --batch failed: " + res.err + " " + batches[i])
  }
}

const parsed = clientsNow()
if (!parsed.ok)
  throw new Error("could not parse clients")

const floating = parsed.clients.filter((c) => c.floating && !Clients.isOnCloak(c))
if (floating.length < 1) {
  console.log("live-roundtrip: SKIP (need at least one floating window; tiled marked windows refuse cloak)")
  process.exit(0)
}

const target = floating.slice()
console.log("live-roundtrip: vanish " + target.length + " floating window(s) to special:cloak x " + CYCLES)

for (let cycle = 0; cycle < CYCLES; cycle++) {
  const before = clientsNow()
  if (!before.ok)
    throw new Error("cycle " + cycle + " clients-before failed")
  const session = Session.create({ clients: before.clients })
  const marked = target.map((t) => {
    const live = before.clients.filter((c) => c.address === t.address)[0]
    return JSON.parse(JSON.stringify(live || t))
  }).filter((c) => c && c.address && c.floating)
  if (!marked.length) {
    console.log("live-roundtrip: SKIP (floating targets gone)")
    process.exit(0)
  }
  if (Hypr.cannotRestoreTiled(marked))
    throw new Error("cycle " + cycle + " refused to vanish a floating set")
  Session.recordMoves(session, marked)
  applyBatches(Hypr.chunk(Hypr.moveCommands(marked), 20))
  const cloaked = clientsNow()
  if (!cloaked.ok)
    throw new Error("cycle " + cycle + " clients-cloaked failed")
  const leaked = Clients.markedStillVisible(marked, cloaked.clients)
  if (leaked.length)
    throw new Error("cycle " + cycle + " marked windows still visible " + JSON.stringify(leaked.map((c) => c.address)))
  const plan = Session.restorePlan(session, cloaked.clients)
  applyBatches(Hypr.chunk(Hypr.restoreCommands(plan), 20))
  const after = clientsNow()
  if (!after.ok)
    throw new Error("cycle " + cycle + " clients-after failed")
  const diffs = Clients.roundTripDiff(JSON.stringify(before.clients), JSON.stringify(after.clients))
  if (diffs.length)
    throw new Error("cycle " + cycle + " full-set restore diff " + JSON.stringify(diffs))
}

console.log("live-roundtrip: ok " + CYCLES + " cycles, floating vanish")
