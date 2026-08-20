.pragma library

// Widget settings come inline on the shell.json entry (injected as QML
// properties). Marks are runtime state in ~/.local/state/share-cloak/marks.json
// because the list grows from Super+F10 / the popup and we cannot write
// shell.json from a plugin.

var VERSION = 1

var autoCloak = true
var workspaceGuard = true
var dimOthers = true
var coverCards = true
var dimAlpha = 0.85
var dimaround = false
var extraSafeWorkspaces = []
var marks = []
var revision = 0

function defaults() {
    return {
        version: VERSION,
        autoCloak: true,
        workspaceGuard: true,
        dimOthers: true,
        coverCards: true,
        dimAlpha: 0.85,
        dimaround: false,
        extraSafeWorkspaces: [],
        marks: []
    }
}

function asBool(value, fallback) {
    if (value === undefined || value === null)
        return fallback
    if (typeof value === "boolean")
        return value
    var s = String(value).toLowerCase()
    if (s === "true" || s === "1" || s === "yes" || s === "on")
        return true
    if (s === "false" || s === "0" || s === "no" || s === "off")
        return false
    return fallback
}

function asNumber(value, fallback) {
    var n = Number(value)
    if (isNaN(n))
        return fallback
    return n
}

function parseSafeList(value) {
    if (!value)
        return []
    if (Object.prototype.toString.call(value) === "[object Array]") {
        var out = []
        for (var i = 0; i < value.length; i++) {
            if (value[i] === undefined || value[i] === null || value[i] === "")
                continue
            if (typeof value[i] === "object")
                out.push(value[i])
            else
                out.push(String(value[i]))
        }
        return out
    }
    return String(value).split(/[,\s]+/).filter(function(s) { return s.length > 0 })
}

function applySettings(raw) {
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return false
        }
    }
    if (!data || typeof data !== "object")
        return false
    if (data.autoCloak !== undefined)
        autoCloak = asBool(data.autoCloak, autoCloak)
    if (data.workspaceGuard !== undefined)
        workspaceGuard = asBool(data.workspaceGuard, workspaceGuard)
    if (data.dimOthers !== undefined)
        dimOthers = asBool(data.dimOthers, dimOthers)
    if (data.coverCards !== undefined)
        coverCards = asBool(data.coverCards, coverCards)
    if (data.dimAlpha !== undefined)
        dimAlpha = asNumber(data.dimAlpha, dimAlpha)
    if (data.dimaround !== undefined)
        dimaround = asBool(data.dimaround, dimaround)
    if (data.safeWorkspaces !== undefined)
        extraSafeWorkspaces = parseSafeList(data.safeWorkspaces)
    if (data.extraSafeWorkspaces !== undefined)
        extraSafeWorkspaces = parseSafeList(data.extraSafeWorkspaces)
    if (data.marks)
        marks = data.marks.slice ? data.marks.slice() : data.marks
    revision += 1
    return true
}

function loadMarks(raw) {
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return false
        }
    }
    if (!data)
        return false
    if (Object.prototype.toString.call(data) === "[object Array]")
        marks = data.slice()
    else if (data.marks)
        marks = data.marks.slice()
    else
        return false
    revision += 1
    return true
}

function snapshot() {
    return {
        version: VERSION,
        autoCloak: autoCloak,
        workspaceGuard: workspaceGuard,
        dimOthers: dimOthers,
        coverCards: coverCards,
        dimAlpha: dimAlpha,
        dimaround: dimaround,
        extraSafeWorkspaces: extraSafeWorkspaces.slice(),
        marks: marks.slice(),
        revision: revision
    }
}

function serializeMarks() {
    return JSON.stringify({ version: VERSION, marks: marks }, null, 2)
}

function setMarks(next) {
    marks = next ? next.slice() : []
    revision += 1
}

function reset() {
    var d = defaults()
    autoCloak = d.autoCloak
    workspaceGuard = d.workspaceGuard
    dimOthers = d.dimOthers
    coverCards = d.coverCards
    dimAlpha = d.dimAlpha
    dimaround = d.dimaround
    extraSafeWorkspaces = []
    marks = []
    revision += 1
}
