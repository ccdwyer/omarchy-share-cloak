pragma Singleton
import QtQuick

QtObject {
  property color accent: "#7aa2f7"
  property var menu: ({
    background: "#1a1b26",
    text: "#c0caf5",
    border: "#3b3f51",
    scrim: "#aa000000",
    dim: "#565f89",
    muted: "#565f89",
    selectedBackground: "#33467c",
    selectedText: "#c0caf5"
  })
}
