pragma Singleton
import QtQuick

QtObject {
  function surfaceSpec(a, b, color, width) {
    return { color: color, width: width || 1 }
  }
}
