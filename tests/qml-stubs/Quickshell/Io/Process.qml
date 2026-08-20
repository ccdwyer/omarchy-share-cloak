import QtQuick

QtObject {
  id: root
  property var command: []
  property bool running: false
  property var stdout
  signal exited(int exitCode)
}
