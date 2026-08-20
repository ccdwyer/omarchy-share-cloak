//! Detect screencast nodes in a `pw-dump` JSON array.
//! A webcam in use must never count as a share.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamHit {
    pub id: i64,
    pub name: String,
    pub class: String,
    pub window_share: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detect {
    pub screencasting: bool,
    pub window_share: bool,
    pub webcam_only: bool,
    pub webcam_count: usize,
    pub streams: Vec<StreamHit>,
}

impl Detect {
    pub fn to_json(&self) -> String {
        let mut streams = String::from("[");
        for (i, s) in self.streams.iter().enumerate() {
            if i > 0 {
                streams.push(',');
            }
            streams.push_str(&format!(
                "{{\"id\":{},\"name\":{},\"class\":{},\"windowShare\":{}}}",
                s.id,
                json_escape(&s.name),
                json_escape(&s.class),
                if s.window_share { "true" } else { "false" }
            ));
        }
        streams.push(']');
        format!(
            "{{\"screencasting\":{},\"windowShare\":{},\"webcamOnly\":{},\"webcamCount\":{},\"streamCount\":{},\"streams\":{},\"source\":\"pw-dump\"}}",
            self.screencasting,
            self.window_share,
            self.webcam_only,
            self.webcam_count,
            self.streams.len(),
            streams
        )
    }
}

pub fn json_escape(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn props_of(node: &Value) -> &Value {
    node.pointer("/info/props")
        .or_else(|| node.pointer("/info/properties"))
        .or_else(|| node.get("props"))
        .unwrap_or(&Value::Null)
}

fn prop_str(props: &Value, key: &str) -> String {
    props
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn lower(s: &str) -> String {
    s.to_ascii_lowercase()
}

fn is_node(node: &Value) -> bool {
    if !node.is_object() {
        return false;
    }
    let t = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if t.is_empty() {
        return node.get("info").is_some();
    }
    t.contains("Node")
}

fn is_video_class(klass: &str) -> bool {
    klass.contains("Video")
}

fn is_screencast_name(name: &str) -> bool {
    let n = lower(name);
    n.contains("xdg-desktop-portal")
        || n.contains("screencast")
        || n.contains("hyprland-share")
        || n.contains("wf-recorder")
        || n.contains("wl-screenrec")
        || n.contains("xdg-desktop-portal-wlr")
        || n.contains("xdg-desktop-portal-hyprland")
        || (n.contains("obs") && n.contains("record"))
}

fn is_portal_screencast(props: &Value) -> bool {
    let t = lower(&prop_str(props, "pipewire.access.portal.type"));
    if t == "screencast" {
        return true;
    }
    let role = lower(&prop_str(props, "media.role"));
    role == "screen" || role == "screencast"
}

fn is_webcam(props: &Value) -> bool {
    if is_portal_screencast(props) {
        return false;
    }
    let api = lower(&prop_str(props, "device.api"));
    if api == "v4l2" || api == "libcamera" || api == "v4l2-utils" {
        return true;
    }
    let role = lower(&prop_str(props, "media.role"));
    if role == "camera" || role == "webcam" {
        return true;
    }
    let t = lower(&prop_str(props, "pipewire.access.portal.type"));
    if t == "camera" || t == "webcam" {
        return true;
    }
    let name = format!(
        "{} {}",
        prop_str(props, "node.name"),
        prop_str(props, "node.description")
    );
    let nl = lower(&name);
    if (nl.contains("v4l2") || nl.contains("webcam") || nl.contains("libcamera") || nl.contains("camera"))
        && !nl.contains("portal")
        && !nl.contains("screencast")
    {
        return true;
    }
    false
}

fn is_window_share(props: &Value) -> bool {
    if props.get("window.x11.id").is_some() || props.get("window.x11.xid").is_some() {
        return true;
    }
    let src = lower(&prop_str(props, "pipewire.access.portal.source"));
    if src.contains("window") {
        return true;
    }
    let target = lower(&prop_str(props, "target.object"));
    target.contains("window")
}

fn is_screencast_node(node: &Value) -> bool {
    if !is_node(node) {
        return false;
    }
    let props = props_of(node);
    if is_webcam(props) {
        return false;
    }
    if is_portal_screencast(props) {
        return true;
    }
    let klass = prop_str(props, "media.class");
    let name = format!(
        "{} {}",
        prop_str(props, "node.name"),
        prop_str(props, "node.description")
    );
    if is_screencast_name(&name) && is_video_class(&klass) {
        return true;
    }
    false
}

pub fn detect(value: &Value) -> Detect {
    let mut streams = Vec::new();
    let mut screencasting = false;
    let mut window_share = false;
    let mut webcam_count = 0usize;
    let nodes = match value.as_array() {
        Some(arr) => arr,
        None => {
            return Detect {
                screencasting: false,
                window_share: false,
                webcam_only: false,
                webcam_count: 0,
                streams,
            }
        }
    };
    for node in nodes {
        if !is_node(node) {
            continue;
        }
        let props = props_of(node);
        if is_webcam(props) {
            webcam_count += 1;
            continue;
        }
        if !is_screencast_node(node) {
            continue;
        }
        screencasting = true;
        let win = is_window_share(props);
        if win {
            window_share = true;
        }
        streams.push(StreamHit {
            id: node.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            name: prop_str(props, "node.name"),
            class: prop_str(props, "media.class"),
            window_share: win,
        });
    }
    Detect {
        screencasting,
        window_share,
        webcam_only: webcam_count > 0 && !screencasting,
        webcam_count,
        streams,
    }
}

pub fn detect_str(raw: &str) -> Result<Detect, String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    Ok(detect(&value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures")
            .join(name);
        fs::read_to_string(&p).unwrap_or_else(|_| panic!("missing fixture {}", p.display()))
    }

    #[test]
    fn webcam_alone_does_not_trigger() {
        let d = detect_str(&fixture("pw-dump-webcam.json")).unwrap();
        assert!(!d.screencasting);
        assert!(d.webcam_only);
        assert_eq!(d.webcam_count, 1);
    }

    #[test]
    fn portal_screencast_triggers() {
        let d = detect_str(&fixture("pw-dump-screencast.json")).unwrap();
        assert!(d.screencasting);
        assert!(!d.window_share);
        assert!(!d.webcam_only);
    }

    #[test]
    fn idle_audio_does_not_trigger() {
        let d = detect_str(&fixture("pw-dump-idle.json")).unwrap();
        assert!(!d.screencasting);
        assert_eq!(d.webcam_count, 0);
    }

    #[test]
    fn webcam_plus_screencast_triggers() {
        let d = detect_str(&fixture("pw-dump-webcam-and-screencast.json")).unwrap();
        assert!(d.screencasting);
        assert!(!d.webcam_only);
        assert_eq!(d.webcam_count, 1);
    }

    #[test]
    fn window_share_flag() {
        let d = detect_str(&fixture("pw-dump-window-share.json")).unwrap();
        assert!(d.screencasting);
        assert!(d.window_share);
    }
}
