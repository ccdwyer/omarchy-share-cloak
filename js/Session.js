.pragma library

// Transactional snapshot. Every mutation is recorded with ownership so
// uncloak restores only values the plugin still owns. User changes made
// while cloaked are preserved.

var SCHEMA = "share-cloak.session"
var VERSION = 1

function empty() {
    return {
        version: VERSION,
        schema: SCHEMA,
        startedAt: 0,
        phase: "idle",
        reason: "",
        share: { kind: "none", owner: 0, source: "" },
        safeWorkspaces: [],
        specialWorkspaces: [],
        notification: {
            manager: "unmanaged",
            owned: false,
            previousModes: [],
            appliedMode: ""
        },
        clients: [],
        mutations: [],
        unrestorable: [],
        mutationSeq: 0
    }
}

function nextId(session) {
    session.mutationSeq = (session.mutationSeq || 0) + 1
    return "m" + session.mutationSeq
}

function captureClient(c) {
    if (!c)
        return null
    return {
        address: String(c.address || ""),
        class: String(c["class"] || c.class || ""),
        title: String(c.title || ""),
        pid: Number(c.pid) || 0,
        workspaceId: c.workspaceId !== undefined ? c.workspaceId : (c.workspace && c.workspace.id) || 0,
        workspaceName: c.workspaceName || (c.workspace && c.workspace.name) || "",
        workspace: {
            id: c.workspaceId !== undefined ? c.workspaceId : (c.workspace && c.workspace.id) || 0,
            name: c.workspaceName || (c.workspace && c.workspace.name) || ""
        },
        at: c.at ? [c.at[0], c.at[1]] : [0, 0],
        size: c.size ? [c.size[0], c.size[1]] : [0, 0],
        floating: !!c.floating,
        fullscreen: Number(c.fullscreen) || 0,
        fullscreenClient: Number(c.fullscreenClient) || 0,
        monitor: c.monitor,
        pinned: !!c.pinned
    }
}

function create(opts) {
    var o = opts || {}
    var session = empty()
    session.startedAt = o.startedAt || Date.now()
    session.phase = "cloaked"
    session.reason = o.reason || "manual"
    session.share = o.share || session.share
    session.safeWorkspaces = (o.safeWorkspaces || []).slice()
    session.specialWorkspaces = (o.specialWorkspaces || []).slice()
    session.notification = o.notification || session.notification
    var clients = o.clients || []
    for (var i = 0; i < clients.length; i++) {
        var cap = captureClient(clients[i])
        if (cap && cap.address)
            session.clients.push(cap)
    }
    return session
}

function addMutation(session, mut) {
    if (!session || !mut)
        return null
    var row = {}
    for (var k in mut) {
        if (mut.hasOwnProperty(k))
            row[k] = mut[k]
    }
    if (!row.id)
        row.id = nextId(session)
    if (row.owned === undefined)
        row.owned = true
    session.mutations.push(row)
    return row
}

function recordMoves(session, marked) {
    var list = marked || []
    for (var i = 0; i < list.length; i++) {
        var c = captureClient(list[i])
        if (!c || !c.address)
            continue
        addMutation(session, {
            kind: "move",
            owned: true,
            address: c.address,
            class: c.class,
            title: c.title,
            fromWorkspace: c.workspaceName || "1",
            fromWorkspaceId: c.workspaceId,
            toWorkspace: "special:cloak",
            at: c.at,
            size: c.size,
            floating: c.floating,
            monitor: c.monitor
        })
    }
}

function priorAlpha(c) {
    if (!c)
        return 1
    if (c.alpha !== undefined && c.alpha !== null && !isNaN(Number(c.alpha)))
        return Number(c.alpha)
    return 1
}

function priorDimaround(c) {
    if (!c)
        return 0
    if (c.dimaround !== undefined && c.dimaround !== null && !isNaN(Number(c.dimaround)))
        return Number(c.dimaround)
    return 0
}

function approxEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.001
}

function liveAlpha(c) {
    if (!c)
        return null
    if (c.alpha === undefined || c.alpha === null)
        return null
    var n = Number(c.alpha)
    return isNaN(n) ? null : n
}

