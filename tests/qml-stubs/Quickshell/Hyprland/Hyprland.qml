pragma Singleton
import QtQuick

QtObject {
  property string eventSocketPath: ""
  signal rawEvent(var event)
  function dispatch(request) {}
}
