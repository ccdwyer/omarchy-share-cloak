.pragma library

// mako-only DND.
// `makoctl mode` lists currently *enabled* modes, not modes configured in
// mako/config. A DND candidate is added only when it is not already current.
// Ownership is recorded only after a successful add; restore removes only
// a mode this plugin added.

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

function parseConfigModes(text) {
    var src = String(text || "")
    var modes = []
    var seen = {}
    var re = /\[mode=([^\]]+)\]/g
    var m
    while ((m = re.exec(src))) {
        var name = String(m[1] || "").trim()
        if (!name || seen[name])
            continue
        seen[name] = true
        modes.push(name)
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

function inList(list, mode) {
    var want = String(mode || "").toLowerCase()
    var rows = list || []
    for (var i = 0; i < rows.length; i++) {
        if (String(rows[i]).toLowerCase() === want)
            return true
    }
    return false
}

function tryModes(current, configured) {
    var pool = CANDIDATES
    var conf = configured || []
    var out = []
    var i
    if (conf.length) {
        pool = []
        for (i = 0; i < CANDIDATES.length; i++) {
            if (inList(conf, CANDIDATES[i]))
                pool.push(pickNamed(conf, CANDIDATES[i]))
        }
        for (i = 0; i < conf.length; i++) {
            if (inList(CANDIDATES, conf[i]) && !inList(pool, conf[i]))
                pool.push(conf[i])
        }
    }
    for (i = 0; i < pool.length; i++) {
        var name = pool[i]
        if (!name)
            continue
        if (inList(current, name))
            continue
        if (!inList(out, name))
            out.push(name)
    }
    return out
}

function pickNamed(list, candidate) {
    var want = String(candidate || "").toLowerCase()
    for (var i = 0; i < (list || []).length; i++) {
        if (String(list[i]).toLowerCase() === want)
            return list[i]
    }
    return candidate
}

function inspect(currentText, exitCode, configText) {
    if (exitCode && Number(exitCode) !== 0 && (!currentText || !String(currentText).trim())) {
        return {
            manager: "unmanaged",
            note: "notifications: unmanaged",
            available: [],
            current: [],
            configured: [],
            alreadyActive: false,
            alreadyMode: "",
            tryModes: [],
            applyMode: "",
            needsAdd: false,
            ok: false
        }
    }
    var current = parseModes(currentText)
    var configured = parseConfigModes(configText)
    var alreadyMode = pickMode(current)
    var tries = tryModes(current, configured)
    var alreadyActive = !!alreadyMode
    if (alreadyActive) {
        return {
            manager: "mako",
            note: "",
            available: current.slice(),
            current: current,
            configured: configured,
            alreadyActive: true,
            alreadyMode: alreadyMode,
            tryModes: [],
            applyMode: "",
            needsAdd: false,
            ok: true
        }
    }
    return {
        manager: tries.length ? "mako" : "unmanaged",
        note: tries.length ? "" : "notifications: unmanaged",
        available: current.slice(),
        current: current,
        configured: configured,
        alreadyActive: false,
        alreadyMode: "",
        tryModes: tries,
        applyMode: tries.length ? tries[0] : "",
        needsAdd: tries.length > 0,
        ok: tries.length > 0
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
    return inList(current, mode)
}
