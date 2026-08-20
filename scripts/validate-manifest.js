#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const manifestPath = path.join(ROOT, "manifest.json")
const raw = fs.readFileSync(manifestPath, "utf8")
const m = JSON.parse(raw)

function fail(msg) {
  process.stderr.write("omarchy-plugin-validate: " + msg + "\n")
  process.exit(1)
}

if (m.schemaVersion !== 1) fail("schemaVersion must be 1")
if (!m.id || String(m.id).indexOf("omarchy.") === 0) fail("id missing or uses omarchy.* namespace")
if (!m.name || !m.version || !m.author) fail("name/version/author required")
if (!m.kinds || !m.kinds.length) fail("kinds required")
if (!m.entryPoints || typeof m.entryPoints !== "object") fail("entryPoints required")
if (!m.keepLoaded) fail("keepLoaded should be true for overlay that outlives summon")

const want = { service: "Service.qml", overlay: "Overlay.qml", barWidget: "BarWidget.qml" }
Object.keys(want).forEach((k) => {
  if (m.kinds.indexOf(k === "barWidget" ? "bar-widget" : k) < 0 && k !== "barWidget")
    return
  const file = m.entryPoints[k]
  if (!file) fail("missing entryPoints." + k)
  if (!fs.existsSync(path.join(ROOT, file))) fail("missing file " + file)
})
if (m.kinds.indexOf("bar-widget") >= 0) {
  if (!m.barWidget) fail("barWidget metadata block required")
  if (!m.barWidget.displayName || !m.barWidget.category) fail("barWidget.displayName/category required")
  if (!m.barWidget.schema || !m.barWidget.defaults) fail("barWidget.schema/defaults required")
}

process.stdout.write("omarchy-plugin-validate: ok " + m.id + "\n")
