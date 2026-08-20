.pragma library

// Hyprland socket2 line parser for Share Cloak.
// Protocol: EVENT>>DATA
// Unknown events are returned with kind:"unknown" so callers can log-and-skip.

var KNOWN = {
    screencast: { args: 2, fields: ["state", "owner"] },
    openwindow: { args: 4, fields: ["address", "workspace", "klass", "title"] },
    closewindow: { args: 1, fields: ["address"] },
    kill: { args: 1, fields: ["address"] },
    movewindow: { args: 2, fields: ["address", "workspace"] },
    movewindowv2: { args: 3, fields: ["address", "workspaceId", "workspace"] },
    changefloatingmode: { args: 2, fields: ["address", "floating"] },
    fullscreen: { args: 1, fields: ["state"] },
    activewindow: { args: 2, fields: ["klass", "title"] },
    activewindowv2: { args: 1, fields: ["address"] },
    windowtitle: { args: 1, fields: ["address"] },
    windowtitlev2: { args: 2, fields: ["address", "title"] },
    workspace: { args: 1, fields: ["workspace"] },
    workspacev2: { args: 2, fields: ["workspaceId", "workspace"] },
    focusedmon: { args: 2, fields: ["monitor", "workspace"] },
    focusedmonv2: { args: 2, fields: ["monitor", "workspaceId"] },
    createworkspace: { args: 1, fields: ["workspace"] },
    createworkspacev2: { args: 2, fields: ["workspaceId", "workspace"] },
    destroyworkspace: { args: 1, fields: ["workspace"] },
    destroyworkspacev2: { args: 2, fields: ["workspaceId", "workspace"] },
    configreloaded: { args: 0, fields: [] }
}

function splitArgs(data, count) {
    if (count <= 0)
        return []
    if (data === undefined || data === null || data === "")
        return count === 1 ? [""] : []
    var parts = []
    var rest = String(data)
    for (var i = 0; i < count - 1; i++) {
        var idx = rest.indexOf(",")
        if (idx < 0) {
            parts.push(rest)
            rest = ""
            break
        }
        parts.push(rest.slice(0, idx))
        rest = rest.slice(idx + 1)
    }
    while (parts.length < count - 1)
        parts.push("")
    parts.push(rest)
    return parts
}

function normalizeAddress(value) {
    var s = String(value || "").trim().toLowerCase()
    if (!s)
        return ""
    if (s.indexOf("0x") !== 0)
        s = "0x" + s
    return s
}

function asFlag(value) {
    var s = String(value).trim()
    if (s === "1" || s === "true" || s === "on")
        return 1
    return 0
}

function parseLine(line) {
    var raw = String(line || "").replace(/\r$/, "")
    if (!raw)
        return null
    var sep = raw.indexOf(">>")
    if (sep < 0)
        return { kind: "unknown", name: "", data: raw, raw: raw, fields: {} }
    var name = raw.slice(0, sep)
    var data = raw.slice(sep + 2)
    var spec = KNOWN[name]
    if (!spec) {
        return {
            kind: "unknown",
            name: name,
            data: data,
            raw: raw,
            fields: {}
        }
    }
    var args = splitArgs(data, spec.args)
    var fields = {}
    for (var i = 0; i < spec.fields.length; i++) {
        var key = spec.fields[i]
        var val = args[i] !== undefined ? args[i] : ""
        if (key === "address")
            val = normalizeAddress(val)
        else if (key === "floating" || key === "state" || key === "owner")
            val = asFlag(val)
        else if (key === "workspaceId")
            val = parseInt(val, 10)
        if (key === "klass")
            fields["class"] = val
        else
            fields[key] = val
    }
    if (name === "screencast") {
        fields.shareKind = fields.owner === 1 ? "window" : "monitor"
        fields.active = fields.state === 1
    }
    if (name === "workspace" && fields.workspace !== undefined && fields.workspaceId === undefined) {
        var asNum = parseInt(fields.workspace, 10)
        if (!isNaN(asNum) && String(asNum) === String(fields.workspace))
            fields.workspaceId = asNum
    }
    return {
        kind: "event",
        name: name,
        data: data,
        raw: raw,
        fields: fields
    }
}

function parseStream(text) {
    var lines = String(text || "").split("\n")
    var out = []
    for (var i = 0; i < lines.length; i++) {
        var parsed = parseLine(lines[i])
        if (parsed)
            out.push(parsed)
    }
    return out
}

function isScreencast(parsed) {
    return !!(parsed && parsed.name === "screencast")
}

function isSpecialWorkspace(name) {
    var n = String(name || "")
    return n.indexOf("special:") === 0 || n === "cloak" || n === "special"
}

function isOurCloakWorkspace(name) {
    var n = String(name || "")
    return n === "special:cloak" || n === "cloak"
}
