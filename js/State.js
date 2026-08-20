.pragma library

// Live UI + state machine: idle → armed → cloaked → uncloaking.
// Bar chip: idle / armed / ON AIR.

var PHASE_IDLE = "idle"
var PHASE_ARMED = "armed"
var PHASE_CLOAKING = "cloaking"
var PHASE_CLOAKED = "cloaked"
var PHASE_UNCLOAKING = "uncloaking"

var revision = 0
var phase = PHASE_IDLE
var shareActive = false
var shareKind = "none"
var shareSource = ""
var userOverride = false
var pendingRestore = false
var workspaceHidden = false
var currentWorkspace = ""
var currentWorkspaceId = 0
var windowShareWarned = false
var notificationNote = ""
var notificationManager = "unknown"
var lastError = ""
var lastStatus = "starting"
var unrestorable = []
var coverCards = []
var overlayMode = "onair"
var transactionBusy = false
var probeIsBinary = false
var clients = []
var toast = ""

function reset() {
    revision = 0
    phase = PHASE_IDLE
    shareActive = false
    shareKind = "none"
    shareSource = ""
    userOverride = false
    pendingRestore = false
    workspaceHidden = false
    currentWorkspace = ""
    currentWorkspaceId = 0
    windowShareWarned = false
    notificationNote = ""
    notificationManager = "unknown"
    lastError = ""
    lastStatus = "starting"
    unrestorable = []
    coverCards = []
    overlayMode = "onair"
    transactionBusy = false
    probeIsBinary = false
    clients = []
    toast = ""
}

function bump() {
    revision += 1
}

function barState() {
    if (phase === PHASE_CLOAKED || phase === PHASE_UNCLOAKING || phase === PHASE_CLOAKING)
        return "onair"
    if (pendingRestore)
        return "restore"
    if (toast && toast.length && unrestorable && unrestorable.length)
        return "restore"
    if (phase === PHASE_ARMED)
        return "armed"
    return "idle"
}

function snapshot() {
    return {
        revision: revision,
        phase: phase,
        barState: barState(),
        shareActive: shareActive,
        shareKind: shareKind,
        shareSource: shareSource,
        userOverride: userOverride,
        pendingRestore: pendingRestore,
        workspaceHidden: workspaceHidden,
        currentWorkspace: currentWorkspace,
        currentWorkspaceId: currentWorkspaceId,
        windowShareWarned: windowShareWarned,
        notificationNote: notificationNote,
        notificationManager: notificationManager,
        lastError: lastError,
        lastStatus: lastStatus,
        unrestorable: unrestorable.slice(),
        coverCards: coverCards.slice(),
        overlayMode: overlayMode,
        transactionBusy: transactionBusy,
        probeIsBinary: probeIsBinary,
        clients: clients,
        toast: toast
    }
}

function armFromAutoCloak(autoCloak) {
    if (phase === PHASE_CLOAKED || phase === PHASE_UNCLOAKING)
        return
    var next = autoCloak ? PHASE_ARMED : PHASE_IDLE
    if (phase !== next) {
        phase = next
        bump()
    }
}

function setShare(active, kind, source) {
    var changed = false
    if (shareActive !== !!active) {
        shareActive = !!active
        changed = true
    }
    var k = kind || (active ? "monitor" : "none")
    if (shareKind !== k) {
        shareKind = k
        changed = true
    }
    if (source && shareSource !== source) {
        shareSource = source
        changed = true
    }
    if (!active) {
        if (shareKind !== "none") {
            shareKind = "none"
            changed = true
        }
        windowShareWarned = false
        userOverride = false
    } else if (k === "window") {
        windowShareWarned = true
    }
    if (changed)
        bump()
}

function enterCloaking(reason) {
    phase = PHASE_CLOAKING
    lastStatus = "cloaking"
    toast = ""
    if (reason)
        shareSource = shareSource || reason
    bump()
}

function enterCloaked(reason) {
    phase = PHASE_CLOAKED
    lastStatus = "cloaked"
    pendingRestore = false
    toast = ""
    if (reason)
        shareSource = shareSource || reason
    bump()
}

function enterUncloaking() {
    phase = PHASE_UNCLOAKING
    lastStatus = "uncloaking"
    workspaceHidden = false
    bump()
}

function enterResting(autoCloak, keepToast) {
    phase = autoCloak ? PHASE_ARMED : PHASE_IDLE
    lastStatus = keepToast ? "toast" : "idle"
    workspaceHidden = false
    windowShareWarned = shareKind === "window"
    pendingRestore = false
    coverCards = []
    transactionBusy = false
    if (!keepToast) {
        toast = ""
        unrestorable = []
    }
    bump()
}

function offerRestore(note) {
    pendingRestore = true
    toast = note || "Cloak interrupted — Super+F9 restores your windows"
    lastStatus = "restore-pending"
    bump()
}

function setWorkspaceHidden(hidden, name, id) {
    var h = !!hidden
    var changed = false
    if (workspaceHidden !== h) {
        workspaceHidden = h
        changed = true
    }
    if (name !== undefined && currentWorkspace !== name) {
        currentWorkspace = String(name || "")
        changed = true
    }
    if (id !== undefined && currentWorkspaceId !== id) {
        currentWorkspaceId = Number(id) || 0
        changed = true
    }
    if (changed)
        bump()
}

function setNotification(manager, note) {
    notificationManager = manager || "unknown"
    notificationNote = note || ""
    bump()
}

function setClients(list) {
    clients = list || []
    bump()
}

function setCovers(list) {
    coverCards = list || []
    bump()
}

function setUnrestorable(list) {
    unrestorable = list || []
    if (unrestorable.length)
        toast = unrestorable.length + " window" + (unrestorable.length === 1 ? "" : "s") + " could not be restored"
    bump()
}

function setToast(msg) {
    toast = msg || ""
    bump()
}

function setError(msg) {
    lastError = msg || ""
    lastStatus = "error"
    bump()
}

function isCloaked() {
    return phase === PHASE_CLOAKED || phase === PHASE_UNCLOAKING || phase === PHASE_CLOAKING
}

function chipLabel() {
    var bs = barState()
    if (bs === "onair")
        return "ON AIR"
    if (bs === "restore")
        return "RESTORE"
    if (bs === "armed")
        return "CLOAK"
    return "cloak"
}

function overlayHeadline() {
    if (pendingRestore)
        return "Cloak interrupted — Super+F9 restores your windows"
    if (workspaceHidden)
        return "workspace hidden while presenting — Super+F9 to uncloak"
    if (windowShareWarned && shareKind === "window")
        return "WINDOW SHARE — Cloak protects full-screen shares"
    if (phase === PHASE_CLOAKING)
        return "cloaking…"
    if (phase === PHASE_CLOAKED || phase === PHASE_UNCLOAKING) {
        var base = "CLOAKED · Super+F9 to uncloak"
        if (notificationNote)
            return base + " · " + notificationNote
        return base
    }
    if (toast)
        return toast
    return "Share Cloak"
}

function isSafeWorkspace(id, name, safeList) {
    var n = String(name || "")
    if (n === "special:cloak" || n === "cloak")
        return true
    var sid = Number(id)
    var list = safeList || []
    if (!list.length)
        return false
    for (var i = 0; i < list.length; i++) {
        var item = list[i]
        if (item === undefined || item === null)
            continue
        if (typeof item === "object") {
            if (item.id !== undefined && Number(item.id) === sid)
                return true
            if (item.name !== undefined && String(item.name) === n)
                return true
        } else if (String(item) === n || Number(item) === sid) {
            return true
        }
    }
    return false
}
