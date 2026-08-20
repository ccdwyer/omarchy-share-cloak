pragma Singleton
import QtQuick

QtObject {
  function env(key) {
    if (key === "HOME")
      return "/tmp/share-cloak-ci-home"
    if (key === "XDG_STATE_HOME")
      return "/tmp/share-cloak-ci-home/.local/state"
    if (key === "XDG_CONFIG_HOME")
      return "/tmp/share-cloak-ci-home/.config"
    if (key === "XDG_RUNTIME_DIR")
      return "/tmp"
    if (key === "OMARCHY_PATH")
      return ""
    if (key === "OMARCHY_REDUCED_MOTION")
      return ""
    if (key === "HYPRLAND_INSTANCE_SIGNATURE")
      return ""
    return ""
  }
  function execDetached(a) {}
}
