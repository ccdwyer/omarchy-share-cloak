import QtQuick

QtObject {
  id: root
  property string path: ""
  property bool atomicWrites: false
  property bool printErrors: false
  property bool watchChanges: false
  property string _buf: ""
  signal loaded()
  signal loadFailed()
  signal saved()
  signal fileChanged()

  function text() { return root._buf }
  function setText(t) {
    root._buf = String(t)
    root.saved()
  }
  function reload() {}
}
