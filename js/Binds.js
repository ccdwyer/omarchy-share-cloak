.pragma library

// Detect live Hyprland binds and plan a bindings.lua snippet.
// Lua binds show up as dispatcher "__lua" with a description, not the
// omarchy-shell command in `arg`, so "ours" is plugin-id in arg OR our
// descriptions. Keyword-bind teardown still uses exact exec args.

var PLUGIN_ID = "io.github.chris.share-cloak"
var SUPER = 64
var SHIFT = 1
var CTRL = 4
var ALT = 8

var CANDIDATES = [
    {
        keys: "SUPER + F9",
        modmask: SUPER,
        key: "F9",
        desc: "Share Cloak toggle",
        cmd: "omarchy-shell io.github.chris.share-cloak toggle ''",
        alternates: [
            { keys: "SUPER + ALT + F9", modmask: SUPER + ALT, key: "F9" }
        ]
    },
    {
        keys: "SUPER + F10",
        modmask: SUPER,
        key: "F10",
        desc: "Share Cloak mark focused",
        cmd: "omarchy-shell io.github.chris.share-cloak markFocused ''",
        alternates: [
            { keys: "SUPER + ALT + F10", modmask: SUPER + ALT, key: "F10" }
        ]
    }
]

var offer = {
    needed: true,
    note: "",
    installed: 0,
    toAdd: [],
    skipped: []
}

var autoClaimed = false

function claimAuto() {
    if (autoClaimed)
        return false
    autoClaimed = true
    return true
}

function setOffer(next) {
    offer = next || offer
}

function parseBinds(raw) {
    if (!raw)
        return []
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return []
        }
    }
    return data && data.length ? data : []
}

function keyOf(bind) {
    return String((bind && (bind.key || bind.keycode)) || "").toUpperCase()
}

function modOf(bind) {
    return Number((bind && (bind.modmask !== undefined ? bind.modmask : bind.modMask)) || 0)
}

function find(binds, modmask, key) {
    var want = String(key || "").toUpperCase()
    var list = binds || []
    var out = []
    for (var i = 0; i < list.length; i++) {
        var b = list[i]
        if (!b)
            continue
        if (modOf(b) !== Number(modmask))
            continue
        if (keyOf(b) !== want)
            continue
        out.push(b)
    }
    return out
}

function expectedArg(pluginId, method) {
    return "omarchy-shell " + String(pluginId || PLUGIN_ID) + " " + String(method) + " ''"
}

function expectedArgDouble(pluginId, method) {
    return "omarchy-shell " + String(pluginId || PLUGIN_ID) + " " + String(method) + " \"\""
}

function isOwnedCommand(bind, pluginId, method) {
    if (!bind || !method)
        return false
    if (String(bind.dispatcher || "") !== "exec")
        return false
    var arg = String(bind.arg || "")
    return arg === expectedArg(pluginId, method) || arg === expectedArgDouble(pluginId, method)
}

function isOurs(bind, pluginId, method) {
    if (method !== undefined && method !== null)
        return isOwnedCommand(bind, pluginId, method)
    if (!bind)
        return false
    var arg = String(bind.arg || "")
    var desc = String(bind.description || "")
    if (arg.indexOf(PLUGIN_ID) >= 0)
        return true
    for (var i = 0; i < CANDIDATES.length; i++) {
        if (desc === CANDIDATES[i].desc)
            return true
    }
    return false
}

function oursCount(binds) {
    var n = 0
    var list = binds || []
    for (var i = 0; i < list.length; i++) {
        if (isOurs(list[i]))
            n++
    }
    return n
}

function conflict(binds, modmask, key, pluginId, method) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (!isOwnedCommand(hits[i], pluginId, method))
            return hits[i]
    }
    return null
}

function oursPresent(binds, modmask, key, pluginId, method) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (isOwnedCommand(hits[i], pluginId, method))
            return true
    }
    return false
}

function bindArgv(key, method) {
    var arg = "SUPER," + String(key) + ",exec," + expectedArg(PLUGIN_ID, method)
    return ["hyprctl", "keyword", "bind", arg]
}

function unbindArgv(key) {
    return ["hyprctl", "keyword", "unbind", "SUPER," + String(key)]
}

function exclusivelyOurs(binds, modmask, key, pluginId, method) {
    if (!method)
        return false
    var hits = find(binds, modmask, key)
    if (!hits.length)
        return false
    for (var i = 0; i < hits.length; i++) {
        if (!isOwnedCommand(hits[i], pluginId, method))
            return false
    }
    return true
}

function ownedKey(item) {
    if (!item)
        return ""
    if (item.key !== undefined)
        return String(item.key)
    return String(item)
}

function ownedMethod(item) {
    if (!item || item.method === undefined || item.method === null)
        return ""
    return String(item.method)
}

function keysToUnbind(owned, binds, pluginId) {
    var out = []
    var list = owned || []
    for (var i = 0; i < list.length; i++) {
        var key = ownedKey(list[i])
        var method = ownedMethod(list[i])
        if (!key || !method)
            continue
        if (exclusivelyOurs(binds, SUPER, key, pluginId, method))
            out.push(String(key))
    }
    return out
}

