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

function activeAddr() {
  const res = hyprctl(["-j", "activewindow"])
  try {
    const w = JSON.parse(res.text || "null")
    return w && w.address ? String(w.address).toLowerCase() : ""
  } catch (e) {
    return ""
  }
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

const active = activeAddr()
const tiled = parsed.clients.filter((c) => !c.floating && c.address !== active && !Clients.isOnCloak(c))
if (tiled.length < 1) {
  console.log("live-roundtrip: SKIP (need at least one non-active tiled window)")
  process.exit(0)
}

const target = tiled.slice(0, Math.min(3, tiled.length))
console.log("live-roundtrip: cycling " + target.length + " tiled window(s) x " + CYCLES)

for (let cycle = 0; cycle < CYCLES; cycle++) {
  const before = clientsNow()
  if (!before.ok)
    throw new Error("cycle " + cycle + " clients-before failed")
  const session = Session.create({ clients: before.clients })
  Session.recordMoves(session, target, Clients.tileOrderMap(before.clients))
  applyBatches(Hypr.chunk(Hypr.moveCommands(target), 20))
  const cloaked = clientsNow()
  if (!cloaked.ok)
    throw new Error("cycle " + cycle + " clients-cloaked failed")
  const leaked = Clients.markedStillVisible(target, cloaked.clients)
  if (leaked.length)
    throw new Error("cycle " + cycle + " leak: " + leaked.map((c) => c.address).join(","))
  const plan = Session.restorePlan(session, cloaked.clients)
  applyBatches(Hypr.chunk(Hypr.restoreCommands(plan), 20))
  const after = clientsNow()
  if (!after.ok)
    throw new Error("cycle " + cycle + " clients-after failed")
  const stuck = Session.stillOnCloak(session, after.clients)
  if (stuck.length)
    throw new Error("cycle " + cycle + " still on cloak")
  const diffs = Clients.roundTripDiff(
    JSON.stringify(before.clients.filter((c) => target.some((t) => t.address === c.address))),
    JSON.stringify(after.clients.filter((c) => target.some((t) => t.address === c.address)))
  )
  const geom = diffs.filter((d) => d.kind === "changed")
  if (geom.length) {
    throw new Error("cycle " + cycle + " layout diff " + JSON.stringify(geom))
  }
}

console.log("live-roundtrip: ok " + CYCLES + " cycles")
