import QtQuick
import Quickshell

ShellRoot {
  Loader {
    source: Qt.resolvedUrl("../../Service.qml")
    onLoaded: Qt.callLater(function() { Qt.quit() })
    onStatusChanged: {
      if (status === Loader.Error)
        Qt.quit()
    }
  }
  Timer {
    interval: 3000
    running: true
    onTriggered: Qt.quit()
  }
}
