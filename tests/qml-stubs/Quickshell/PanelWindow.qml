import QtQuick
import QtQuick.Window

Window {
  id: win
  width: 1280
  height: 800
  color: "transparent"
  property int exclusionMode: 0
  property var mask
  property var anchors: edge
  property var WlrLayershell: layers

  QtObject {
    id: edge
    property bool top: false
    property bool bottom: false
    property bool left: false
    property bool right: false
  }
  QtObject {
    id: layers
    property string namespace: ""
    property int layer: 0
    property int keyboardFocus: 0
  }
}
