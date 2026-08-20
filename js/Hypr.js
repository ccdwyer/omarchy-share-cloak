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

function quoteWorkspace(name) {
    var n = String(name || "")
    if (!n)
        return "1"
    return n
}

function moveSilent(addr, workspace) {
    return "dispatch movetoworkspacesilent " + quoteWorkspace(workspace) + "," + addrSpec(addr)
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

function cloakCommands(marked, unmarked, options) {
    var opts = options || {}
    var alpha = opts.dimAlpha === undefined ? DEFAULT_DIM_ALPHA : Number(opts.dimAlpha)
    var dimOthers = opts.dimOthers !== false
    var cmds = []
    var i
    for (i = 0; i < (marked || []).length; i++) {
        var m = marked[i]
        var addr = m.address || m
        if (addr)
            cmds.push(moveToCloak(addr))
    }
    if (dimOthers) {
        for (i = 0; i < (unmarked || []).length; i++) {
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
    }
    return cmds
}

function restoreCommands(plan) {
    var steps = (plan && plan.steps) || plan || []
    var cmds = []
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i]
        if (!step || !step.address)
            continue
        if (step.kind === "alpha")
            cmds.push(alphaCmd(step.address, step.from === undefined ? 1 : step.from))
        else if (step.kind === "dimaround")
            cmds.push(dimaroundCmd(step.address, !!step.from))
        else if (step.kind === "move" || step.kind === "catch-all-move") {
            cmds.push(moveSilent(step.address, step.fromWorkspace || step.workspace || "1"))
            if (step.floating && step.at && step.size) {
                cmds.push(movePixel(step.address, step.at[0], step.at[1]))
                cmds.push(resizePixel(step.address, step.size[0], step.size[1]))
            }
        }
    }
    return cmds
}

function batchArgv(batch) {
    if (!batch)
        return null
    return ["hyprctl", "--batch", batch]
}
