import QtQuick

QtObject {
  property bool waitForEnd: true
  property string text: ""
  signal streamFinished()
}