function liveDimaround(c) {
    if (!c)
        return null
    if (c.dimaround === undefined || c.dimaround === null)
        return null
    var n = Number(c.dimaround)
    return isNaN(n) ? null : n
}

function recordDims(session, unmarked, alpha, withDimaround) {
    var list = unmarked || []
    var to = alpha
    for (var i = 0; i < list.length; i++) {
        var src = list[i]
        var c = captureClient(src)
        if (!c || !c.address)
            continue
        var capturedAlpha = src && src.alpha !== undefined && src.alpha !== null && !isNaN(Number(src.alpha))
        var capturedDim = src && src.dimaround !== undefined && src.dimaround !== null && !isNaN(Number(src.dimaround))
        if (capturedAlpha) {
            addMutation(session, {
                kind: "alpha",
                owned: true,
                address: c.address,
                from: Number(src.alpha),
                to: to,
                captured: true
            })
        }
        if (withDimaround && capturedDim) {
            addMutation(session, {
                kind: "dimaround",
                owned: true,
                address: c.address,
                from: Number(src.dimaround),
                to: 1,
                captured: true
            })
        }
    }
}

function recordMakoAdded(session, mode) {
    if (!session || !mode)
        return
    addMutation(session, {
        kind: "mako-mode",
        owned: true,
        pluginAdded: true,
        from: [],
        to: String(mode)
    })
    session.notification = {
        manager: "mako",
        owned: true,
        previousModes: [],
        appliedMode: String(mode),
        pluginAdded: true
    }
}

function recordCatchAll(session, fields) {
    if (!fields || !fields.address)
        return null
    return addMutation(session, {
        kind: "catch-all-move",
        owned: true,
        address: fields.address,
        class: fields["class"] || "",
        title: fields.title || "",
        fromWorkspace: fields.workspace || "",
        toWorkspace: "special:cloak"
    })
}

function findOwnedMove(session, address) {
    var list = (session && session.mutations) || []
    for (var i = list.length - 1; i >= 0; i--) {
        var m = list[i]
        if (!m || !m.owned)
            continue
        if ((m.kind === "move" || m.kind === "catch-all-move") && m.address === address)
            return m
    }
    return null
}

function releaseOwnership(session, address, kinds) {
    var list = (session && session.mutations) || []
    var kindSet = null
    if (kinds && kinds.length) {
        kindSet = {}
        for (var k = 0; k < kinds.length; k++)
            kindSet[kinds[k]] = true
    }
    var n = 0
    for (var i = 0; i < list.length; i++) {
        var m = list[i]
        if (!m || !m.owned)
            continue
        if (address && m.address !== address)
            continue
        if (kindSet && !kindSet[m.kind])
            continue
        m.owned = false
        n++
    }
    return n
}

function reconcileWithLive(session, liveClients) {
    if (!session)
        return
    var map = {}
    var list = liveClients || []
    for (var i = 0; i < list.length; i++) {
        var c = list[i]
        var addr = String((c && c.address) || "").toLowerCase()
        if (!addr)
            continue
        if (addr.indexOf("0x") !== 0)
            addr = "0x" + addr
        map[addr] = c
    }
    var muts = session.mutations || []
    for (var j = 0; j < muts.length; j++) {
        var m = muts[j]
        if (!m || !m.owned)
            continue
        var live = map[String(m.address || "").toLowerCase()]
        if (m.kind === "move" || m.kind === "catch-all-move") {
            if (!live)
                continue
            var name = ""
            if (live.workspaceName)
                name = String(live.workspaceName)
            else if (live.workspace && typeof live.workspace === "object")
                name = String(live.workspace.name || "")
            else
                name = String(live.workspace || "")
            if (name !== "special:cloak" && name !== "cloak")
                m.owned = false
            continue
        }
        if (m.kind === "alpha") {
            if (!live)
                continue
            var a = liveAlpha(live)
            if (a !== null && !approxEqual(a, m.to))
                m.owned = false
            continue
        }
        if (m.kind === "dimaround") {
            if (!live)
                continue
            var d = liveDimaround(live)
            if (d !== null && !approxEqual(d, m.to))
                m.owned = false
        }
    }
}

