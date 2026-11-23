//! Updates from GitHub Releases (installed version only – a copy started from elsewhere can't
//! update itself). Looks every 6 hours, downloads the installer in the background and runs it
//! only when the user presses "Restart now" – never by itself while they play.

use crate::riot::web_client;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

const LATEST: &str = "https://api.github.com/repos/Zlizz3R/rift-switch/releases/latest";

struct Up {
    status: &'static str,
    version: Option<String>,
    error: Option<String>,
    file: Option<PathBuf>,
}
static STATE: Mutex<Up> = Mutex::new(Up {
    status: "off",
    version: None,
    error: None,
    file: None,
});

pub fn get() -> Value {
    let s = STATE.lock().unwrap();
    json!({ "status": s.status, "version": s.version, "error": s.error })
}
fn set(status: &'static str, version: Option<String>, error: Option<String>) {
    let mut s = STATE.lock().unwrap();
    s.status = status;
    if version.is_some() {
        s.version = version;
    }
    s.error = error;
}

/// The NSIS installer puts an uninstaller next to the app: only then can it update itself.
pub fn installed() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

/// "1.10.2" > "1.9.0"
pub fn newer(a: &str, b: &str) -> bool {
    let p = |s: &str| {
        s.trim_start_matches('v')
            .split('.')
            .map(|x| x.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    p(a) > p(b)
}

pub fn init(on_change: impl Fn() + Send + Sync + 'static, enabled: fn() -> bool) {
    if !installed() || std::env::var_os("RS_DATA").is_some() {
        return;
    }
    set("idle", None, None);
    let on_change = std::sync::Arc::new(on_change);
    tauri::async_runtime::spawn(async move {
        loop {
            if enabled() {
                check(on_change.clone()).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

pub async fn check(on_change: std::sync::Arc<dyn Fn() + Send + Sync>) {
    {
        let s = STATE.lock().unwrap();
        let ready_ok = s.status == "ready" && s.file.as_ref().is_some_and(|f| f.exists());
        if s.status == "off" || matches!(s.status, "checking" | "downloading") || ready_ok {
            return;
        }
    }
    set("checking", None, None);
    on_change();
    let r = run().await;
    match r {
        Ok(Some(_)) => {}
        Ok(None) => set("current", None, None),
        Err(e) => set("error", None, Some(e.chars().take(120).collect())),
    }
    on_change();
}

async fn fetch(url: &str, secs: u64) -> Result<reqwest::Response, String> {
    web_client()
        .get(url)
        .header(
            "Accept",
            "application/vnd.github+json, application/octet-stream",
        )
        .timeout(Duration::from_secs(secs))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())
}

async fn run() -> Result<Option<()>, String> {
    let rel = fetch(LATEST, 15)
        .await?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let rel: Value = serde_json::from_str(&rel).map_err(|e| e.to_string())?;
    let tag = rel["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if tag.is_empty() || !newer(&tag, env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let asset = rel["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| {
            a["name"]
                .as_str()
                .is_some_and(|n| n.to_lowercase().ends_with("-setup.exe"))
        })
        .ok_or("no installer in the release")?;
    let name = asset["name"].as_str().unwrap_or("");
    let url = asset["browser_download_url"]
        .as_str()
        .ok_or("no download link")?;
    let ours = |u: &str| u.starts_with("https://github.com/Zlizz3R/rift-switch/releases/download/");
    if !ours(url) {
        return Err("unexpected download link".into());
    }
    // the release workflow publishes "<installer>.sha256": no checksum, no update
    let sum_url = rel["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str() == Some(&format!("{name}.sha256")))
        .and_then(|a| a["browser_download_url"].as_str())
        .filter(|u| ours(u))
        .ok_or("no checksum in the release")?;
    let want = fetch(sum_url, 30)
        .await?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let want = want.split_whitespace().next().unwrap_or("").to_lowercase();
    if want.len() != 64 {
        return Err("bad checksum file".into());
    }
    set("downloading", Some(tag.clone()), None);
    let bytes = fetch(url, 600)
        .await?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(size) = asset["size"].as_u64() {
        if bytes.len() as u64 != size {
            return Err("download incomplete".into());
        }
    }
    if sha256_hex(&bytes) != want {
        return Err("checksum does not match".into());
    }
    let dir = DIR
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().join("rift-switch-update"));
    let _ = std::fs::create_dir_all(&dir);
    // older downloads go
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let _ = std::fs::remove_file(e.path());
    }
    let file = dir.join(format!("Rift-Switch-{tag}-setup.exe"));
    crate::store::write_atomic(&file, &bytes).map_err(|e| e.to_string())?;
    let mut s = STATE.lock().unwrap();
    s.status = "ready";
    s.file = Some(file);
    Ok(Some(()))
}

pub fn sha256_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// Downloads go into the app's data folder (not %TEMP%, which cleanup tools empty).
pub fn set_dir(p: PathBuf) {
    let _ = DIR.set(p);
}

/// Runs the downloaded installer: /P = only a progress bar, /R = start the app again afterwards
/// (both checked in Tauri's NSIS template). The file is checked once more before it runs.
pub fn install_now() -> bool {
    let mut s = STATE.lock().unwrap();
    let ok = match (&s.file, s.status) {
        (Some(f), "ready") => {
            f.exists()
                && std::process::Command::new(f)
                    .args(["/P", "/R"])
                    .spawn()
                    .is_ok()
        }
        _ => false,
    };
    if !ok && s.status == "ready" {
        s.status = "error";
        s.error = Some("installer missing".into());
        s.file = None;
    }
    ok
}

#[cfg(test)]
mod tests {
    #[test]
    fn checksum() {
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
    #[test]
    fn versions() {
        assert!(super::newer("1.10.0", "1.9.9"));
        assert!(super::newer("v2.0.0", "1.1.0"));
        assert!(!super::newer("1.1.0", "1.1.0"));
    }
}
