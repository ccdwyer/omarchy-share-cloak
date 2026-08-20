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
import "js/Binds.js" as Binds

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
  property var lastEventAt: 0
  property bool socketWanted: true
  property int socketBackoffMs: 250
  property string hyprVersion: ""
  property var session: null
  property var lastClients: []
  property var workQueue: []
  property var workCurrent: null
  property var pendingBatches: []
  property var pendingMarked: []
  property var pendingUnmarked: []
  property var pendingMako: null
  property var pendingGetprops: []
  property var pendingTiled: []
  property var pendingFloating: []
  property var ownedBinds: []
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

  // Schema keys are applied only by BarWidget.pushSettings (bar.layout
  // entry). plugins[] copies of the same keys are ignored so load order
  // cannot clobber the widget.
  function applyHostSettings() {
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
    root.lastEventAt = Date.now()
    root.hyprlandEventsLive = true
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
    var addr = Events.normalizeAddress(fields.address)
    root.cloakClientByAddress(addr, fields, function(ok) {
      if (!ok) {
        State.setToast("catch-all failed — a marked window is still visible")
        root.publish()
        return
      }
      persistSession()
      if (Config.coverCards)
        State.setCovers(Session.coverCards(root.session, State.currentWorkspace))
      root.publish()
    })
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
    var floating = Hypr.floatingMarked(marked)
    var tiled = Hypr.tiledMarked(marked)
    Session.recordMoves(session, floating)
    root.session = session
    root.pendingMarked = marked.slice()
    root.pendingFloating = floating.slice()
    root.pendingTiled = tiled.slice()
    root.pendingUnmarked = unmarked.slice()

    State.setNotification(mako.alreadyActive ? "mako" : (mako.ok ? "mako" : "unmanaged"), mako.alreadyActive ? "" : (mako.ok ? "" : mako.note))
    if (Config.coverCards)
      State.setCovers(Session.coverCards(session, safe.length ? safe[0].name : ""))
    if (safe.length)
      State.setWorkspaceHidden(false, safe[0].name, safe[0].id)
    root.publish()
    persistSession()
    root.summonOverlay(root.overlayPayload())

    root.snapshotTiledThenCloak(tiled, floating)
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

  function snapshotTiledThenCloak(tiled, floating) {
    var jobs = []
    var i
    for (i = 0; i < (tiled || []).length; i++)
      jobs.push({ address: tiled[i].address, kind: "alpha" })
    root.pendingGetprops = jobs
    root.fillGetprops((tiled || []).slice(), function(enriched) {
      Session.recordHideInPlace(root.session, enriched)
      persistSession()
      var cmds = Hypr.hideInPlaceCommands(enriched).concat(Hypr.moveCommands(floating))
      root.pendingBatches = Hypr.chunk(cmds, 20)
      root.flushBatches(function(ok) {
        root.verifyAndFinishCloak(ok)
      })
    })
  }

  function verifyAndFinishCloak(moveOk) {
    enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
      var parsed = Clients.parseClientsResult(text, code)
      if (!parsed.ok) {
        root.rollbackCloak([], "hyprctl verify failed")
        return
      }
      var live = parsed.clients
      root.lastClients = live
      State.setClients(live)
      var leaked = Clients.markedStillVisible(root.pendingFloating, live)
      var displaced = Clients.tiledLayoutChanged(root.pendingTiled, live)
      if (!moveOk || leaked.length || displaced.length) {
        var why = leaked.length ? "marked floating windows still visible" : (displaced.length ? "tiled layout changed" : "cloak batch failed")
        root.rollbackCloak(live, why)
        return
      }
      if (root.session)
        root.session.phase = "cloaked"
      State.enterCloaked(root.pendingCloakReason)
      persistSession()
      root.publish()
      root.snapshotAndDim(function() {
        State.transactionBusy = false
        root.applyMako(root.pendingMako)
        root.publish()
      })
    })
  }

  function snapshotAndDim(done) {
    if (!Config.dimOthers || !(root.pendingUnmarked && root.pendingUnmarked.length)) {
      if (done)
        done()
      return
    }
    var list = root.pendingUnmarked.slice()
    var jobs = []
    for (var i = 0; i < list.length; i++) {
      jobs.push({ address: list[i].address, kind: "alpha" })
      if (Config.dimaround)
        jobs.push({ address: list[i].address, kind: "dimaround" })
    }
    root.pendingGetprops = jobs
    root.fillGetprops(list, function(enriched) {
      Session.recordDims(root.session, enriched, Config.dimAlpha, Config.dimaround)
      persistSession()
      var dimmable = []
      for (var j = 0; j < enriched.length; j++) {
        if (enriched[j].alpha !== undefined)
          dimmable.push(enriched[j])
      }
      var cmds = Hypr.dimCommands(dimmable, {
        dimAlpha: Config.dimAlpha,
        dimaround: Config.dimaround
      })
      root.pendingBatches = Hypr.chunk(cmds, 20)
      root.flushBatches(function(dimOk) {
        if (!dimOk)
          console.warn("share-cloak: optional dim batch failed; vanish still holds")
        if (done)
          done()
      })
    })
  }

  function keepSessionAndOfferRestore(note) {
    if (root.session) {
      root.session.phase = "cloaked"
      persistSession()
    }
    State.enterCloaked(root.pendingCloakReason || "manual")
    State.offerRestore(note || "Cloak interrupted — Super+F9 restores your windows")
    State.transactionBusy = false
    root.summonOverlay(JSON.stringify({ mode: "restore", pendingRestore: true }))
    root.publish()
  }

  function rollbackCloak(live, reason) {
    var plan = Session.restorePlan(root.session || Session.empty(), live || [])
    var cmds = Hypr.restoreCommands(plan)
    root.pendingBatches = Hypr.chunk(cmds, 20)
    root.flushBatches(function(ok) {
      enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
        var parsed = Clients.parseClientsResult(text, code)
        var after = parsed.ok ? parsed.clients : (live || [])
        var stuck = parsed.ok ? Session.stillOnCloak(root.session, after) : ["unverified"]
        if (!ok || !parsed.ok || stuck.length) {
          root.keepSessionAndOfferRestore(reason || "cloak failed — Super+F9 restores your windows")
          return
        }
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
    })
  }

  function abortCloak(reason) {
    if (root.session && root.session.mutations && root.session.mutations.length) {
      root.keepSessionAndOfferRestore(reason || "cloak failed — Super+F9 restores your windows")
      return
    }
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
      persistSession()
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
      if (Number(code) !== 0) {
        root.tryMakoModes(modes)
        return
      }
      enqueueWork(["makoctl", "mode"], function(nowText, nowCode) {
        if (Number(nowCode) === 0 && Mako.isVerifiedCurrent(nowText, mode)) {
          Session.recordMakoAdded(root.session, mode)
          State.setNotification("mako", "")
          persistSession()
          root.publish()
          return
        }
        root.tryMakoModes(modes)
      })
    })
  }

  function beginUncloak(reason) {
    if (State.transactionBusy)
      return "busy"
    if (!root.session && !State.pendingRestore)
      return "empty"
    if (!root.session) {
      State.setToast("no cloak session to restore")
      root.publish()
      return "empty"
    }
    if (reason === "manual")
      State.userOverride = true
    State.transactionBusy = true
    State.enterUncloaking()
    root.publish()
    enqueueWork(["hyprctl", "-j", "clients"], function(clientsText, clientsCode) {
      var parsed = Clients.parseClientsResult(clientsText, clientsCode)
      if (!parsed.ok) {
        root.keepSessionAndOfferRestore("restore failed — could not read windows")
        return
      }
      root.gatherDimProps(reason, parsed.clients)
    })
    return "ok"
  }

  function gatherDimProps(reason, live) {
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
    root.flushBatches(function(ok) {
      if (!ok) {
        root.keepSessionAndOfferRestore("restore failed — Super+F9 to retry")
        return
      }
      enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
        var parsed = Clients.parseClientsResult(text, code)
        if (!parsed.ok) {
          root.keepSessionAndOfferRestore("restore failed — could not verify windows")
          return
        }
        var stuck = Session.stillOnCloak(root.session, parsed.clients)
        if (stuck.length) {
          root.keepSessionAndOfferRestore("restore incomplete — Super+F9 to retry")
          return
        }
        if (makoStep && makoStep.to) {
          root.restoreMakoThenFinish(makoStep.to)
          return
        }
        root.finishUncloak()
      })
    })
  }

  function restoreMakoThenFinish(mode) {
    enqueueWork(Mako.restoreArgv(mode), function(text, code) {
      if (Number(code) !== 0) {
        root.keepSessionAndOfferRestore("notifications restore failed — Super+F9 to retry")
        return
      }
      enqueueWork(["makoctl", "mode"], function(nowText, nowCode) {
        if (Number(nowCode) !== 0 || Mako.isVerifiedCurrent(nowText, mode)) {
          root.keepSessionAndOfferRestore("notifications still suppressed — Super+F9 to retry")
          return
        }
        root.finishUncloak()
      })
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

  function cloakClientByAddress(addr, fields, done) {
    enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
      var parsed = Clients.parseClientsResult(text, code)
      if (!parsed.ok) {
        if (done)
          done(false)
        return
      }
      var found = null
      for (var i = 0; i < parsed.clients.length; i++) {
        if (parsed.clients[i].address === addr) {
          found = parsed.clients[i]
          break
        }
      }
      if (!found) {
        if (done)
          done(false)
        return
      }
      root.cloakOneClient(found, fields, done)
    })
  }

  function cloakOneClient(client, fields, done) {
    if (client.floating) {
      root.cloakAddressChecked(client.address, function(ok) {
        if (ok) {
          if (fields)
            Session.recordCatchAll(root.session, fields)
          else if (!Session.findOwnedMove(root.session, client.address))
            Session.recordMoves(root.session, [client])
        }
        if (done)
          done(ok)
      })
      return
    }
    enqueueWork(Hypr.getpropArgv(client.address, "alpha"), function(text, code) {
      if (Number(code) === 0) {
        var v = Hypr.parseGetprop(text)
        if (v !== null)
          client.alpha = v
      }
      enqueueWork(Hypr.batchArgv(Hypr.formatBatch(Hypr.hideInPlaceCommands([client]))), function(t2, c2) {
        if (Number(c2) !== 0) {
          if (done)
            done(false)
          return
        }
        enqueueWork(["hyprctl", "-j", "clients"], function(t3, c3) {
          var parsed = Clients.parseClientsResult(t3, c3)
          var displaced = parsed.ok ? Clients.tiledLayoutChanged([client], parsed.clients) : [client]
          var ok = parsed.ok && displaced.length === 0
          if (ok && !Session.findOwnedMove(root.session, client.address))
            Session.recordHideInPlace(root.session, [client])
          if (done)
            done(ok)
        })
      })
    })
  }

  function cloakAddressChecked(addr, done) {
    if (!addr) {
      if (done)
        done(false)
      return
    }
    enqueueWork(Hypr.dispatchMoveArgv(addr), function(text, code) {
      if (Number(code) !== 0) {
        enqueueWork(Hypr.batchArgv(Hypr.moveToCloak(addr)), function(t2, c2) {
          root.verifyAddressOnCloak(addr, done)
        })
        return
      }
      root.verifyAddressOnCloak(addr, done)
    })
  }

  function verifyAddressOnCloak(addr, done) {
    enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
      var parsed = Clients.parseClientsResult(text, code)
      if (!parsed.ok) {
        if (done)
          done(false)
        return
      }
      var leaked = Clients.markedStillVisible([{ address: addr }], parsed.clients)
      if (done)
        done(leaked.length === 0)
    })
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
        enqueueWork(["hyprctl", "-j", "clients"], function(clientsText, clientsCode) {
          var parsed = Clients.parseClientsResult(clientsText, clientsCode)
          if (!parsed.ok) {
            State.setToast("could not hide newly marked windows")
            root.publish()
            return
          }
          root.cloakNewlyMarked(klass, parsed.clients)
        })
      }
      root.publish()
    })
    return "ok"
  }

  function cloakNewlyMarked(klass, clients) {
    var list = clients || []
    root.lastClients = list
    var pending = []
    for (var i = 0; i < list.length; i++) {
      var c = list[i]
      if (!c || Clients.isOnCloak(c))
        continue
      if (String(c["class"] || "").toLowerCase() !== String(klass).toLowerCase())
        continue
      pending.push(c)
    }
    root.cloakNewlyMarkedNext(pending)
  }

  function cloakNewlyMarkedNext(pending) {
    if (!pending.length)
      return
    var c = pending.shift()
    root.cloakOneClient(c, null, function(ok) {
      if (ok)
        persistSession()
      else
        State.setToast("failed to hide " + (c["class"] || "window"))
      root.publish()
      root.cloakNewlyMarkedNext(pending)
    })
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
    var stale = !root.lastEventAt || (Date.now() - Number(root.lastEventAt) > 4000)
    var allowPw = !root.screencastEventSeen || stale
    if (!allowPw)
      return
    if (result.screencasting) {
      var kind = result.windowShare ? "window" : "monitor"
      State.setShare(true, kind, "pw-dump")
      root.publish()
      if (Config.autoCloak && !State.userOverride && !State.isCloaked())
        root.beginCloak("pw-dump")
    } else if (State.shareActive && (State.shareSource === "pw-dump" || stale)) {
      State.setShare(false, "none", "pw-dump")
      root.publish()
      if (State.isCloaked() && root.session && root.session.reason !== "manual")
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

  function installBinds() {
    root.ownedBinds = []
    enqueueWork(["hyprctl", "-j", "binds"], function(text, code) {
      if (Number(code) !== 0) {
        State.setBindStatus("failed", "could not read keybinds — use the bar chip")
        root.publish()
        return
      }
      root.installOneBind("F9", "toggle", text, function() {
        enqueueWork(["hyprctl", "-j", "binds"], function(t2, c2) {
          root.installOneBind("F10", "markFocused", Number(c2) === 0 ? t2 : text, function() {
            if (!(root.ownedBinds && root.ownedBinds.length))
              State.setBindStatus(State.bindStatus || "failed", State.bindNote || "Super+F9/F10 not installed — use the bar chip")
            root.publish()
          })
        })
      })
    })
  }

  function installOneBind(key, method, bindsText, done) {
    var binds = Binds.parseBinds(bindsText)
    if (Binds.conflict(binds, Binds.SUPER, key, root.pluginId)) {
      State.setBindStatus("conflict", "Super+" + key + " is already bound — use the bar chip")
      if (done)
        done()
      return
    }
    if (Binds.oursPresent(binds, Binds.SUPER, key, root.pluginId)) {
      root.ownedBinds = (root.ownedBinds || []).concat([{ key: key, method: method }])
      if (done)
        done()
      return
    }
    enqueueWork(Binds.bindArgv(key, method), function(text, code) {
      if (Number(code) !== 0) {
        State.setBindStatus("failed", "could not bind Super+" + key + " — use the bar chip")
        if (done)
          done()
        return
      }
      enqueueWork(["hyprctl", "-j", "binds"], function(t2, c2) {
        var now = Number(c2) === 0 ? Binds.parseBinds(t2) : []
        if (Binds.oursPresent(now, Binds.SUPER, key, root.pluginId)) {
          root.ownedBinds = (root.ownedBinds || []).concat([{ key: key, method: method }])
        } else {
          State.setBindStatus("failed", "Super+" + key + " bind did not stick — use the bar chip")
        }
        if (done)
          done()
      })
    })
  }

  function teardownBinds() {
    var list = (root.ownedBinds || []).slice()
    root.ownedBinds = []
    for (var i = 0; i < list.length; i++)
      enqueueWork(Binds.unbindArgv(list[i].key), null)
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
      root.lastEventAt = Date.now()
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
      enqueueWork(["hyprctl", "-j", "clients"], function(text, code) {
        var parsed = Clients.parseClientsResult(text, code)
        if (!parsed.ok)
          return
        root.lastClients = parsed.clients
        State.setClients(parsed.clients)
        if (root.session)
          Session.reconcileWithLive(root.session, parsed.clients)
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
    root.installBinds()
    root.publish()
  }

  Component.onDestruction: root.teardownBinds()
}
