//! cloak-probe — helper for Share Cloak.
//!
//! Commands:
//!   cloak-probe pw-dump [path|-]
//!       Parse a pw-dump JSON document (or run `pw-dump` if no path) and print
//!       {screencasting, windowShare, webcamOnly, streams}.
//!   cloak-probe init-state [dir]
//!       Create the state directory mode 0700 and empty session/marks files 0600.
//!   cloak-probe secure <path>
//!       chmod 0600 a file, 0700 its parent directory.
//!   cloak-probe session-check <path>
//!       Validate session.json schema version 1.
//!   cloak-probe clients-diff <before.json> <after.json>
//!       Normalized hyprctl clients -j diff (empty = lossless round-trip).

mod pwdump;

use pwdump::{json_escape, Detect};
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{self, Command};

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print_usage();
        process::exit(0);
    }
    if args[0] == "--version" {
        println!("cloak-probe 1.0.0");
        process::exit(0);
    }

    let cmd = args.remove(0);
    let result = match cmd.as_str() {
        "pw-dump" => cmd_pwdump(&args),
        "init-state" => cmd_init_state(&args),
        "secure" => cmd_secure(&args),
        "session-check" => cmd_session_check(&args),
        "clients-diff" => cmd_clients_diff(&args),
        other => Err(format!("unknown command: {other}")),
    };

    match result {
        Ok(body) => {
            let mut stdout = io::stdout().lock();
            let _ = writeln!(stdout, "{body}");
        }
        Err(msg) => {
            if msg.starts_with("usage:") {
                eprintln!("cloak-probe: {msg}");
                print_usage();
                process::exit(2);
            }
            let _ = writeln!(
                io::stdout(),
                "{{\"ok\":false,\"error\":{}}}",
                json_escape(&msg)
            );
            process::exit(1);
        }
    }
}

fn print_usage() {
    eprintln!(
        "usage:\n  cloak-probe pw-dump [path|-]\n  cloak-probe init-state [dir]\n  cloak-probe secure <path>\n  cloak-probe session-check <path>\n  cloak-probe clients-diff <before.json> <after.json>"
    );
}

fn cmd_pwdump(args: &[String]) -> Result<String, String> {
    let raw = if let Some(path) = args.first() {
        if path == "-" {
            let mut buf = String::new();
            io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| e.to_string())?;
            buf
        } else {
            fs::read_to_string(path).map_err(|e| e.to_string())?
        }
    } else {
        let out = Command::new("pw-dump")
            .output()
            .map_err(|e| format!("pw-dump: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "pw-dump exited {}",
                out.status.code().unwrap_or(-1)
            ));
        }
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let detect: Detect = pwdump::detect_str(&raw)?;
    Ok(detect.to_json())
}

fn default_state_dir() -> PathBuf {
    if let Ok(xdg) = env::var("XDG_STATE_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("share-cloak");
        }
    }
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".local/state/share-cloak")
}

fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(mode);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    Ok(())
}

fn cmd_init_state(args: &[String]) -> Result<String, String> {
    let dir = if let Some(p) = args.first() {
        PathBuf::from(p)
    } else {
        default_state_dir()
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    set_mode(&dir, 0o700)?;
    let session = dir.join("session.json");
    if !session.exists() {
        fs::write(&session, "{}\n").map_err(|e| e.to_string())?;
    }
    set_mode(&session, 0o600)?;
    let marks = dir.join("marks.json");
    if !marks.exists() {
        fs::write(&marks, "{\n  \"version\": 1,\n  \"marks\": []\n}\n").map_err(|e| e.to_string())?;
    }
    set_mode(&marks, 0o600)?;
    Ok(format!(
        "{{\"ok\":true,\"dir\":{}}}",
        json_escape(&dir.to_string_lossy())
    ))
}

fn cmd_secure(args: &[String]) -> Result<String, String> {
    let path = args
        .first()
        .ok_or_else(|| "usage: secure requires a path".to_string())?;
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if parent.exists() {
            set_mode(parent, 0o700)?;
        }
    }
    if p.exists() {
        set_mode(p, 0o600)?;
    }
    Ok("{\"ok\":true}".into())
}

