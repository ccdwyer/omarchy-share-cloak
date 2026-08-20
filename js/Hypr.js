.pragma library

// hyprctl --batch builder. Mutations go through compositor IPC only.

var CLOAK_WORKSPACE = "special:cloak"
var DEFAULT_DIM_ALPHA = 0.85
var CHUNK = 20

function normalizeAddress(value) {
    var s = String(value || "").trim().toLowerCase()
    if (!s)
        return ""
    if (s.indexOf("0x") !== 0)
        s = "0x" + s
    return s
}

function addrSpec(value) {
    return "address:" + normalizeAddress(value)
}

function workspaceToken(name, id) {
    var n = String(name || "").trim()
    var nid = id === undefined || id === null || id === "" ? NaN : Number(id)
    if (/[;,]/.test(n)) {
        if (!isNaN(nid) && isFinite(nid) && nid !== 0)
            return String(nid)
        n = n.replace(/[;,]/g, "")
    }
    if (!n)
        return !isNaN(nid) && nid !== 0 ? String(nid) : "1"
    if (/^-?[0-9]+$/.test(n))
        return n
    if (n.indexOf("special:") === 0 || n.indexOf("name:") === 0)
        return n
    return "name:" + n
}

function quoteWorkspace(name, id) {
    return workspaceToken(name, id)
}

function moveSilent(addr, workspace, workspaceId) {
    return "dispatch movetoworkspacesilent " + workspaceToken(workspace, workspaceId) + "," + addrSpec(addr)
}

function moveToCloak(addr) {
    return moveSilent(addr, CLOAK_WORKSPACE)
}

function setprop(addr, key, value) {
    return "setprop " + addrSpec(addr) + " " + key + " " + String(value)
}

function alphaCmd(addr, alpha) {
    return setprop(addr, "alpha", alpha)
}

function dimaroundCmd(addr, on) {
    return setprop(addr, "dimaround", on ? 1 : 0)
}

function movePixel(addr, x, y) {
    return "dispatch movewindowpixel exact " + Number(x) + " " + Number(y) + "," + addrSpec(addr)
}

function resizePixel(addr, w, h) {
    return "dispatch resizewindowpixel exact " + Number(w) + " " + Number(h) + "," + addrSpec(addr)
}

function formatBatch(commands) {
    var list = commands || []
    var parts = []
    for (var i = 0; i < list.length; i++) {
        if (list[i])
            parts.push(list[i])
    }
    return parts.join(" ; ")
}

function chunk(commands, size) {
    var n = size || CHUNK
    var list = commands || []
    var out = []
    var i = 0
    while (i < list.length) {
        out.push(formatBatch(list.slice(i, i + n)))
        i += n
    }
    return out.filter(function(s) { return s && s.length })
}

function moveCommands(marked) {
    var cmds = []
    for (var i = 0; i < (marked || []).length; i++) {
        var m = marked[i]
        var addr = m.address || m
        if (addr)
            cmds.push(moveToCloak(addr))
    }
    return cmds
}

function dimCommands(unmarked, options) {
    var opts = options || {}
    var alpha = opts.dimAlpha === undefined ? DEFAULT_DIM_ALPHA : Number(opts.dimAlpha)
    var cmds = []
    for (var i = 0; i < (unmarked || []).length; i++) {
        var u = unmarked[i]
        var uaddr = u.address || u
        if (!uaddr)
            continue
        if (u.workspaceName === CLOAK_WORKSPACE || u.workspaceName === "cloak")
            continue
        cmds.push(alphaCmd(uaddr, alpha))
        if (opts.dimaround)
            cmds.push(dimaroundCmd(uaddr, true))
    }
    return cmds
}

function cloakCommands(marked, unmarked, options) {
    var opts = options || {}
    var cmds = moveCommands(marked)
    if (opts.dimOthers !== false)
        cmds = cmds.concat(dimCommands(unmarked, opts))
    return cmds
}

