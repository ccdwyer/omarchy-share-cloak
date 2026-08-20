import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "js/Config.js" as Config
import "js/State.js" as State
import "js/Marks.js" as Marks
import "js/Clients.js" as Clients

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH") || ""
  property string pluginId: "io.github.chris.share-cloak"

  property bool opened: false
  property string mode: "onair"
  property int uiRevision: 0
  property string phase: "idle"
  property string headline: "Share Cloak"
  property bool windowShare: false
  property bool workspaceHidden: false
  property bool pendingRestore: false
  property bool unmanaged: false
  property var covers: []
  property var markRows: []
  property int selectedIndex: 0
  property string toast: ""

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property color accent: Color.accent
  property color surface: Color.menu.background
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily

  readonly property bool reduceMotion: {
    try {
      if (Style && Style.reduceMotion)
        return true
    } catch (e) {}
    try {
      if (Quickshell.env("OMARCHY_REDUCED_MOTION") === "1")
        return true
    } catch (e2) {}
    return false
  }
  readonly property int motionMs: reduceMotion ? 0 : 200
  readonly property bool showOnAir: root.opened && (root.phase === "cloaked" || root.phase === "uncloaking" || root.pendingRestore)
  readonly property bool showPlate: root.showOnAir && !root.windowShare
  readonly property bool showCovers: root.showOnAir && Config.coverCards && !root.windowShare && !root.workspaceHidden
  readonly property bool showMarks: root.opened && root.mode === "marks"
  readonly property bool clickThrough: root.showOnAir && !root.showMarks

  function open(payloadJson) {
    root.opened = true
    root.applyPayload(payloadJson)
    root.refresh()
    if (root.showMarks)
      Qt.callLater(function() { marksKeyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.mode = "onair"
    State.overlayMode = "onair"
  }

  function toggle() {
    if (root.opened && root.mode === "marks")
      root.close()
    else if (root.opened && !root.showOnAir)
      root.close()
    else
      root.open("{}")
  }

  function applyPayload(payloadJson) {
    try {
      var payload = payloadJson && String(payloadJson).length ? JSON.parse(payloadJson) : {}
      if (payload && payload.mode)
        root.mode = String(payload.mode)
    } catch (e) {}
  }

  function serviceRef() {
    if (pluginRegistry && typeof pluginRegistry.serviceFor === "function") {
      var a = pluginRegistry.serviceFor(root.pluginId)
      if (a)
        return a
    }
    if (shell && typeof shell.serviceFor === "function") {
      var b = shell.serviceFor(root.pluginId)
      if (b)
        return b
    }
    if (shell && typeof shell.firstPartyServiceFor === "function") {
      var c = shell.firstPartyServiceFor(root.pluginId)
      if (c)
        return c
    }
    return null
  }

  function callService(method, arg) {
    var svc = root.serviceRef()
    if (svc) {
      if (method === "toggle" && typeof svc.toggleCloak === "function")
        return svc.toggleCloak()
      if (method === "uncloak" && typeof svc.beginUncloak === "function")
        return svc.beginUncloak("manual")
      if (method === "restore" && typeof svc.beginUncloak === "function")
        return svc.beginUncloak("restore")
      if (method === "toggleMark" && typeof svc.toggleMark === "function")
        return svc.toggleMark(arg)
      if (method === "markFocused" && typeof svc.markFocused === "function")
        return svc.markFocused()
    }
    if (shell && typeof shell.call === "function") {
      shell.call(root.pluginId, method, arg === undefined || arg === null ? "" : String(arg))
      return "ok"
    }
    var cmd = ["omarchy-shell", "shell", "call", root.pluginId, method]
    if (arg !== undefined && arg !== null && String(arg).length)
      cmd.push(String(arg))
    ipcProc.command = cmd
    ipcProc.running = true
    return "queued"
  }

  function refresh() {
    var snap = State.snapshot()
    root.uiRevision = snap.revision
    root.phase = snap.phase
    root.headline = State.overlayHeadline()
    root.windowShare = snap.shareKind === "window"
    root.workspaceHidden = snap.workspaceHidden
    root.pendingRestore = snap.pendingRestore
    root.unmanaged = snap.notificationManager === "unmanaged" || (snap.notificationNote && snap.notificationNote.length > 0)
    root.covers = snap.coverCards || []
    root.toast = snap.toast || ""
    var rows = []
    var clients = snap.clients || []
    var classes = Marks.uniqueClasses(clients)
    for (var i = 0; i < classes.length; i++) {
      rows.push({
        className: classes[i]["class"],
        title: classes[i].title,
        marked: Marks.classIsMarked(classes[i]["class"], Config.marks)
      })
    }
    root.markRows = rows
    if (root.selectedIndex >= rows.length)
      root.selectedIndex = Math.max(0, rows.length - 1)
  }

  function toggleSelected() {
    if (!root.markRows.length)
      return
    var row = root.markRows[root.selectedIndex]
    if (!row)
      return
    root.callService("toggleMark", row.className)
    Qt.callLater(root.refresh)
  }

  function moveSel(delta) {
    if (!root.markRows.length)
      return
    var next = root.selectedIndex + delta
    if (next < 0)
      next = 0
    if (next >= root.markRows.length)
      next = root.markRows.length - 1
    root.selectedIndex = next
  }

  Process {
    id: ipcProc
    running: false
  }

  Timer {
    interval: root.opened ? 120 : 500
    running: root.opened
    repeat: true
    onTriggered: root.refresh()
  }

  PanelWindow {
    id: plate
    visible: root.showPlate
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "share-cloak-plate"
    WlrLayershell.layer: WlrLayer.Background
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    Rectangle {
      anchors.fill: parent
      opacity: root.showPlate ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: root.motionMs; easing.type: Easing.OutCubic } }
      gradient: Gradient {
        GradientStop { position: 0.0; color: root.background }
        GradientStop { position: 1.0; color: Qt.darker(root.background, 1.18) }
      }
    }
  }

  PanelWindow {
    id: frame
    visible: root.showOnAir
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "share-cloak-onair"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    Rectangle {
      anchors.fill: parent
      color: "transparent"
      border.color: root.accent
      border.width: 3
      opacity: root.showOnAir ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: root.motionMs; easing.type: Easing.OutCubic } }
    }

    Rectangle {
      visible: root.workspaceHidden && root.showOnAir
      anchors.fill: parent
      color: root.background
      opacity: root.workspaceHidden ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: root.reduceMotion ? 0 : 80 } }

      Text {
        anchors.centerIn: parent
        text: "workspace hidden while presenting\nSuper+F9 to uncloak"
        color: root.foreground
        horizontalAlignment: Text.AlignHCenter
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
      }
    }

    Repeater {
      model: root.showCovers ? root.covers : []
      delegate: Rectangle {
        required property var modelData
        x: Number(modelData.x) || 0
        y: Number(modelData.y) || 0
        width: Math.max(8, Number(modelData.w) || 0)
        height: Math.max(8, Number(modelData.h) || 0)
        color: root.surface
        radius: Math.max(4, root.cornerRadius / 2)
        border.color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.35)
        border.width: 1
        clip: true

        Canvas {
          anchors.fill: parent
          onPaint: {
            var ctx = getContext("2d")
            var w = width
            var h = height
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = "rgba(255,255,255,0.03)"
            var count = Math.min(600, Math.floor(w * h / 80))
            for (var i = 0; i < count; i++) {
              ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1)
            }
          }
          Component.onCompleted: requestPaint()
        }

        Text {
          anchors.centerIn: parent
          width: parent.width - 16
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.Wrap
          text: modelData.className || ""
          color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.5)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    Rectangle {
      id: chip
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.top: parent.top
      anchors.topMargin: Style.gapsOut
      height: Style.space(32)
      width: chipText.implicitWidth + Style.space(24)
      radius: height / 2
      color: root.background
      border.color: root.accent
      border.width: 1
      opacity: root.showOnAir ? 1 : 0
      Behavior on opacity { NumberAnimation { duration: root.motionMs } }

      Text {
        id: chipText
        anchors.centerIn: parent
        text: root.headline
        color: root.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }
    }

    Rectangle {
      visible: root.toast && root.toast.length && root.showOnAir
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.gapsOut + Style.space(16)
      height: Style.space(28)
      width: toastText.implicitWidth + Style.space(20)
      radius: height / 2
      color: root.background
      border.color: root.border
      border.width: 1

      Text {
        id: toastText
        anchors.centerIn: parent
        text: root.toast
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  PanelWindow {
    id: marksPanel
    visible: root.showMarks
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "share-cloak-marks"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
      opacity: root.showMarks ? 1 : 0
      MouseArea {
        anchors.fill: parent
        onClicked: root.close()
      }
    }

    BorderSurface {
      width: Math.min(Style.space(520), marksPanel.width - Style.gapsOut * 2)
      height: Math.min(Style.space(480), marksPanel.height - Style.gapsOut * 2)
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: marksKeyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.close()
            event.accepted = true
          } else if (event.key === Qt.Key_Down || event.key === Qt.Key_J) {
            root.moveSel(1)
            event.accepted = true
          } else if (event.key === Qt.Key_Up || event.key === Qt.Key_K) {
            root.moveSel(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.toggleSelected()
            event.accepted = true
          }
        }
      }

      Column {
        anchors.fill: parent
        anchors.margins: Style.spacing.panelPadding
        spacing: Style.spacing.md

        Text {
          text: "Mark windows to vanish"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }

        Text {
          width: parent.width
          wrapMode: Text.Wrap
          text: "Checked classes move to special:cloak the next time you cloak (and stay marked). Super+F10 marks the focused window."
          color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.7)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        ListView {
          id: markList
          width: parent.width
          height: parent.height - Style.space(96)
          clip: true
          model: root.markRows
          currentIndex: root.selectedIndex
          delegate: Rectangle {
            required property var modelData
            required property int index
            width: markList.width
            height: Style.space(40)
            radius: Math.max(4, root.cornerRadius / 2)
            color: index === root.selectedIndex ? Color.menu.selectedBackground : "transparent"

            MouseArea {
              anchors.fill: parent
              onClicked: {
                root.selectedIndex = index
                root.toggleSelected()
              }
            }

            Row {
              anchors.fill: parent
              anchors.leftMargin: Style.space(8)
              anchors.rightMargin: Style.space(8)
              spacing: Style.space(10)

              Rectangle {
                width: Style.space(14)
                height: Style.space(14)
                anchors.verticalCenter: parent.verticalCenter
                radius: 3
                color: modelData.marked ? root.accent : "transparent"
                border.color: root.accent
                border.width: 1
              }

              Column {
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width - Style.space(32)
                Text {
                  text: modelData.className
                  color: index === root.selectedIndex ? Color.menu.selectedText : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                  width: parent.width
                }
                Text {
                  text: modelData.title
                  color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.55)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                  width: parent.width
                }
              }
            }
          }
        }
      }
    }
  }

  Component.onCompleted: root.refresh()
}
