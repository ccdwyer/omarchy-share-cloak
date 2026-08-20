.pragma library

// mako-only DND. Modes must already exist in the user's mako config.
// On any failure we report manager:"unmanaged" and the cloak still proceeds.

var CANDIDATES = ["dnd", "do-not-disturb", "donotdisturb", "away", "silent", "disturb"]

function parseModes(text) {
    var lines = String(text || "").split("\n")
    var modes = []
    var seen = {}
    for (var i = 0; i < lines.length; i++) {
        var line = String(lines[i] || "").trim()
        if (!line || line.charAt(0) === "#")
            continue
        if (line.indexOf("usage:") === 0 || line.indexOf("makoctl") === 0)
            continue
        var token = line.split(/\s+/)[0]
        if (!token)
            continue
        if (seen[token])
            continue
        seen[token] = true
        modes.push(token)
    }
    return modes
}

function pickMode(available) {
    var list = available || []
    var lower = {}
    for (var i = 0; i < list.length; i++)
        lower[String(list[i]).toLowerCase()] = list[i]
    for (var c = 0; c < CANDIDATES.length; c++) {
        if (lower[CANDIDATES[c]])
            return lower[CANDIDATES[c]]
    }
    return ""
}

function inspect(text, exitCode) {
    if (exitCode && Number(exitCode) !== 0 && (!text || !String(text).trim())) {
        return {
            manager: "unmanaged",
            note: "notifications: unmanaged",
            available: [],
            current: [],
            applyMode: "",
            ok: false
        }
    }
    var available = parseModes(text)
    var applyMode = pickMode(available)
    var managed = available.length > 0 && !!applyMode
    if (!managed && available.length > 0) {
        return {
            manager: "mako",
            note: "notifications: unmanaged",
            available: available,
            current: available.slice(),
            applyMode: "",
            ok: false
        }
    }
    if (!managed) {
        return {
            manager: "unmanaged",
            note: "notifications: unmanaged",
            available: available,
            current: available.slice(),
            applyMode: "",
            ok: false
        }
    }
    return {
        manager: "mako",
        note: "",
        available: available,
        current: available.slice(),
        applyMode: applyMode,
        ok: true
    }
}

function applyArgv(mode) {
    if (!mode)
        return null
    return ["makoctl", "mode", "-a", String(mode)]
}

function restoreArgv(mode) {
    if (!mode)
        return null
    return ["makoctl", "mode", "-r", String(mode)]
}

function alreadyHas(current, mode) {
    var list = current || []
    var want = String(mode || "").toLowerCase()
    for (var i = 0; i < list.length; i++) {
        if (String(list[i]).toLowerCase() === want)
            return true
    }
    return false
}
