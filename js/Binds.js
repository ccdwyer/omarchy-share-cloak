.pragma library

// hyprctl -j binds helpers. SUPER/Mod4 is mask 64.

var SUPER = 64

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

function isOurs(bind, pluginId) {
    if (!bind)
        return false
    if (String(bind.dispatcher || "") !== "exec")
        return false
    var id = String(pluginId || "io.github.chris.share-cloak")
    var prefix = "omarchy-shell shell call " + id + " "
    var arg = String(bind.arg || "")
    if (arg.indexOf(prefix) !== 0)
        return false
    var rest = arg.slice(prefix.length)
    var space = rest.lastIndexOf(" ")
    if (space <= 0)
        return false
    var method = rest.slice(0, space)
    var tail = rest.slice(space + 1)
    if (!method.length)
        return false
    return tail === "''" || tail === "\"\""
}

function conflict(binds, modmask, key, pluginId) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (!isOurs(hits[i], pluginId))
            return hits[i]
    }
    return null
}

function oursPresent(binds, modmask, key, pluginId) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (isOurs(hits[i], pluginId))
            return true
    }
    return false
}

function bindArgv(key, method) {
    var arg = "SUPER," + String(key) + ",exec,omarchy-shell shell call io.github.chris.share-cloak " + method + " ''"
    return ["hyprctl", "keyword", "bind", arg]
}

function unbindArgv(key) {
    return ["hyprctl", "keyword", "unbind", "SUPER," + String(key)]
}

function exclusivelyOurs(binds, modmask, key, pluginId) {
    var hits = find(binds, modmask, key)
    if (!hits.length)
        return false
    for (var i = 0; i < hits.length; i++) {
        if (!isOurs(hits[i], pluginId))
            return false
    }
    return true
}

function keysToUnbind(owned, binds, pluginId) {
    var out = []
    var list = owned || []
    for (var i = 0; i < list.length; i++) {
        var key = list[i] && list[i].key !== undefined ? list[i].key : list[i]
        if (!key)
            continue
        if (exclusivelyOurs(binds, SUPER, key, pluginId))
            out.push(String(key))
    }
    return out
}