fn cmd_session_check(args: &[String]) -> Result<String, String> {
    let path = args
        .first()
        .ok_or_else(|| "usage: session-check requires a path".to_string())?;
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() || raw.trim() == "{}" {
        return Ok("{\"ok\":true,\"empty\":true,\"cloaked\":false}".into());
    }
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid-json: {e}"))?;
    let version = value.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
    if version != 1 {
        return Err(format!("unsupported-version:{version}"));
    }
    let phase = value
        .get("phase")
        .and_then(|v| v.as_str())
        .unwrap_or("idle");
    let cloaked = phase == "cloaked" || phase == "uncloaking";
    let mutations = value
        .get("mutations")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    Ok(format!(
        "{{\"ok\":true,\"empty\":false,\"cloaked\":{},\"phase\":{},\"mutations\":{}}}",
        cloaked,
        json_escape(phase),
        mutations
    ))
}

fn workspace_name(c: &Value) -> String {
    c.get("workspace")
        .and_then(|w| w.get("name"))
        .and_then(|v| v.as_str())
        .or_else(|| c.get("workspaceName").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

fn workspace_id(c: &Value) -> i64 {
    c.get("workspace")
        .and_then(|w| w.get("id"))
        .and_then(|v| v.as_i64())
        .or_else(|| c.get("workspaceId").and_then(|v| v.as_i64()))
        .unwrap_or(0)
}

fn at_xy(c: &Value) -> (i64, i64) {
    let at = c.get("at").and_then(|v| v.as_array());
    let x = at.and_then(|a| a.first()).and_then(|v| v.as_i64()).unwrap_or(0);
    let y = at.and_then(|a| a.get(1)).and_then(|v| v.as_i64()).unwrap_or(0);
    (x, y)
}

fn size_wh(c: &Value) -> (i64, i64) {
    let sz = c.get("size").and_then(|v| v.as_array());
    let w = sz.and_then(|a| a.first()).and_then(|v| v.as_i64()).unwrap_or(0);
    let h = sz.and_then(|a| a.get(1)).and_then(|v| v.as_i64()).unwrap_or(0);
    (w, h)
}

fn normalize_addr(c: &Value) -> String {
    let mut s = c
        .get("address")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !s.is_empty() && !s.starts_with("0x") {
        s = format!("0x{s}");
    }
    s
}

fn norm_row(c: &Value) -> Option<String> {
    let addr = normalize_addr(c);
    if addr.is_empty() {
        return None;
    }
    let class = c
        .get("class")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title = c
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let (x, y) = at_xy(c);
    let (w, h) = size_wh(c);
    let floating = c.get("floating").and_then(|v| v.as_bool()).unwrap_or(false);
    let fullscreen = c.get("fullscreen").and_then(|v| v.as_i64()).unwrap_or(0);
    let monitor = c.get("monitor").and_then(|v| v.as_i64()).unwrap_or(0);
    Some(format!(
        "{addr}|{class}|{title}|{}|{}|{x}|{y}|{w}|{h}|{floating}|{fullscreen}|{monitor}",
        workspace_id(c),
        workspace_name(c)
    ))
}

fn load_clients(path: &str) -> Result<Vec<String>, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    if let Some(arr) = value.as_array() {
        for c in arr {
            if let Some(row) = norm_row(c) {
                rows.push(row);
            }
        }
    }
    rows.sort();
    Ok(rows)
}

fn cmd_clients_diff(args: &[String]) -> Result<String, String> {
    if args.len() < 2 {
        return Err("usage: clients-diff <before.json> <after.json>".into());
    }
    let before = load_clients(&args[0])?;
    let after = load_clients(&args[1])?;
    let equal = before == after;
    Ok(format!(
        "{{\"ok\":true,\"equal\":{},\"before\":{},\"after\":{}}}",
        equal,
        before.len(),
        after.len()
    ))
}
