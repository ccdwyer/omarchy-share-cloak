#!/usr/bin/env node
"use strict"

const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const files = ["Service.qml", "Overlay.qml", "BarWidget.qml"]

function fail(msg) {
  process.stderr.write("qml-structure-check: " + msg + "\n")
  process.exit(1)
}

files.forEach((name) => {
  const p = path.join(ROOT, name)
  if (!fs.existsSync(p))
    fail("missing " + name)
  const src = fs.readFileSync(p, "utf8")
  if (/\bTODO\b|\bFIXME\b|\bstub\b/i.test(src) && name !== "never")
    fail(name + " contains TODO/FIXME")
  let braces = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{")
      braces++
    if (src[i] === "}")
      braces--
    if (braces < 0)
      fail(name + " unmatched }")
  }
  if (braces !== 0)
    fail(name + " unmatched braces")
  if (src.indexOf("io.github.chris.share-cloak") < 0)
    fail(name + " missing plugin id")
})

const overlay = fs.readFileSync(path.join(ROOT, "Overlay.qml"), "utf8")
if (overlay.indexOf("function open") < 0 || overlay.indexOf("function close") < 0)
  fail("Overlay.qml must export open/close")
if (overlay.indexOf("mask: Region {}") < 0)
  fail("Overlay.qml toast/on-air surfaces should use empty Region mask")

const service = fs.readFileSync(path.join(ROOT, "Service.qml"), "utf8")
if (service.indexOf("teardownBinds") < 0)
  fail("Service.qml must tear down owned keybinds")
if (service.indexOf("unbindOwnedArgv") < 0)
  fail("Service.qml must detach ownership-safe unbind")
if (service.indexOf("execDetached") < 0)
  fail("Service.qml must launch teardown outside the dying Process")
if (service.indexOf("vanishThenCloak") < 0)
  fail("Service.qml must vanish marked windows onto special:cloak")
if (service.indexOf("abortCloak(\"marked tiled") >= 0)
  fail("Service.qml must cloak tiled marked windows, not refuse them")
if (service.indexOf("safeArgv") < 0 || service.indexOf("recoverStaleCloak") < 0)
  fail("Service.qml must not deadlock the work queue when makoctl is missing")
if (service.indexOf("hideInPlace") >= 0 || service.indexOf("recordHideInPlace") >= 0)
  fail("Service.qml must not hide tiled windows in place")
if (service.indexOf("Component.onDestruction") < 0)
  fail("Service.qml must unbind on destruction")

process.stdout.write("qml-structure-check: ok\n")
