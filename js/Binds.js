.pragma library

// hyprctl -j binds helpers. SUPER/Mod4 is mask 64.

var SUPER = 64
var PLUGIN_ID = "io.github.chris.share-cloak"

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

function isOurs(bind, pluginId, method) {
    if (!bind || !method)
        return false
    if (String(bind.dispatcher || "") !== "exec")
        return false
    var arg = String(bind.arg || "")
    return arg === expectedArg(pluginId, method) || arg === expectedArgDouble(pluginId, method)
}

function conflict(binds, modmask, key, pluginId, method) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (!isOurs(hits[i], pluginId, method))
            return hits[i]
    }
    return null
}

function oursPresent(binds, modmask, key, pluginId, method) {
    var hits = find(binds, modmask, key)
    for (var i = 0; i < hits.length; i++) {
        if (isOurs(hits[i], pluginId, method))
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
        if (!isOurs(hits[i], pluginId, method))
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
