import QtQuick
import QtQuick.Layouts
import Quickshell
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
  readonly property string moduleName: "io.github.chris.share-cloak"
  property string pluginId: root.moduleName

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
  readonly property bool showOnAir: root.opened && (root.phase === "cloaked" || root.phase === "uncloaking" || root.phase === "cloaking" || root.pendingRestore)
  readonly property bool showPlate: root.showOnAir && !root.windowShare
  readonly property bool showCovers: root.showOnAir && Config.coverCards && !root.windowShare && !root.workspaceHidden
  readonly property bool showMarks: root.opened && root.mode === "marks"
  readonly property bool showToast: root.opened && root.toast && root.toast.length && (root.mode === "toast" || !root.showOnAir)
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
      var a = pluginRegistry.serviceFor(root.moduleName)
      if (a)
        return a
    }
    return null
  }

  // `omarchy-shell shell call <id> <method> <arg>` invokes methods on this
  // overlay (the panel loader), not the service. Overlay.toggle stays overlay
  // UI. Cloak toggle/markFocused go through the service IpcHandler:
  // `omarchy-shell io.github.chris.share-cloak <method> ''`.
  function callService(method, arg) {
    var a = arg === undefined || arg === null ? "" : String(arg)
    var svc = root.serviceRef()
    if (svc) {
      if (method === "toggle" && typeof svc.toggleCloak === "function")
        return svc.toggleCloak()
      if (method === "uncloak" && typeof svc.beginUncloak === "function")
        return svc.beginUncloak("manual")
      if (method === "restore" && typeof svc.beginUncloak === "function")
        return svc.beginUncloak("restore")
      if (method === "toggleMark" && typeof svc.toggleMark === "function")
        return svc.toggleMark(a)
      if (method === "markFocused" && typeof svc.markFocused === "function")
        return svc.markFocused()
      if (method === "installBinds" && typeof svc.installBinds === "function")
        return svc.installBinds(a)
      if (method === "removeBinds" && typeof svc.removeBinds === "function")
        return svc.removeBinds(a)
    }
    Quickshell.execDetached(["omarchy-shell", root.moduleName, method, a])
    return "queued"
  }

  function markFocused(arg) { return root.callService("markFocused", arg) }
  function toggleMark(arg) { return root.callService("toggleMark", arg) }
  function installBinds(arg) { return root.callService("installBinds", arg) }
  function removeBinds(arg) { return root.callService("removeBinds", arg) }

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
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i]
      if (!c || !c.address)
        continue
      rows.push({
        className: c["class"] || c.className || "",
        title: c.title || "",
        address: c.address,
        floating: !!c.floating,
        marked: Marks.isMarked(c, Config.marks)
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
    root.callService("toggleMark", JSON.stringify({
      "class": row.className,
      className: row.className,
      title: row.title,
      address: row.address
    }))
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
      width: onAirToastText.implicitWidth + Style.space(20)
      radius: height / 2
      color: root.background
      border.color: root.border
      border.width: 1

      Text {
        id: onAirToastText
        anchors.centerIn: parent
        text: root.toast
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  PanelWindow {
    id: toastPanel
    visible: root.showToast
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "share-cloak-toast"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.gapsOut + Style.space(16)
      width: Math.min(Style.space(560), toastPanel.width - Style.gapsOut * 2)
      height: toastText.implicitHeight + Style.space(20)
      radius: Math.max(8, root.cornerRadius / 2)
      color: root.background
      border.color: root.accent
      border.width: 1

      Text {
        id: toastText
        anchors.centerIn: parent
        width: parent.width - Style.space(24)
        wrapMode: Text.Wrap
        horizontalAlignment: Text.AlignHCenter
        text: root.toast
        color: root.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
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

      Column {
        id: marksColumn
        anchors.fill: parent
        anchors.margins: Style.spacing.panelPadding
        spacing: Style.spacing.md

        Item {
          id: marksKeyCatcher
          width: 0
          height: 0
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

        Text {
          text: "Mark windows to hide"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }

        Text {
          width: parent.width
          wrapMode: Text.Wrap
          text: "Click a row to toggle. Tiled windows stay in the layout (blacked out of the share). Super+F10 marks the focused app class."
          color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.7)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Text {
          visible: !root.markRows.length
          width: parent.width
          wrapMode: Text.Wrap
          text: "No windows to list yet."
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Flickable {
          id: markList
          width: parent.width
          height: parent.height - Style.space(96)
          clip: true
          contentWidth: width
          contentHeight: markColumn.implicitHeight
          flickableDirection: Flickable.VerticalFlick

          Column {
            id: markColumn
            width: markList.width
            spacing: Style.space(4)

            Repeater {
              model: root.markRows
              delegate: Rectangle {
                required property var modelData
                required property int index
                width: markColumn.width
                height: Style.space(44)
                radius: Math.max(4, root.cornerRadius / 2)
                color: index === root.selectedIndex ? Color.menu.selectedBackground : "transparent"

                MouseArea {
                  anchors.fill: parent
                  z: 8
                  preventStealing: true
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
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
                    width: Style.space(16)
                    height: Style.space(16)
                    anchors.verticalCenter: parent.verticalCenter
                    radius: 3
                    color: modelData.marked ? root.accent : "transparent"
                    border.color: root.accent
                    border.width: 1
                  }

                  Column {
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width - Style.space(36)
                    Text {
                      text: modelData.className + (modelData.floating ? "" : "  tiled")
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
    }
  }

  Component.onCompleted: root.refresh()
}
