.pragma library

// PipeWire pw-dump parser. Screencast = Stream/Output/Video (or Video/Source)
// WITH screencast/portal metadata. A webcam in use must never match.

function parseDump(raw) {
    if (!raw)
        return []
    if (typeof raw !== "string")
        return raw && raw.length ? raw : []
    try {
        var parsed = JSON.parse(raw)
        return parsed && parsed.length ? parsed : []
    } catch (e) {
        return []
    }
}

function propsOf(node) {
    if (!node)
        return {}
    var info = node.info || {}
    var props = info.props || info.properties || node.props || {}
    return props || {}
}

function lower(value) {
    return String(value || "").toLowerCase()
}

function isNode(node) {
    if (!node || typeof node !== "object")
        return false
    var t = String(node.type || "")
    if (!t)
        return !!(node.info && (node.info.props || node.info.properties))
    return t.indexOf("Node") >= 0
}

function isVideoClass(klass) {
    var k = String(klass || "")
    return k.indexOf("Video") >= 0
}

function isPortalScreencast(props) {
    var t = lower(props["pipewire.access.portal.type"])
    if (t === "screencast")
        return true
    var role = lower(props["media.role"])
    if (role === "screen" || role === "screencast")
        return true
    var cat = lower(props["media.category"])
    if (cat === "capture" && (role === "screen" || role === "video")) {
        if (t === "camera" || t === "webcam")
            return false
    }
    return false
}

function isWebcam(props) {
    if (isPortalScreencast(props))
        return false
    var api = lower(props["device.api"])
    if (api === "v4l2" || api === "libcamera" || api === "v4l2-utils")
        return true
    var role = lower(props["media.role"])
    if (role === "camera" || role === "webcam")
        return true
    var t = lower(props["pipewire.access.portal.type"])
    if (t === "camera" || t === "webcam")
        return true
    var name = String(props["node.name"] || "") + " " + String(props["node.description"] || "")
    if (/v4l2|webcam|libcamera|\bcamera\b/i.test(name) && !/portal|screencast/i.test(name))
        return true
    var klass = String(props["media.class"] || "")
    if (klass === "Stream/Input/Video" && !isPortalScreencast(props) && !isScreencastName(name))
        return /v4l2|webcam|camera|libcamera/i.test(name)
    return false
}

function isScreencastName(name) {
    return /xdg-desktop-portal|screencast|hyprland-share|wf-recorder|wl-screenrec|obs.*record|xdg-desktop-portal-wlr|xdg-desktop-portal-hyprland/i.test(String(name || ""))
}

function isScreencastNode(node) {
    if (!isNode(node))
        return false
    var props = propsOf(node)
    if (isWebcam(props))
        return false
    if (isPortalScreencast(props))
        return true
    var klass = String(props["media.class"] || "")
    var name = String(props["node.name"] || "") + " " + String(props["node.description"] || "")
    if (!isVideoClass(klass) && !isScreencastName(name))
        return false
    if (isScreencastName(name) && isVideoClass(klass))
        return true
    if (klass === "Stream/Output/Video" && isScreencastName(name))
        return true
    if (klass === "Video/Source" && isScreencastName(name))
        return true
    if (props["stream.monitor"] === true && isVideoClass(klass) && isScreencastName(name))
        return true
    return false
}

function isWindowShareProps(props) {
    if (!props)
        return false
    if (props["window.x11.id"] || props["window.x11.xid"])
        return true
    var src = lower(props["pipewire.access.portal.source"] || props["screencast.source"] || "")
    if (src.indexOf("window") >= 0)
        return true
    var target = lower(props["target.object"] || "")
    if (target.indexOf("window") >= 0)
        return true
    return false
}

function detect(raw) {
    var nodes = parseDump(raw)
    var streams = []
    var screencasting = false
    var windowShare = false
    var webcamOnly = false
    var webcamCount = 0
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (!isNode(node))
            continue
        var props = propsOf(node)
        var klass = String(props["media.class"] || "")
        if (isWebcam(props)) {
            webcamCount += 1
            continue
        }
        if (!isScreencastNode(node))
            continue
        screencasting = true
        var win = isWindowShareProps(props)
        if (win)
            windowShare = true
        streams.push({
            id: node.id,
            name: String(props["node.name"] || ""),
            description: String(props["node.description"] || ""),
            class: klass,
            windowShare: win
        })
    }
    webcamOnly = webcamCount > 0 && !screencasting
    return {
        screencasting: screencasting,
        windowShare: windowShare,
        webcamOnly: webcamOnly,
        webcamCount: webcamCount,
        streamCount: streams.length,
        streams: streams,
        source: screencasting ? "pw-dump" : "none"
    }
}