function unbindOwnedArgv(pluginDir, pluginId, owned) {
    var dir = String(pluginDir || ".")
    if (dir.length > 1 && dir.charAt(dir.length - 1) === "/")
        dir = dir.slice(0, dir.length - 1)
    var cmd = ["sh", dir + "/compat/unbind-owned.sh", String(pluginId || PLUGIN_ID)]
    var list = owned || []
    var n = 0
    for (var i = 0; i < list.length; i++) {
        var key = ownedKey(list[i])
        var method = ownedMethod(list[i])
        if (!key || !method)
            continue
        cmd.push(String(key) + ":" + String(method))
        n++
    }
    if (!n)
        return null
    return cmd
}

function ownedKeywordBinds(binds, pluginId) {
    var id = pluginId || PLUGIN_ID
    var owned = []
    if (exclusivelyOurs(binds, SUPER, "F9", id, "toggle"))
        owned.push({ key: "F9", method: "toggle" })
    if (exclusivelyOurs(binds, SUPER, "F10", id, "markFocused"))
        owned.push({ key: "F10", method: "markFocused" })
    return owned
}

function comboOwner(binds, modmask, key) {
    var want = String(key || "").toUpperCase()
    var list = binds || []
    for (var i = 0; i < list.length; i++) {
        var b = list[i]
        if (modOf(b) !== Number(modmask))
            continue
        if (keyOf(b) !== want)
            continue
        if (isOurs(b))
            return { ours: true, desc: String(b.description || "") }
        return { ours: false, desc: String(b.description || b.dispatcher || "already bound") }
    }
    return null
}

function pickCombo(binds, candidate) {
    var owner = comboOwner(binds, candidate.modmask, candidate.key)
    if (!owner)
        return { keys: candidate.keys, modmask: candidate.modmask, key: candidate.key, desc: candidate.desc, cmd: candidate.cmd, chosen: candidate.keys }
    if (owner.ours)
        return { already: true, keys: candidate.keys, desc: candidate.desc }
    var alts = candidate.alternates || []
    for (var i = 0; i < alts.length; i++) {
        var a = alts[i]
        if (!comboOwner(binds, a.modmask, a.key))
            return {
                keys: a.keys,
                modmask: a.modmask,
                key: a.key,
                desc: candidate.desc,
                cmd: candidate.cmd,
                chosen: a.keys,
                preferred: candidate.keys,
                conflict: owner.desc
            }
    }
    return { skipped: true, keys: candidate.keys, desc: candidate.desc, conflict: owner.desc }
}

function plan(binds) {
    var toAdd = []
    var skipped = []
    var already = 0
    for (var i = 0; i < CANDIDATES.length; i++) {
        var pick = pickCombo(binds, CANDIDATES[i])
        if (pick.already)
            already++
        else if (pick.skipped)
            skipped.push(pick)
        else
            toAdd.push(pick)
    }
    var needed = already === 0
    var note = ""
    if (!needed)
        note = ""
    else if (!toAdd.length && skipped.length)
        note = skipped.map(function(s) { return s.keys + " is " + (s.conflict || "taken") }).join("; ")
    else if (toAdd.length) {
        var bits = toAdd.map(function(p) { return p.chosen || p.keys })
        note = "Add " + bits.join(", ")
        for (var s = 0; s < skipped.length; s++)
            note += " — skipped " + skipped[s].keys + " (" + skipped[s].conflict + ")"
    }
    return { needed: needed, already: already, toAdd: toAdd, skipped: skipped, note: note }
}

function luaLine(item) {
    var keys = String(item.chosen || item.keys || "").replace(/"/g, "")
    var desc = String(item.desc || "").replace(/"/g, "")
    var cmd = String(item.cmd || "").replace(/"/g, '\\"')
    return "o.bind(\"" + keys + "\", \"" + desc + "\", \"" + cmd + "\")"
}

function luaBlock(items) {
    var lines = []
    var list = items || []
    for (var i = 0; i < list.length; i++)
        lines.push(luaLine(list[i]))
    return lines.join("\n")
}

function applyScan(raw) {
    var p = plan(parseBinds(raw))
    setOffer(p)
    return p
}

function notifyBody(items, skipped) {
    var lines = []
    var list = items || []
    for (var i = 0; i < list.length; i++) {
        var it = list[i]
        lines.push((it.chosen || it.keys) + " — " + it.desc)
    }
    var miss = skipped || []
    for (var s = 0; s < miss.length; s++)
        lines.push("skipped " + miss[s].keys + " (" + (miss[s].conflict || "taken") + ")")
    return lines.join("\n")
}

function notifyArgv(appName, headline, body) {
    return ["omarchy", "notification", "send", "--app-name", String(appName || PLUGIN_ID), "-g", "󰌌", String(headline || "Keybindings"), String(body || "")]
}
