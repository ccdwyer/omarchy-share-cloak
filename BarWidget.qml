import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "js/Config.js" as Config
import "js/State.js" as State
import "js/Binds.js" as Binds

BarWidget {
  id: root
  moduleName: "io.github.chris.share-cloak"

  // Host-injected from the bar.layout entry. Sole writer of schema keys
  // into Config.js; the service entry does not apply the same keys.
  property bool autoCloak: true
  property bool workspaceGuard: true
  property bool dimOthers: true
  property bool coverCards: true

  property string barState: "idle"
  property string chipText: "cloak"
  property string phase: "idle"
  property string bindStatus: "offer"
  property string bindNote: ""
  property string bindChipText: "Set hotkey"
  property bool offerBinds: true
  property bool canRemoveBinds: false

  readonly property var cloakService: {
    if (bar && bar.pluginRegistry && typeof bar.pluginRegistry.serviceFor === "function") {
      var a = bar.pluginRegistry.serviceFor(root.moduleName)
      if (a)
        return a
    }
    return null
  }

  function pushSettings() {
    Config.applySettings({
      autoCloak: root.autoCloak,
      workspaceGuard: root.workspaceGuard,
      dimOthers: root.dimOthers,
      coverCards: root.coverCards
    })
    if (cloakService && typeof cloakService.onSettingsChanged === "function")
      cloakService.onSettingsChanged()
  }

  function refresh() {
    var snap = State.snapshot()
    root.barState = snap.barState
    root.phase = snap.phase
    root.chipText = State.chipLabel()
    root.bindStatus = snap.bindStatus || ""
    root.bindNote = snap.bindNote || ""
    var offer = Binds.offer || {}
    root.offerBinds = !!offer.canInstall
    root.canRemoveBinds = !!offer.canRemove
    root.bindChipText = String(offer.chipLabel || (root.offerBinds ? "Set hotkey" : "keys"))
  }

  function callToggle() {
    if (cloakService && typeof cloakService.toggleCloak === "function") {
      cloakService.toggleCloak()
      return
    }
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "toggle", ""])
  }

  function openMarks() {
    if (cloakService && typeof cloakService.openMarks === "function") {
      cloakService.openMarks()
      return
    }
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "openMarks", ""])
  }

  function installBinds() {
    if (cloakService && typeof cloakService.installBinds === "function") {
      cloakService.installBinds("")
      return
    }
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "installBinds", ""])
  }

  function removeBinds() {
    if (cloakService && typeof cloakService.removeBinds === "function") {
      cloakService.removeBinds("")
      return
    }
    Quickshell.execDetached(["omarchy-shell", root.moduleName, "removeBinds", ""])
  }

  function tooltip() {
    var snap = State.snapshot()
    var extra = snap.bindNote ? (" " + snap.bindNote) : ""
    var err = snap.lastError || snap.toast || ""
    if (err)
      extra = " " + err + extra
    if (root.barState === "onair")
      return "Share Cloak — ON AIR. Left: uncloak. Right: mark windows." + extra
    if (root.barState === "restore")
      return "Share Cloak — interrupted session. Left: restore windows." + extra
    if (root.barState === "armed")
      return "Share Cloak — watching for a share. Left: cloak now. Right: mark windows." + extra
    return "Share Cloak — auto-cloak is off. Left: cloak. Right: mark windows." + extra
  }

  function bindTooltip() {
    if (root.canRemoveBinds)
      return "Share Cloak hotkeys: " + (root.bindNote || root.bindChipText) + ". Right-click to remove this plugin's bindings.lua block."
    if (root.offerBinds)
      return (root.bindNote || "Set Super+F9 / Super+F10") + " — writes only free combos; occupied stock Omarchy hotkeys are skipped. Never unbinds someone else's key."
    if (root.bindNote)
      return "Share Cloak hotkeys unavailable: " + root.bindNote
    return "Share Cloak hotkeys"
  }

  implicitWidth: visible ? row.implicitWidth : 0
  implicitHeight: row.implicitHeight

  onAutoCloakChanged: root.pushSettings()
  onWorkspaceGuardChanged: root.pushSettings()
  onDimOthersChanged: root.pushSettings()
  onCoverCardsChanged: root.pushSettings()

  Timer {
    interval: 250
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Row {
    id: row
    spacing: Style.space(4)

    Item {
      width: button.implicitWidth
      height: button.implicitHeight

      WidgetButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: root.chipText
        tooltipText: root.tooltip()
        onPressed: function(buttonCode) {
          if (buttonCode === Qt.RightButton)
            root.openMarks()
          else
            root.callToggle()
        }
      }

      Rectangle {
        visible: root.barState === "onair"
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 2
        width: 7
        height: 7
        radius: 4
        color: Color.accent
      }
    }

    WidgetButton {
      id: bindChip
      bar: root.bar
      text: root.bindChipText
      tooltipText: root.bindTooltip()
      onPressed: function(buttonCode) {
        if (buttonCode === Qt.LeftButton && root.offerBinds)
          root.installBinds()
        else if (buttonCode === Qt.RightButton && root.canRemoveBinds)
          root.removeBinds()
      }
    }
  }

  Component.onCompleted: {
    root.pushSettings()
    root.refresh()
  }
}
