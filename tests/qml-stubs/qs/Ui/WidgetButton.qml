import QtQuick

Rectangle {
  property var bar: null
  property string text: ""
  property string tooltipText: ""
  signal pressed(int buttonCode)
  implicitWidth: 80
  implicitHeight: 24
}
