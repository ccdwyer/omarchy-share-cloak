.pragma library

// hyprctl -j clients / monitors / workspaces snapshots.

function normalizeAddress(value) {
    var s = String(value || "").trim().toLowerCase()
    if (!s)
        return ""
    if (s.indexOf("0x") !== 0)
        s = "0x" + s
    return s
}

function parseJson(raw, fallback) {
    if (raw === undefined || raw === null || raw === "")
        return fallback
    if (typeof raw !== "string")
        return raw
    try {
        var parsed = JSON.parse(raw)
        return parsed === null ? fallback : parsed
    } catch (e) {
        return fallback
    }
}

function parseClients(raw) {
    var parsed = parseJson(raw, [])
    return parsed && parsed.length ? parsed : []
}

function parseList(raw) {
    var parsed = parseJson(raw, [])
    return parsed && parsed.length ? parsed : []
}

function workspaceId(client) {
    if (!client)
        return 0
    var ws = client.workspace
    if (ws && typeof ws === "object")
        return Number(ws.id || 0)
    return Number(client.workspaceId || 0)
}

function workspaceName(client) {
    if (!client)
        return ""
    var ws = client.workspace
    if (ws && typeof ws === "object")
        return String(ws.name || ws.id || "")
    if (client.workspaceName)
        return String(client.workspaceName)
    var id = workspaceId(client)
    return id ? String(id) : ""
}

function point(client) {
    var at = client && client.at
    if (at && at.length >= 2)
        return { x: Number(at[0]) || 0, y: Number(at[1]) || 0 }
    return { x: Number(client && client.x) || 0, y: Number(client && client.y) || 0 }
}

function sizeOf(client) {
    var sz = client && client.size
    if (sz && sz.length >= 2)
        return { w: Number(sz[0]) || 0, h: Number(sz[1]) || 0 }
    return { w: Number(client && client.width) || 0, h: Number(client && client.height) || 0 }
}

function classOf(client) {
    if (!client)
        return ""
    return String(client["class"] || client.initialClass || client.appId || "")
}

function titleOf(client) {
    if (!client)
        return ""
    return String(client.title || client.initialTitle || "")
}

function capture(client) {
    if (!client)
        return null
    var p = point(client)
    var s = sizeOf(client)
    return {
        address: normalizeAddress(client.address),
        class: classOf(client),
        title: titleOf(client),
        pid: Number(client.pid) || 0,
        workspaceId: workspaceId(client),
        workspaceName: workspaceName(client),
        workspace: {
            id: workspaceId(client),
            name: workspaceName(client)
        },
        at: [p.x, p.y],
        size: [s.w, s.h],
        floating: !!client.floating,
        fullscreen: typeof client.fullscreen === "number" ? client.fullscreen : (client.fullscreen ? 2 : 0),
        fullscreenClient: Number(client.fullscreenClient) || 0,
        monitor: client.monitor,
        hidden: !!client.hidden,
        pinned: !!client.pinned,
        mapped: client.mapped !== false,
        alpha: client.alpha !== undefined && client.alpha !== null ? Number(client.alpha) : undefined,
        dimaround: client.dimaround !== undefined && client.dimaround !== null ? Number(client.dimaround) : undefined
    }
}

function isOnCloak(client) {
    var name = workspaceName(client)
    return name === "special:cloak" || name === "cloak"
}

function markedStillVisible(marked, liveClients) {
    var live = indexByAddress(liveClients)
    var failed = []
    var list = marked || []
    for (var i = 0; i < list.length; i++) {
        var addr = normalizeAddress(list[i] && (list[i].address || list[i]))
        if (!addr)
            continue
        var now = live[addr]
        if (!now)
            continue
        if (!isOnCloak(now))
            failed.push(now)
    }
    return failed
}

function captureAll(clients) {
    var list = clients || []
    var out = []
    for (var i = 0; i < list.length; i++) {
        var c = capture(list[i])
        if (c && c.address)
            out.push(c)
    }
    return out
}

