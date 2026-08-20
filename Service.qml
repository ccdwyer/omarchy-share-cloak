import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "js/Config.js" as Config
import "js/State.js" as State
import "js/Events.js" as Events
import "js/Clients.js" as Clients
import "js/Marks.js" as Marks
import "js/Session.js" as Session
import "js/PwDump.js" as PwDump
import "js/Hypr.js" as Hypr
import "js/Mako.js" as Mako

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""

  // Host-injected from plugins[] only when the shell.json entry actually
  // carries the key. Undefined means "do not overwrite Config".
  property var autoCloak
  property var workspaceGuard
  property var dimOthers
  property var coverCards

  readonly property string moduleName: "io.github.chris.share-cloak"
  readonly property string pluginId: root.moduleName
  readonly property string pluginDir: {
    var u = String(Qt.resolvedUrl("."))
    if (u.indexOf("file://") === 0)
      u = u.slice(7)
    if (u.length > 1 && u.charAt(u.length - 1) === "/")
      u = u.slice(0, u.length - 1)
    return u
  }
  readonly property string home: Quickshell.env("HOME") || "/tmp"
  readonly property string stateHome: {
    var xdg = Quickshell.env("XDG_STATE_HOME")
    if (xdg && xdg.length)
      return xdg + "/share-cloak"
    return home + "/.local/state/share-cloak"
  }
  readonly property string sessionPath: stateHome + "/session.json"
  readonly property string marksPath: stateHome + "/marks.json"
  readonly property string probeBin: pluginDir + "/bin/cloak-probe"
  readonly property string probeSh: pluginDir + "/compat/cloak-probe.sh"

  property string probeCmd: probeSh
  property bool probeIsBinary: false
  property bool probeReady: false
  property bool hyprlandEventsLive: false
  property bool screencastEventSeen: false
  property bool socketWanted: true
  property int socketBackoffMs: 250
  property string hyprVersion: ""
  property var session: null
  property var lastClients: []
  property var workQueue: []
  property var workCurrent: null
  property var pendingBatches: []
  property var pendingMarked: []
  property var pendingMako: null
  property var pendingGetprops: []
  property string pendingCloakReason: ""
  property bool hydrating: true
  property int uiRevision: 0

  function probeCommand() {
    if (root.probeIsBinary)
      return root.probeBin
    return root.probeSh
  }

  function publish() {
    root.uiRevision = State.revision
  }

  function ipcCall(method, arg) {
    var a = arg === undefined || arg === null ? "" : String(arg)
    Quickshell.execDetached(["omarchy-shell", "shell", "call", root.moduleName, method, a])
  }

  // Only copy keys the host actually injected onto this Item.
  function applyHostSettings() {
    var s = {}
    if (root.autoCloak !== undefined && root.autoCloak !== null)
      s.autoCloak = root.autoCloak
    if (root.workspaceGuard !== undefined && root.workspaceGuard !== null)
      s.workspaceGuard = root.workspaceGuard
    if (root.dimOthers !== undefined && root.dimOthers !== null)
      s.dimOthers = root.dimOthers
    if (root.coverCards !== undefined && root.coverCards !== null)
      s.coverCards = root.coverCards
    var n = 0
    for (var k in s) {
      if (s.hasOwnProperty(k))
        n++
    }
    if (n)
      Config.applySettings(s)
    root.onSettingsChanged()
  }

  function onSettingsChanged() {
    if (!State.isCloaked())
      State.armFromAutoCloak(Config.autoCloak)
    root.publish()
  }

  function summonOverlay(payload) {
    var body = payload || "{}"
    if (shell && typeof shell.summon === "function") {
      shell.summon(root.pluginId, body)
      return "ok"
    }
    Quickshell.execDetached(["omarchy-shell", "shell", "summon", root.pluginId, body])
    return "ok"
  }

  function hideOverlay() {
    if (shell && typeof shell.hide === "function") {
      shell.hide(root.pluginId)
      return "ok"
    }
    Quickshell.execDetached(["omarchy-shell", "shell", "hide", root.pluginId])
    return "ok"
  }

  function dispatchHypr(request) {
    if (!request)
      return false
    try {
      Hyprland.dispatch(request)
      return true
    } catch (e) {
      enqueueWork(["hyprctl", "dispatch"].concat(String(request).split(" ")), null)
      return true
    }
  }

  function enqueueWork(command, done) {
    if (!command)
      return
    workQueue.push({ command: command, done: done || null })
    runWork()
  }

  function runWork() {
    if (workProc.running || root.workCurrent)
      return
    if (!workQueue.length)
      return
    root.workCurrent = workQueue.shift()
    workProc.command = root.workCurrent.command
    workProc.running = true
  }

  function persistSession() {
    if (!root.session)
      return
    sessionFile.setText(Session.serialize(root.session) + "\n")
    enqueueWork([root.probeCommand(), "secure", root.sessionPath], null)
  }

  function persistMarks() {
    marksFile.setText(Config.serializeMarks() + "\n")
    enqueueWork([root.probeCommand(), "secure", root.marksPath], null)
  }

  function persistNow() {
    if (root.hydrating)
      return
    persistMarks()
    if (root.session && Session.isCloakedPhase(root.session))
      persistSession()
  }

  function clearSessionFile() {
    root.session = null
    sessionFile.setText("{}\n")
  }

  function handleLine(line) {
    var ev = Events.parseLine(line)
    if (!ev)
      return
    if (ev.name === "screencast") {
      root.screencastEventSeen = true
      root.onScreencast(ev.fields)
      return
    }
    if (!State.isCloaked() && !root.session)
      return
    if (ev.name === "openwindow")
      root.onOpenWindow(ev.fields)
    else if (ev.name === "workspace" || ev.name === "workspacev2")
      root.onWorkspace(ev.fields)
    else if (ev.name === "closewindow")
      root.onCloseWindow(ev.fields)
    else if (ev.name === "movewindow" || ev.name === "movewindowv2")
      root.onMoveWindow(ev.fields)
  }

  function onScreencast(fields) {
    var active = !!(fields && fields.active)
    var kind = fields && fields.shareKind ? fields.shareKind : (active ? "monitor" : "none")
    State.setShare(active, kind, "screencast")
    root.publish()
    if (active) {
      if (kind === "window")
        State.windowShareWarned = true
      if (Config.autoCloak && !State.userOverride && !State.isCloaked())
        root.beginCloak("screencast")
      else if (State.isCloaked())
        root.summonOverlay(root.overlayPayload())
    } else if (State.isCloaked() && root.session && root.session.reason !== "manual") {
      root.beginUncloak("screencast-end")
    }
  }

  function onOpenWindow(fields) {
    if (!State.isCloaked() || !fields)
      return
    var fake = { class: fields["class"] || "", title: fields.title || "", address: fields.address }
    if (!Marks.isMarked(fake, Config.marks) && !Marks.classIsMarked(fake["class"], Config.marks))
      return
    Session.recordCatchAll(root.session, fields)
    dispatchHypr("movetoworkspacesilent special:cloak,address:" + Events.normalizeAddress(fields.address))
    persistTimer.restart()
    if (Config.coverCards)
      State.setCovers(Session.coverCards(root.session, State.currentWorkspace))
    root.publish()
  }

  function onWorkspace(fields) {
    if (!State.isCloaked() || !Config.workspaceGuard || !fields)
      return
    var name = String(fields.workspace || "")
    var id = fields.workspaceId
    if (id === undefined || isNaN(Number(id)))
      id = parseInt(name, 10)
    if (Events.isOurCloakWorkspace(name) || Events.isSpecialWorkspace(name))
      return
    var safe = (root.session && root.session.safeWorkspaces) || []
    if (Config.extraSafeWorkspaces && Config.extraSafeWorkspaces.length)
      safe = safe.concat(Config.extraSafeWorkspaces)
    var hidden = !State.isSafeWorkspace(id, name, safe)
    State.setWorkspaceHidden(hidden, name, id)
    if (Config.coverCards && root.session)
      State.setCovers(Session.coverCards(root.session, hidden ? "" : name))
    root.publish()
  }

  function onCloseWindow(fields) {
    if (!root.session || !fields)
      return
    Session.releaseOwnership(root.session, Events.normalizeAddress(fields.address), null)
    persistTimer.restart()
  }

  function onMoveWindow(fields) {
    if (!State.isCloaked() || !root.session || !fields)
      return
    var addr = Events.normalizeAddress(fields.address)
    var dest = String(fields.workspace || "")
    if (!addr)
      return
    if (dest && dest !== "special:cloak" && dest !== "cloak")
      Session.releaseOwnership(root.session, addr, ["move", "catch-all-move"])
    persistTimer.restart()
  }

  function overlayPayload() {
    return JSON.stringify({
      mode: State.overlayMode || "onair",
      phase: State.phase,
      windowShare: State.shareKind === "window",
      workspaceHidden: State.workspaceHidden,
      pendingRestore: State.pendingRestore
    })
  }

  function makoConfigPath() {
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    if (xdg && xdg.length)
      return xdg + "/mako/config"
    return root.home + "/.config/mako/config"
  }

  function beginCloak(reason) {
    if (State.transactionBusy)
      return "busy"
    if (State.phase === "cloaked")
      return "already"
    State.transactionBusy = true
    State.enterCloaking(reason || "manual")
    root.pendingCloakReason = reason || "manual"
    root.publish()
    enqueueWork(["hyprctl", "-j", "clients"], function(clientsText, clientsCode) {
      if (Number(clientsCode) !== 0) {
        root.abortCloak("hyprctl clients failed")
        return
      }
      enqueueWork(["hyprctl", "-j", "monitors"], function(monitorsText) {
        enqueueWork(["hyprctl", "-j", "workspaces"], function(wsText) {
          enqueueWork(["makoctl", "mode"], function(makoText, makoCode) {
            enqueueWork(["sh", "-c", "cat \"$1\" 2>/dev/null || true", "sh", root.makoConfigPath()], function(configText) {
              root.commitCloak(root.pendingCloakReason, clientsText, monitorsText, wsText, makoText, makoCode, configText)
            })
          })
        })
      })
    })
    return "ok"
  }

  function commitCloak(reason, clientsText, monitorsText, wsText, makoText, makoCode, configText) {
    var clients = Clients.captureAll(Clients.parseClients(clientsText))
    var monitors = Clients.parseList(monitorsText)
    var workspaces = Clients.parseList(wsText)
    var mako = Mako.inspect(makoText, makoCode, configText)
    root.lastClients = clients
    State.setClients(clients)
    root.pendingMako = mako

    var safe = Clients.safeWorkspacesFromMonitors(monitors)
    if ((!safe || !safe.length) && clients.length) {
      safe = [{
        id: clients[0].workspaceId,
        name: clients[0].workspaceName
      }]
    }
    var share = {
      kind: State.shareKind === "window" ? "window" : (State.shareActive ? "monitor" : "none"),
      owner: State.shareKind === "window" ? 1 : 0,
      source: reason || "manual"
    }
    var session = Session.create({
      reason: reason || "manual",
      share: share,
      safeWorkspaces: safe,
      specialWorkspaces: Clients.specialWorkspaceNames(workspaces),
      notification: {
        manager: mako.manager,
        owned: false,
        previousModes: mako.current || [],
        appliedMode: ""
      },
      clients: clients
    })

    var marked = []
    var unmarked = []
    var i
    for (i = 0; i < clients.length; i++) {
      if (Marks.isMarked(clients[i], Config.marks))
        marked.push(clients[i])
      else
        unmarked.push(clients[i])
    }
    Session.recordMoves(session, marked)
    if (Config.dimOthers)
      Session.recordDims(session, unmarked, Config.dimAlpha, Config.dimaround)
    root.session = session
    root.pendingMarked = marked.slice()

    State.setNotification(mako.alreadyActive ? "mako" : (mako.ok ? "mako" : "unmanaged"), mako.alreadyActive ? "" : (mako.ok ? "" : mako.note))
    if (Config.coverCards)
      State.setCovers(Session.coverCards(session, safe.length ? safe[0].name : ""))
    if (safe.length)
      State.setWorkspaceHidden(false, safe[0].name, safe[0].id)
    root.publish()
    persistSession()
    root.summonOverlay(root.overlayPayload())

    var cmds = Hypr.cloakCommands(marked, unmarked, {
      dimOthers: Config.dimOthers,
      dimAlpha: Config.dimAlpha,
      dimaround: Config.dimaround
    })
    var batches = Hypr.chunk(cmds, 20)
    root.pendingBatches = batches.slice()
    root.flushBatches(function(ok) {
      if (!ok && marked.length) {
        root.verifyAndFinishCloak(false)
        return
      }
      root.verifyAndFinishCloak(true)
    })
  }

  function splitRetry(commands, done) {
    if (!commands.length) {
      done(true)
      return
    }
    var cmd = commands.shift()
    enqueueWork(Hypr.batchArgv(cmd), function(text, code) {
      if (Number(code) !== 0) {
        done(false)
        return
      }
      root.splitRetry(commands, done)
    })
  }

  function flushBatches(done) {
    if (!root.pendingBatches.length) {
      if (done)
        done(true)
      return
    }
    var batch = root.pendingBatches.shift()
    enqueueWork(Hypr.batchArgv(batch), function(text, code) {
      if (Number(code) !== 0) {
        root.splitRetry(Hypr.splitBatch(batch), function(ok) {
          if (!ok) {
            if (done)
              done(false)
            return
          }
          root.flushBatches(done)
        })
        return
      }
      root.flushBatches(done)
    })
  }

  function verifyAndFinishCloak(batchOk) {
    enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
      var live = Clients.captureAll(Clients.parseClients(text))
      root.lastClients = live
      State.setClients(live)
      var leaked = Clients.markedStillVisible(root.pendingMarked, live)
      if (Number(code) !== 0 || leaked.length) {
        root.rollbackCloak(live, leaked.length ? "marked windows still visible" : "hyprctl verify failed")
        return
      }
      if (root.session)
        root.session.phase = "cloaked"
      State.enterCloaked(root.pendingCloakReason)
      State.transactionBusy = false
      persistSession()
      root.publish()
      root.applyMako(root.pendingMako)
    })
  }

  function rollbackCloak(live, reason) {
    var plan = Session.restorePlan(root.session || Session.empty(), live || [])
    var cmds = Hypr.restoreCommands(plan)
    root.pendingBatches = Hypr.chunk(cmds, 20)
    root.flushBatches(function() {
      State.setError(reason || "cloak failed")
      State.setToast("cloak failed — protection not active")
      State.enterResting(Config.autoCloak, true)
      State.overlayMode = "toast"
      root.summonOverlay(JSON.stringify({ mode: "toast" }))
      toastTimer.restart()
      clearSessionFile()
      State.transactionBusy = false
      root.publish()
    })
  }

  function abortCloak(reason) {
    State.setError(reason || "cloak failed")
    State.setToast("cloak failed — protection not active")
    State.enterResting(Config.autoCloak, true)
    State.overlayMode = "toast"
    root.summonOverlay(JSON.stringify({ mode: "toast" }))
    toastTimer.restart()
    clearSessionFile()
    State.transactionBusy = false
    root.publish()
  }

  function applyMako(mako) {
    if (!mako) {
      State.setNotification("unmanaged", "notifications: unmanaged")
      return
    }
    if (mako.alreadyActive) {
      State.setNotification("mako", "")
      persistSession()
      root.publish()
      return
    }
    var modes = (mako.tryModes || []).slice()
    if (!modes.length) {
      State.setNotification("unmanaged", "notifications: unmanaged")
      persistSession()
      root.publish()
      return
    }
    root.tryMakoModes(modes)
  }

  function tryMakoModes(modes) {
    if (!modes.length) {
      State.setNotification("unmanaged", "notifications: unmanaged")
      persistSession()
      root.publish()
      return
    }
    var mode = modes.shift()
    enqueueWork(Mako.applyArgv(mode), function(text, code) {
      if (Number(code) === 0) {
        Session.recordMakoAdded(root.session, mode)
        State.setNotification("mako", "")
        persistSession()
        root.publish()
        return
      }
      root.tryMakoModes(modes)
    })
  }

  function beginUncloak(reason) {
    if (State.transactionBusy)
      return "busy"
    if (!root.session && !State.pendingRestore)
      return "empty"
    if (reason === "manual")
      State.userOverride = true
    State.transactionBusy = true
    State.enterUncloaking()
    root.publish()
    enqueueWork(["hyprctl", "-j", "clients"], function(clientsText) {
      root.gatherDimProps(reason, clientsText)
    })
    return "ok"
  }

  function gatherDimProps(reason, clientsText) {
    var live = Clients.captureAll(Clients.parseClients(clientsText))
    var need = []
    var muts = (root.session && root.session.mutations) || []
    var seen = {}
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i]
      if (!m || !m.owned || !m.address)
        continue
      if (m.kind !== "alpha" && m.kind !== "dimaround")
        continue
      var key = m.address + ":" + m.kind
      if (seen[key])
        continue
      seen[key] = true
      need.push({ address: m.address, kind: m.kind })
    }
    root.pendingGetprops = need
    root.fillGetprops(live, function(enriched) {
      root.commitUncloak(reason, enriched)
    })
  }

  function fillGetprops(live, done) {
    if (!root.pendingGetprops.length) {
      done(live)
      return
    }
    var job = root.pendingGetprops.shift()
    enqueueWork(Hypr.getpropArgv(job.address, job.kind === "dimaround" ? "dimaround" : "alpha"), function(text, code) {
      var value = Number(code) === 0 ? Hypr.parseGetprop(text) : null
      if (value !== null) {
        for (var i = 0; i < live.length; i++) {
          if (live[i].address === job.address) {
            if (job.kind === "dimaround")
              live[i].dimaround = value
            else
              live[i].alpha = value
          }
        }
      }
      root.fillGetprops(live, done)
    })
  }

  function commitUncloak(reason, live) {
    var plan = Session.restorePlan(root.session || Session.empty(), live)
    State.setUnrestorable(plan.unrestorable || [])
    var cmds = Hypr.restoreCommands(plan)
    var batches = Hypr.chunk(cmds, 20)
    var makoStep = null
    var steps = plan.steps || []
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && steps[i].kind === "mako-mode" && steps[i].pluginAdded)
        makoStep = steps[i]
    }
    root.pendingBatches = batches.slice()
    root.flushBatches(function() {
      if (makoStep && makoStep.to)
        enqueueWork(Mako.restoreArgv(makoStep.to), null)
      root.finishUncloak()
    })
  }

  function finishUncloak() {
    var keep = (State.unrestorable || []).length > 0
    var saved = keep ? State.unrestorable.slice() : []
    var msg = State.toast
    State.enterResting(Config.autoCloak, keep)
    if (keep) {
      State.setUnrestorable(saved)
      if (msg)
        State.setToast(msg)
      State.overlayMode = "toast"
      root.summonOverlay(JSON.stringify({ mode: "toast" }))
      toastTimer.restart()
    } else {
      root.hideOverlay()
    }
    clearSessionFile()
    State.transactionBusy = false
    root.publish()
    persistMarks()
  }

  function dismissToast() {
    State.setToast("")
    State.setUnrestorable([])
    State.overlayMode = "onair"
    root.hideOverlay()
    root.publish()
  }

  function toggleCloak() {
    if (State.pendingRestore && root.session)
      return root.beginUncloak("restore")
    if (State.isCloaked())
      return root.beginUncloak("manual")
    return root.beginCloak("manual")
  }

  function markFocused() {
    enqueueWork(["hyprctl", "-j", "activewindow"], function(text) {
      var client = null
      try {
        client = JSON.parse(String(text || "").trim() || "null")
      } catch (e) {
        client = null
      }
      if (!client || !client.address)
        client = Clients.focused(root.lastClients)
      if (!client)
        return
      var klass = String(client["class"] || "")
      if (!klass)
        return
      Config.setMarks(Marks.addClass(Config.marks, klass, ".*"))
      persistMarks()
      if (State.isCloaked()) {
        var cap = Clients.capture(client)
        if (cap && cap.address && !Clients.isOnCloak(cap)) {
          Session.recordMoves(root.session, [cap])
          dispatchHypr("movetoworkspacesilent special:cloak,address:" + cap.address)
          persistSession()
        }
        enqueueWork(["hyprctl", "-j", "clients"], function(clientsText) {
          root.cloakNewlyMarked(klass, clientsText)
        })
      }
      root.publish()
    })
    return "ok"
  }

  function cloakNewlyMarked(klass, clientsText) {
    var clients = Clients.captureAll(Clients.parseClients(clientsText))
    root.lastClients = clients
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i]
      if (!c || Clients.isOnCloak(c))
        continue
      if (String(c["class"] || "").toLowerCase() !== String(klass).toLowerCase())
        continue
      if (!Session.findOwnedMove(root.session, c.address))
        Session.recordMoves(root.session, [c])
      dispatchHypr("movetoworkspacesilent special:cloak,address:" + c.address)
    }
    persistSession()
  }

  function toggleMark(className) {
    Config.setMarks(Marks.toggleClass(Config.marks, className, ".*"))
    persistMarks()
    root.publish()
    return "ok"
  }

  function openMarks() {
    State.overlayMode = "marks"
    enqueueWork(["hyprctl", "-j", "clients"], function(text) {
      var clients = Clients.captureAll(Clients.parseClients(text))
      root.lastClients = clients
      State.setClients(clients)
      root.publish()
      root.summonOverlay(JSON.stringify({ mode: "marks" }))
    })
    return "ok"
  }

  function onPwDump(text) {
    var result = null
    var trimmed = String(text || "").trim()
    if (!trimmed)
      return
    try {
      var parsed = JSON.parse(trimmed)
      if (parsed && parsed.hasOwnProperty("screencasting"))
        result = parsed
    } catch (e) {
      result = null
    }
    if (!result)
      result = PwDump.detect(trimmed)
    if (!result)
      return
    if (result.screencasting) {
      var kind = result.windowShare ? "window" : "monitor"
      State.setShare(true, kind, "pw-dump")
      root.publish()
      if (Config.autoCloak && !State.userOverride && !State.isCloaked() && !root.screencastEventSeen)
        root.beginCloak("pw-dump")
    } else if (!root.screencastEventSeen && State.shareSource === "pw-dump" && State.shareActive) {
      State.setShare(false, "none", "pw-dump")
      root.publish()
      if (State.isCloaked() && root.session && root.session.reason === "pw-dump")
        root.beginUncloak("pw-dump-end")
    }
  }

  function requestPwDump() {
    if (root.probeReady)
      enqueueWork([root.probeCommand(), "pw-dump"], function(text) { root.onPwDump(text) })
    else
      enqueueWork(["pw-dump"], function(text) { root.onPwDump(text) })
  }

  function statusJson() {
    var snap = State.snapshot()
    snap.id = root.pluginId
    snap.hyprVersion = root.hyprVersion
    snap.probe = root.probeCmd
    snap.probeIsBinary = root.probeIsBinary
    snap.socket = eventSock.connected || root.hyprlandEventsLive
    snap.screencastEventSeen = root.screencastEventSeen
    snap.autoCloak = Config.autoCloak
    snap.marks = Config.marks.length
    return JSON.stringify(snap)
  }

  function ping() { return "ok" }
  function status() { return root.statusJson() }
  function cloak() { return root.beginCloak("manual") }
  function uncloak() { return root.beginUncloak("manual") }
  function toggle() { return root.toggleCloak() }
  function restore() { return root.beginUncloak("restore") }

  Process {
    id: workProc
    running: false
    stdout: StdioCollector {
      id: workOut
      waitForEnd: true
    }
    onExited: {
      var text = workOut.text
      var job = root.workCurrent
      var code = exitCode
      root.workCurrent = null
      if (job && job.done) {
        try {
          job.done(text, code)
        } catch (e) {
          console.warn("share-cloak: work callback failed", e)
        }
      }
      root.runWork()
    }
  }

  Process {
    id: versionProc
    command: ["hyprctl", "-j", "version"]
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          var v = JSON.parse(text)
          root.hyprVersion = String((v && (v.tag || v.version || v.commit)) || text).trim()
        } catch (e) {
          root.hyprVersion = String(text || "").trim()
        }
      }
    }
  }

  Process {
    id: probeWhichProc
    command: ["sh", "-c", "test -x \"$1\" && echo binary || echo missing", "sh", root.probeBin]
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = String(text || "").trim()
        if (out === "binary") {
          root.probeIsBinary = true
          root.probeCmd = root.probeBin
        } else {
          root.probeIsBinary = false
          root.probeCmd = root.probeSh
        }
        State.probeIsBinary = root.probeIsBinary
        root.probeReady = true
        enqueueWork([root.probeCommand(), "init-state", root.stateHome], function() {
          marksFile.reload()
          sessionFile.reload()
        })
      }
    }
  }

  Socket {
    id: eventSock
    path: {
      try {
        if (Hyprland.eventSocketPath)
          return Hyprland.eventSocketPath
      } catch (e) {}
      var runtime = Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
      var sig = Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") || ""
      if (!sig)
        return ""
      return runtime + "/hypr/" + sig + "/.socket2.sock"
    }
    connected: false
    parser: SplitParser {
      onRead: function(line) {
        root.handleLine(line)
      }
    }
    onConnectedChanged: {
      if (connected) {
        root.socketBackoffMs = 250
        reconnectTimer.stop()
      } else if (root.socketWanted && !root.hyprlandEventsLive) {
        reconnectTimer.interval = root.socketBackoffMs
        reconnectTimer.start()
      }
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event)
        return
      root.hyprlandEventsLive = true
      if (eventSock.connected)
        eventSock.connected = false
      var line = String(event.name || "") + ">>" + String(event.data || "")
      root.handleLine(line)
    }
  }

  FileView {
    id: sessionFile
    path: root.sessionPath
    atomicWrites: true
    printErrors: false
    watchChanges: false
    onLoaded: {
      var raw = text()
      var result = Session.load(raw)
      root.hydrating = false
      if (result.ok && result.session && Session.isCloakedPhase(result.session) && (result.session.mutations || []).length) {
        root.session = result.session
        State.offerRestore("Cloak interrupted — Super+F9 restores your windows")
        root.summonOverlay(JSON.stringify({ mode: "restore", pendingRestore: true }))
      }
      root.publish()
    }
    onLoadFailed: {
      root.hydrating = false
      root.publish()
    }
    onSaved: enqueueWork([root.probeCommand(), "secure", root.sessionPath], null)
  }

  FileView {
    id: marksFile
    path: root.marksPath
    atomicWrites: true
    printErrors: false
    watchChanges: true
    onLoaded: {
      Config.loadMarks(text())
      root.publish()
    }
    onLoadFailed: root.publish()
    onFileChanged: reload()
  }

  Timer {
    id: socketFallbackTimer
    interval: 2000
    repeat: false
    running: true
    onTriggered: {
      if (root.hyprlandEventsLive)
        return
      if (eventSock.path && eventSock.path.length > 0)
        eventSock.connected = root.socketWanted
    }
  }

  Timer {
    id: reconnectTimer
    interval: 250
    repeat: false
    onTriggered: {
      root.socketBackoffMs = Math.min(root.socketBackoffMs * 2, 5000)
      eventSock.connected = false
      Qt.callLater(function() {
        if (!root.hyprlandEventsLive)
          eventSock.connected = root.socketWanted
      })
    }
  }

  Timer {
    id: pwDumpTimer
    interval: 2000
    repeat: true
    running: true
    onTriggered: root.requestPwDump()
  }

  Timer {
    id: persistTimer
    interval: 200
    repeat: false
    onTriggered: root.persistNow()
  }

  Timer {
    id: toastTimer
    interval: 4500
    repeat: false
    onTriggered: root.dismissToast()
  }

  Timer {
    id: liveTimer
    interval: 1000
    repeat: true
    running: true
    onTriggered: {
      if (!State.isCloaked())
        return
      enqueueWork(["hyprctl", "-j", "clients"], function(text) {
        var live = Clients.captureAll(Clients.parseClients(text))
        root.lastClients = live
        State.setClients(live)
        if (root.session)
          Session.reconcileWithLive(root.session, live)
        root.publish()
      })
    }
  }

  IpcHandler {
    target: "io.github.chris.share-cloak"

    function toggle(arg: string): string { return root.toggleCloak() }
    function cloak(arg: string): string { return root.beginCloak("manual") }
    function uncloak(arg: string): string { return root.beginUncloak("manual") }
    function restore(arg: string): string { return root.beginUncloak("restore") }
    function markFocused(arg: string): string { return root.markFocused() }
    function openMarks(arg: string): string { return root.openMarks() }
    function ping(arg: string): string { return "ok" }
    function status(arg: string): string { return root.statusJson() }
    function summon(arg: string): string { return root.summonOverlay(arg && arg.length ? arg : root.overlayPayload()) }
  }

  Component.onCompleted: {
    root.applyHostSettings()
    probeWhichProc.running = true
    versionProc.running = true
    root.publish()
  }
}
