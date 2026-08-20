.pragma library

// mako-only DND.
// `makoctl mode` lists currently *enabled* modes. Configured suppression
// modes are `[mode=name]` sections that actually hide notifications
// (`invisible=1` / `inhibit=1`). Guessed names are never added: an
// unconfigured `makoctl mode -a dnd` can succeed without suppressing
// anything. Ownership is recorded only after a successful add that is
// then visible in `makoctl mode`; restore removes only a mode we added.

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

function sectionSuppresses(body) {
    var src = String(body || "")
    if (/^\s*invisible\s*=\s*(1|true|yes|on)\s*$/im.test(src))
        return true
    if (/^\s*inhibit\s*=\s*(1|true|yes|on)\s*$/im.test(src))
        return true
    return false
}

function parseSuppressionModes(text) {
    var src = String(text || "")
    var modes = []
    var seen = {}
    var re = /\[mode=([^\]]+)\]/g
    var m
    var matches = []
    while ((m = re.exec(src))) {
        matches.push({ name: String(m[1] || "").trim(), index: m.index, end: re.lastIndex })
    }
    for (var i = 0; i < matches.length; i++) {
        var name = matches[i].name
        if (!name || seen[name])
            continue
        var start = matches[i].end
        var stop = i + 1 < matches.length ? matches[i + 1].index : src.length
        var body = src.slice(start, stop)
        if (!sectionSuppresses(body))
            continue
        seen[name] = true
        modes.push(name)
    }
    return modes
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

function pickNamed(list, candidate) {
    var want = String(candidate || "").toLowerCase()
    for (var i = 0; i < (list || []).length; i++) {
        if (String(list[i]).toLowerCase() === want)
            return list[i]
    }
    return ""
}

function pickSuppression(current, configured) {
    var conf = configured || []
    for (var i = 0; i < conf.length; i++) {
        if (inList(current, conf[i]))
            return pickNamed(current, conf[i]) || conf[i]
    }
    return ""
}

function tryModes(current, configured) {
    var conf = configured || []
    var out = []
    for (var i = 0; i < conf.length; i++) {
        var name = conf[i]
        if (!name || inList(current, name))
            continue
        if (!inList(out, name))
            out.push(name)
    }
    return out
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
    var configured = parseSuppressionModes(configText)
    var alreadyMode = pickSuppression(current, configured)
    var tries = tryModes(current, configured)
    if (alreadyMode) {
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

function isVerifiedCurrent(currentText, mode) {
    return inList(parseModes(currentText), mode)
}