function dispatchMoveArgv(addr) {
    return ["hyprctl", "dispatch", "movetoworkspacesilent", CLOAK_WORKSPACE + "," + addrSpec(addr)]
}

function settiledCmd(addr) {
    return "dispatch settiled " + addrSpec(addr)
}

function setfloatingCmd(addr) {
    return "dispatch setfloating " + addrSpec(addr)
}

function fullscreenStateCmd(addr, internal, client) {
    return "dispatch fullscreenstate " + Number(internal || 0) + " " + Number(client || 0) + "," + addrSpec(addr)
}

function geometryCmds(step) {
    var cmds = []
    if (!step || !step.address)
        return cmds
    if (step.floating)
        cmds.push(setfloatingCmd(step.address))
    else
        cmds.push(settiledCmd(step.address))
    if (step.at && step.at.length >= 2)
        cmds.push(movePixel(step.address, step.at[0], step.at[1]))
    if (step.size && step.size.length >= 2)
        cmds.push(resizePixel(step.address, step.size[0], step.size[1]))
    if (step.fullscreen)
        cmds.push(fullscreenStateCmd(step.address, step.fullscreen, step.fullscreenClient))
    return cmds
}

function restoreCommands(plan) {
    var steps = (plan && plan.steps) || plan || []
    var props = []
    var tiled = []
    var floating = []
    var i
    for (i = 0; i < steps.length; i++) {
        var step = steps[i]
        if (!step)
            continue
        if (step.kind === "alpha" && step.address)
            props.push(alphaCmd(step.address, step.from === undefined ? 1 : step.from))
        else if (step.kind === "dimaround" && step.address)
            props.push(dimaroundCmd(step.address, !!step.from))
        else if (step.kind === "move" || step.kind === "catch-all-move") {
            if (step.floating)
                floating.push(step)
            else
                tiled.push(step)
        }
    }
    tiled.sort(function(a, b) {
        var ao = Number(a.tileOrder)
        var bo = Number(b.tileOrder)
        if (isNaN(ao))
            ao = 0
        if (isNaN(bo))
            bo = 0
        if (ao !== bo)
            return ao - bo
        return String(a.address || "") < String(b.address || "") ? -1 : 1
    })
    var cmds = props.slice()
    function emitMove(step) {
        if (!step.address)
            return
        cmds.push(moveSilent(step.address, step.fromWorkspace || step.workspace || "1", step.fromWorkspaceId))
        var geom = geometryCmds(step)
        for (var g = 0; g < geom.length; g++)
            cmds.push(geom[g])
    }
    for (i = 0; i < tiled.length; i++)
        emitMove(tiled[i])
    for (i = 0; i < floating.length; i++)
        emitMove(floating[i])
    for (i = 0; i < tiled.length; i++) {
        var settle = geometryCmds(tiled[i])
        for (var s = 0; s < settle.length; s++) {
            if (settle[s].indexOf("movewindowpixel") >= 0 || settle[s].indexOf("resizewindowpixel") >= 0)
                cmds.push(settle[s])
        }
    }
    return cmds
}

function batchArgv(batch) {
    if (!batch)
        return null
    return ["hyprctl", "--batch", batch]
}

function splitBatch(batch) {
    var parts = String(batch || "").split(" ; ")
    var out = []
    for (var i = 0; i < parts.length; i++) {
        var s = String(parts[i] || "").trim()
        if (s)
            out.push(s)
    }
    return out
}

function getpropArgv(addr, key) {
    return ["hyprctl", "getprop", addrSpec(addr), String(key || "alpha")]
}

function parseGetprop(text) {
    var s = String(text || "").trim()
    if (!s)
        return null
    var n = parseFloat(s)
    if (!isNaN(n) && isFinite(n))
        return n
    var m = s.match(/(-?\d+(?:\.\d+)?)/)
    if (m)
        return parseFloat(m[1])
    if (s === "true" || s === "yes" || s === "on")
        return 1
    if (s === "false" || s === "no" || s === "off")
        return 0
    return null
}
