import QtQuick

Rectangle {
  property var borderSpec: ({ color: "#3b3f51", width: 1 })
  border.color: (borderSpec && borderSpec.color) ? borderSpec.color : "#3b3f51"
  border.width: (borderSpec && borderSpec.width) ? borderSpec.width : 1
}