function indexByAddress(clients) {
    var map = {}
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (!c)
            continue
        var captured = c.address && c.workspaceName !== undefined ? c : capture(c)
        if (!captured || !captured.address)
            continue
        map[captured.address] = captured
    }
    return map
}

function liveAddresses(clients) {
    var map = {}
    var list = clients || []
    for (var i = 0; i < list.length; i++) {
        var addr = normalizeAddress(list[i] && list[i].address)
        if (addr)
            map[addr] = true
    }
    return map
}

function normalizeForDiff(client) {
    var c = client && client.workspaceName !== undefined && client.at ? client : capture(client)
    if (!c)
        return null
    return {
        address: c.address,
        class: c.class,
        title: c.title,
        workspaceId: c.workspaceId,
        workspaceName: c.workspaceName,
        x: c.at ? c.at[0] : 0,
        y: c.at ? c.at[1] : 0,
        w: c.size ? c.size[0] : 0,
        h: c.size ? c.size[1] : 0,
        floating: !!c.floating,
        fullscreen: Number(c.fullscreen) || 0,
        monitor: c.monitor,
        pinned: !!c.pinned
    }
}

function sortKey(row) {
    return String(row && row.address || "")
}

function roundTripDiff(beforeRaw, afterRaw) {
    var before = captureAll(parseClients(beforeRaw)).map(normalizeForDiff).filter(Boolean)
    var after = captureAll(parseClients(afterRaw)).map(normalizeForDiff).filter(Boolean)
    before.sort(function(a, b) { return sortKey(a) < sortKey(b) ? -1 : 1 })
    after.sort(function(a, b) { return sortKey(a) < sortKey(b) ? -1 : 1 })
    var diffs = []
    var bi = 0
    var ai = 0
    while (bi < before.length || ai < after.length) {
        var b = bi < before.length ? before[bi] : null
        var a = ai < after.length ? after[ai] : null
        if (b && (!a || b.address < a.address)) {
            diffs.push({ address: b.address, kind: "missing-after", before: b, after: null })
            bi++
            continue
        }
        if (a && (!b || a.address < b.address)) {
            diffs.push({ address: a.address, kind: "missing-before", before: null, after: a })
            ai++
            continue
        }
        var keys = ["class", "title", "workspaceId", "workspaceName", "x", "y", "w", "h", "floating", "fullscreen", "monitor", "pinned"]
        var changed = []
        for (var k = 0; k < keys.length; k++) {
            if (b[keys[k]] !== a[keys[k]])
                changed.push(keys[k])
        }
        if (changed.length)
            diffs.push({ address: b.address, kind: "changed", fields: changed, before: b, after: a })
        bi++
        ai++
    }
    return diffs
}

function focused(clients) {
    var list = clients || []
    var best = null
    var bestId = 1e9
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (!c)
            continue
        var hid = c.focusHistoryID
        if (hid === undefined || hid === null)
            hid = c.focusHistoryId
        if (hid === 0)
            return capture(c)
        if (hid !== undefined && hid !== null && Number(hid) < bestId) {
            bestId = Number(hid)
            best = c
        }
    }
    return best ? capture(best) : (list[0] ? capture(list[0]) : null)
}

function safeWorkspacesFromMonitors(monitors) {
    var list = monitors || []
    var out = []
    var seen = {}
    for (var i = 0; i < list.length; i++) {
        var m = list[i]
        if (!m)
            continue
        var aw = m.activeWorkspace || m["active-workspace"] || null
        var id = 0
        var name = ""
        if (aw && typeof aw === "object") {
            id = Number(aw.id || 0)
            name = String(aw.name || aw.id || "")
        }
        var key = name || String(id)
        if (!key || seen[key])
            continue
        seen[key] = true
        out.push({ id: id, name: name, monitor: m.name || m.id })
    }
    return out
}

function specialWorkspaceNames(workspaces) {
    var list = workspaces || []
    var out = []
    for (var i = 0; i < list.length; i++) {
        var w = list[i]
        var name = String((w && (w.name || w.id)) || "")
        if (name.indexOf("special:") === 0)
            out.push(name)
    }
    return out
}
