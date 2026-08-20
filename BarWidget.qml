import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "js/Config.js" as Config
import "js/State.js" as State

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

  function tooltip() {
    var snap = State.snapshot()
    var extra = snap.bindNote ? (" " + snap.bindNote) : ""
    if (root.barState === "onair")
      return "Share Cloak — ON AIR. Left: uncloak. Right: mark windows." + extra
    if (root.barState === "restore")
      return "Share Cloak — interrupted session. Left: restore windows." + extra
    if (root.barState === "armed")
      return "Share Cloak — watching for a share. Left: cloak now. Right: mark windows." + extra
    return "Share Cloak — auto-cloak is off. Left: cloak. Right: mark windows." + extra
  }

  implicitWidth: visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

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

  Component.onCompleted: {
    root.pushSettings()
    root.refresh()
  }
}