function restorePlan(session, liveClients) {
    reconcileWithLive(session, liveClients)
    var live = {}
    var list = liveClients || []
    for (var i = 0; i < list.length; i++) {
        var addr = String((list[i] && list[i].address) || "").toLowerCase()
        if (!addr)
            continue
        if (addr.indexOf("0x") !== 0)
            addr = "0x" + addr
        live[addr] = list[i]
    }
    var steps = []
    var unrestorable = []
    var muts = ((session && session.mutations) || []).slice().reverse()
    for (var j = 0; j < muts.length; j++) {
        var m = muts[j]
        if (!m || !m.owned)
            continue
        if (m.kind === "mako-mode") {
            if (!m.pluginAdded && m.owned === false)
                continue
            if (!m.pluginAdded)
                continue
            steps.push({
                kind: "mako-mode",
                from: m.from,
                to: m.to,
                address: "",
                pluginAdded: true
            })
            continue
        }
        var key = String(m.address || "").toLowerCase()
        if (!live[key]) {
            unrestorable.push({
                address: m.address,
                class: m.class || "",
                title: m.title || "",
                reason: "gone"
            })
            continue
        }
        steps.push(m)
    }
    return { steps: steps, unrestorable: unrestorable }
}

function stillOnCloak(session, liveClients) {
    var map = {}
    var list = liveClients || []
    for (var i = 0; i < list.length; i++) {
        var addr = String((list[i] && list[i].address) || "").toLowerCase()
        if (!addr)
            continue
        if (addr.indexOf("0x") !== 0)
            addr = "0x" + addr
        map[addr] = list[i]
    }
    var stuck = []
    var muts = (session && session.mutations) || []
    for (var j = 0; j < muts.length; j++) {
        var m = muts[j]
        if (!m || !m.owned)
            continue
        if (m.kind !== "move" && m.kind !== "catch-all-move")
            continue
        var key = String(m.address || "").toLowerCase()
        var live = map[key]
        if (!live)
            continue
        var name = ""
        if (live.workspaceName)
            name = String(live.workspaceName)
        else if (live.workspace && typeof live.workspace === "object")
            name = String(live.workspace.name || "")
        else
            name = String(live.workspace || "")
        if (name === "special:cloak" || name === "cloak")
            stuck.push(live)
    }
    return stuck
}

function coverCards(session, currentSafeName) {
    var muts = (session && session.mutations) || []
    var cards = []
    for (var i = 0; i < muts.length; i++) {
        var m = muts[i]
        if (!m || !m.owned)
            continue
        if (m.kind !== "move" && m.kind !== "catch-all-move")
            continue
        if (currentSafeName && m.fromWorkspace && String(m.fromWorkspace) !== String(currentSafeName))
            continue
        cards.push({
            address: m.address,
            className: m.class || "",
            title: m.title || "",
            x: m.at ? m.at[0] : 0,
            y: m.at ? m.at[1] : 0,
            w: m.size ? m.size[0] : 0,
            h: m.size ? m.size[1] : 0
        })
    }
    return cards
}

function validate(raw) {
    var data = raw
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw)
        } catch (e) {
            return { ok: false, error: "invalid-json", session: empty() }
        }
    }
    if (!data || typeof data !== "object")
        return { ok: false, error: "not-object", session: empty() }
    if (Number(data.version) !== VERSION && data.version !== undefined && Number(data.version) !== 1)
        return { ok: false, error: "unsupported-version", session: empty() }
    if (!data.mutations)
        data.mutations = []
    if (!data.clients)
        data.clients = []
    if (!data.safeWorkspaces)
        data.safeWorkspaces = []
    return { ok: true, error: "", session: data }
}

function serialize(session) {
    return JSON.stringify(session || empty(), null, 2)
}

function isCloakedPhase(session) {
    return !!(session && (session.phase === "cloaked" || session.phase === "uncloaking"))
}

function load(raw) {
    return validate(raw)
}
