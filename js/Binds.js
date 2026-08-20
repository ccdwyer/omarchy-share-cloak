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
    var blob = String(bind.arg || "") + " " + String(bind.dispatcher || "")
    var id = String(pluginId || "io.github.chris.share-cloak")
    return blob.indexOf(id) >= 0
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
