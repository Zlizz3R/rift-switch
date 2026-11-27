//! Rift Switch – background part. Keeps the tiles fresh while League runs, switches accounts,
//! and serves the window. In the tray there is no window (no WebView) at all: only this small
//! native process, which asks League a few questions every 15–60 seconds.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod accounts;
mod events;
mod lanes;
mod live;
mod matches;
mod menu;
mod ops;
mod riot;
mod secrets;
mod settings;
mod store;
mod updater;
mod winsys;

use accounts::{
    is_id, is_placeholder, mask_login, num_of, parse_riot_id, str_of, truthy, upsert_into,
    valid_cred, Obj, RANK_QUEUES,
};
use riot::now_ms;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use store::State;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

// ---------- shared state ----------

#[derive(Clone, Default, PartialEq)]
struct Live {
    puuid: Option<String>,
    phase: Option<String>,
    client_up: bool,
    /// waiting times the client gave for queueing right now: [{ code, until }]
    waits: Vec<Value>,
    /// the account the Riot Client is signed in to – normally the same as League's
    rc: Option<String>,
}

struct Core {
    st: State,
    mh: matches::Matches,
    live: Live,
    pending_add: bool,
    pending_cred: Option<(String, String)>, // login typed in the "add" form, kept until League says whose it is
    login: Value,                           // auto-login progress shown in the overlay
    sw: Value, // steps of the login in progress { id, n, steps, step, detail }
    login_token: u64,
    busy: bool,
    expecting: Option<String>, // account we just switched to
    locked: bool,
    crypto_broken: bool,
    save_error: Option<String>,
    /// hashes of the last written accounts.json and the last state sent (no full copies kept)
    last_saved: u64,
    last_pushed: u64,
    last_rank_sweep: i64,
    /// when the other own accounts' match lists were read last (every 30 minutes: the client sends
    /// all 200 games each time, and they can't have played here meanwhile)
    history_at: HashMap<String, i64>,
    last_profile_at: i64,
    gen: u64, // bumped by switch/add: results of a tick that started before are thrown away
    ticking: bool,
    play_token: u64,
    play_line: &'static str,
    fetching_ranks: bool,
    unlock_fails: u32,
    import_file: Option<PathBuf>,
    accepting: bool,
    quitting: bool,
    tray_key: String,
    jump_key: String,
    after_load_switch: Option<String>,
    failed_games: HashMap<String, u8>,
    expecting_since: i64,
    /// accounts.json couldn't be read at start: never write it (that would empty the real file)
    read_only: bool,
    /// signed in without "Stay signed in": nothing to save until the next login
    no_persist: Option<String>,
    /// logins sealed with the app password: their key, only while unlocked
    login_key: Option<secrets::Key>,
    /// "Load" running: { step, n, done, total, since } – every Load button shows the same progress
    loading: Value,
}

impl Core {
    fn new(st: State, mh: matches::Matches, read_only: bool) -> Core {
        let st_locked = st.lock.is_some();
        Core {
            st,
            mh,
            live: Live::default(),
            pending_add: false,
            pending_cred: None,
            login: Value::Null,
            sw: Value::Null,
            login_token: 0,
            busy: false,
            expecting: None,
            locked: st_locked,
            crypto_broken: false,
            save_error: None,
            last_saved: 0,
            last_pushed: 0,
            last_rank_sweep: 0,
            history_at: HashMap::new(),
            last_profile_at: 0,
            gen: 0,
            ticking: false,
            play_token: 0,
            play_line: "live",
            fetching_ranks: false,
            unlock_fails: 0,
            import_file: None,
            accepting: false,
            quitting: false,
            tray_key: String::new(),
            jump_key: String::new(),
            after_load_switch: None,
            failed_games: HashMap::new(),
            loading: Value::Null,
            expecting_since: 0,
            read_only,
            no_persist: None,
            login_key: None,
        }
    }
}

static CORE: OnceLock<Mutex<Core>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static DATA: OnceLock<PathBuf> = OnceLock::new();
static TRAY: Mutex<Option<TrayIcon>> = Mutex::new(None);
static KICK: tokio::sync::Notify = tokio::sync::Notify::const_new();
static SOON: Mutex<bool> = Mutex::new(false);
static EVENTS: OnceLock<tokio::sync::mpsc::UnboundedSender<events::Event>> = OnceLock::new();
static UNLOCKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const APP_ID: &str = "com.zlizz3r.riftswitch";

fn core() -> MutexGuard<'static, Core> {
    CORE.get()
        .expect("core")
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
fn with<R>(f: impl FnOnce(&mut Core) -> R) -> R {
    f(&mut core())
}
fn app() -> &'static AppHandle {
    APP.get().expect("app")
}
fn data() -> &'static Path {
    DATA.get().expect("data")
}
fn test_mode() -> bool {
    std::env::var_os("RS_DATA").is_some()
}
fn shot_mode() -> bool {
    std::env::var_os("RS_SHOT").is_some()
}
fn tr(key: &str, vars: &[(&str, &str)]) -> String {
    let lang = with(|c| c.st.lang());
    menu::tr(&lang, key, vars)
}
async fn sleep(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await
}
fn obj(v: Value) -> Obj {
    v.as_object().cloned().unwrap_or_default()
}

fn log_error(place: &str, e: &str) {
    use std::io::Write;
    let file = data().join("error.log");
    trim_log(&file, 1_000_000);
    let line = format!("{} {place}: {e}\n", now_ms());
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
    {
        let _ = f.write_all(line.as_bytes());
    }
}
/// Live's loading, round by round (scout.log, at most 400 KB): when a game's players came, how long
/// their match lists, game details and timelines took, what the client refused, when all was done.
/// No names – game ids and counts only. Read it after a game to tune the pace.
fn scout_log(line: &str) {
    use std::io::Write;
    let file = data().join("scout.log");
    trim_log(&file, 400_000);
    let start = scout(|s| s.started_at);
    let rel = if start > 0 {
        format!(" +{:.1}s", (now_ms() - start) as f64 / 1000.0)
    } else {
        String::new()
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
    {
        let _ = writeln!(f, "{}{rel} {line}", now_ms());
    }
}
/// A log over `max` bytes keeps only its newer half (whole lines).
fn trim_log(file: &Path, max: u64) {
    if std::fs::metadata(file).map_or(0, |m| m.len()) <= max {
        return;
    }
    let Ok(b) = std::fs::read(file) else { return };
    let from = b.len() - (max / 2) as usize;
    let start = b[from..]
        .iter()
        .position(|c| *c == b'\n')
        .map_or(from, |i| from + i + 1);
    let _ = store::write_atomic(file, &b[start..]);
}

// ---------- window + state push ----------

fn window() -> Option<WebviewWindow> {
    app().get_webview_window("main")
}
fn win_shown() -> bool {
    window().is_some_and(|w| w.is_visible().unwrap_or(false))
}
fn emit(ev: &str, payload: Value) {
    if let Some(w) = window() {
        let _ = w.emit(ev, payload);
    }
}

fn snapshot(c: &Core) -> Value {
    let version = env!("CARGO_PKG_VERSION");
    if c.locked {
        let s = &c.st.settings;
        return json!({ "locked": true, "hasLock": true, "accounts": [], "categories": [], "active": null,
            "settings": { "lang": s.get("lang"), "theme": s.get("theme"), "uiScale": s.get("uiScale"), "tile": null },
            "live": { "clientUp": false }, "version": version, "update": updater::get() });
    }
    // LP history can be long: the profile window asks for it when it opens
    let accounts: Vec<Value> =
        c.st.accounts
            .iter()
            .map(|a| {
                let mut a = a.clone();
                let n = a
                    .remove("history")
                    .and_then(|h| h.as_array().map(Vec::len))
                    .unwrap_or(0);
                // the collection page asks for owned champions / skins / shards itself
                if let Some(at) = a.remove("coll").and_then(|c| c.get("at").cloned()) {
                    a.insert("collAt".into(), at);
                }
                // the same for every champion's mastery (the mastery page asks for it)
                if let Some(at) = a.remove("mast").and_then(|m| m.get("at").cloned()) {
                    a.insert("mastAt".into(), at);
                }
                a.insert("historyLen".into(), json!(n));
                Value::Object(a)
            })
            .collect();
    let mut o = c.st.to_json();
    let m = o.as_object_mut().unwrap();
    m.remove("lock");
    m.insert("accounts".into(), Value::Array(accounts));
    m.insert("hasLock".into(), json!(c.st.lock.is_some()));
    m.insert("sealLogins".into(), json!(sealed_on(c)));
    m.insert("live".into(), json!({ "puuid": c.live.puuid, "phase": c.live.phase, "clientUp": c.live.client_up, "waits": c.live.waits, "rc": c.live.rc }));
    m.insert("pendingAdd".into(), json!(c.pending_add));
    m.insert("busy".into(), json!(c.busy));
    m.insert("login".into(), c.login.clone());
    m.insert("switching".into(), c.sw.clone());
    m.insert("loading".into(), c.loading.clone());
    m.insert("saveError".into(), json!(c.save_error));
    m.insert("cryptoBroken".into(), json!(c.crypto_broken));
    m.insert("version".into(), json!(version));
    m.insert("update".into(), updater::get());
    o
}

/// A 64-bit fingerprint of a text: "did it change?" without keeping the text
fn text_hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
/// Sends the state to the window – only when it's open and something changed.
fn push() {
    if !win_shown() && !shot_mode() {
        return;
    }
    let s = with(|c| {
        let s = snapshot(c);
        let key = text_hash(&s.to_string());
        if key == c.last_pushed {
            return None;
        }
        c.last_pushed = key;
        Some(s)
    });
    if let Some(s) = s {
        emit("state", s);
    }
}
fn set_login(l: Value) {
    with(|c| {
        // a failed typed login ends the steps screen (the failure box takes over)
        if l["stage"] == "failed" {
            c.sw = Value::Null;
        }
        c.login = l
    });
    push();
}

// ---------- the steps screen of a login ----------
// close (save the sign-in, close League) -> client (Riot Client starts) -> signin -> play -> launch
fn sw_start(id: &str, steps: &[&str]) {
    with(|c| {
        let n = c.sw["n"].as_u64().unwrap_or(0) + 1;
        c.sw = json!({ "id": id, "n": n, "steps": steps, "step": steps[0], "detail": "" });
    });
    push();
}
/// Moves on to `step` (never back); detail = a finer word for the step ("typing", "verify").
fn sw_step(step: &str, detail: &str) {
    let changed = with(|c| {
        let Some(steps) = c.sw["steps"].as_array() else {
            return false;
        };
        let pos = |s: &str| steps.iter().position(|x| x == s);
        let (Some(new), Some(cur)) = (pos(step), c.sw["step"].as_str().and_then(pos)) else {
            return false;
        };
        if new < cur || (new == cur && c.sw["detail"] == detail) {
            return false;
        }
        c.sw["step"] = json!(step);
        c.sw["detail"] = json!(detail);
        true
    });
    if changed {
        push();
    }
}
/// League is up: show everything ticked for a moment, then close the screen.
fn sw_done() {
    let n = with(|c| {
        if c.sw.is_null() {
            return None;
        }
        c.sw["step"] = json!("done");
        c.sw["n"].as_u64()
    });
    let Some(n) = n else { return };
    push();
    tauri::async_runtime::spawn(async move {
        sleep(1800).await;
        if with(|c| {
            let same = c.sw["n"].as_u64() == Some(n) && c.sw["step"] == "done";
            if same {
                c.sw = Value::Null;
            }
            same
        }) {
            push();
        }
    });
}
fn sw_clear() {
    if with(|c| std::mem::replace(&mut c.sw, Value::Null) != Value::Null) {
        push();
    }
}

/// Writes accounts.json only when something really changed, and refreshes the tray then.
fn save() {
    let changed = with(|c| {
        if c.read_only {
            c.save_error = Some("accounts.json unreadable".into());
            return false;
        }
        let text = c.st.to_json().to_string();
        let key = text_hash(&text);
        if key == c.last_saved {
            c.save_error = None;
            return false;
        }
        match store::write_atomic(&data().join("accounts.json"), text.as_bytes()) {
            Ok(()) => {
                c.last_saved = key;
                c.save_error = None;
                true
            }
            Err(e) => {
                let msg = e.kind().to_string();
                if c.save_error.as_deref() != Some(msg.as_str()) {
                    log_error("save", &e.to_string());
                }
                c.save_error = Some(msg);
                false
            }
        }
    });
    if changed {
        update_tray();
    }
    push();
}

// ---------- encrypted files ----------

/// sessions/<id>.bin – an id that isn't one can't point anywhere else (no "..", no folders)
/// autofill.ps1 saves a picture of the Riot Client window when it can't find the login form
/// (for an issue report). They may show a Riot ID: gone after 3 days.
fn clean_debug_pictures() {
    let dir = std::env::temp_dir().join("rift-switch-debug");
    // the login script's log is appended at every login, so it never gets 3 days old: kept small
    trim_log(&dir.join("autofill.log"), 256_000);
    let Ok(list) = std::fs::read_dir(&dir) else {
        return;
    };
    for e in list.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age.as_secs() > 3 * 86_400);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}
fn session_file(id: &str) -> PathBuf {
    data().join("sessions").join(format!("{}.bin", safe_id(id)))
}
fn cred_file(id: &str) -> PathBuf {
    data().join("creds").join(format!("{}.bin", safe_id(id)))
}
/// An account's mastery history: one JSON line per reading that changed something.
fn mastery_file(id: &str) -> PathBuf {
    data()
        .join("mastery")
        .join(format!("{}.jsonl", safe_id(id)))
}
fn append_mastery(id: &str, line: &Value) {
    use std::io::Write;
    let f = mastery_file(id);
    if let Some(dir) = f.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let r = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&f)
        .and_then(|mut file| writeln!(file, "{line}"));
    if let Err(e) = r {
        log_error("mastery", &format!("history not written: {e}"));
    }
}
/// The mastery history of one account (oldest first); broken lines are skipped.
fn read_mastery(id: &str) -> Vec<Value> {
    std::fs::read_to_string(mastery_file(id))
        .map(|t| {
            t.lines()
                .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                .filter(Value::is_object)
                .collect()
        })
        .unwrap_or_default()
}
fn safe_id(id: &str) -> &str {
    if is_id(id) {
        id
    } else {
        "invalid"
    }
}
fn write_secret(file: &Path, text: &str) -> bool {
    let Some(b) = secrets::encrypt_local(text.as_bytes()) else {
        return false;
    };
    store::write_atomic(file, &b).is_ok()
}
/// Files of the old Electron version ("v10", key in its "Local State" file) are re-encrypted
/// with DPAPI once, so deleting that leftover file can never lose a login.
fn migrate_secrets() {
    let mut files = vec![data().join("keycheck.bin")];
    for dir in ["creds", "sessions"] {
        files.extend(
            std::fs::read_dir(data().join(dir))
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path()),
        );
    }
    for f in files {
        let Ok(b) = std::fs::read(&f) else { continue };
        if !secrets::is_legacy(&b) {
            continue;
        }
        match secrets::decrypt_local(data(), &b).and_then(|p| secrets::encrypt_local(&p)) {
            Some(n) => {
                if let Err(e) = store::write_atomic(&f, &n) {
                    log_error("migrate", &format!("{}: {e}", f.display()));
                }
            }
            None => log_error("migrate", &format!("cannot re-encrypt {}", f.display())),
        }
    }
}
fn read_secret(file: &Path) -> Option<String> {
    let b = std::fs::read(file).ok()?;
    String::from_utf8(secrets::decrypt_local(data(), &b)?).ok()
}

/// Canary: if it can't be decrypted on a later start, all saved logins/sessions are unreadable.
/// The canary: a file encrypted at the first start. Unreadable means Windows' key changed (another
/// user, a reset profile) – unless a saved sign-in or login is still readable, then only the canary
/// was damaged and is written again. A real break stays reported at every start until a sign-in
/// or login is saved again with the current key.
fn check_crypto() {
    let f = data().join("keycheck.bin");
    if !f.exists() {
        write_secret(&f, "rift-switch");
        with(|c| c.crypto_broken = false);
        return;
    }
    let mut broken = read_secret(&f).as_deref() != Some("rift-switch");
    if broken {
        let saved: Vec<PathBuf> = ["sessions", "creds"]
            .iter()
            .flat_map(|d| {
                std::fs::read_dir(data().join(d))
                    .into_iter()
                    .flatten()
                    .flatten()
            })
            .map(|e| e.path())
            .collect();
        if saved.is_empty() || saved.iter().any(|p| read_secret(p).is_some()) {
            broken = false;
            write_secret(&f, "rift-switch");
        } else {
            log_error(
                "crypto",
                "saved data was encrypted with a key this start cannot read",
            );
        }
    }
    with(|c| c.crypto_broken = broken);
}

/// Saves the Riot Client's session for this account – only a usable one: it must hold a
/// remembered login and (unless verified) the client must be signed in as this very account.
async fn store_session(id: &str, verified: bool) -> bool {
    let Some(json) = riot::capture_session() else {
        return false;
    };
    if !riot::session_persisted(&json) {
        with(|c| c.no_persist = Some(id.to_string()));
        return false;
    }
    if !verified {
        let st = riot::rc_login_state().await;
        if !st.up || st.subject.as_deref() != Some(id) {
            return false;
        }
    }
    write_secret(&session_file(id), &json)
}
fn sealed_on(c: &Core) -> bool {
    c.st.lock.as_ref().is_some_and(|l| l["sealLogins"] == true)
}
/// A login file's bytes: Windows DPAPI, and inside it (if turned on) sealed with the app password.
fn cred_bytes(text: &str) -> Option<Vec<u8>> {
    let (on, key) = with(|c| (sealed_on(c), c.login_key));
    let inner = match (on, key) {
        (false, _) => text.as_bytes().to_vec(),
        (true, Some(k)) => secrets::seal_bytes(&k, text.as_bytes()),
        (true, None) => return None, // can't happen while unlocked
    };
    secrets::encrypt_local(&inner)
}
fn write_cred_file(id: &str, text: &str) -> bool {
    cred_bytes(text).is_some_and(|b| store::write_atomic(&cred_file(id), &b).is_ok())
}
enum Cred {
    Missing,
    /// sealed with the app password and the app is locked
    Locked,
    Broken,
    Ok(String, String),
}
fn cred_state(id: &str) -> Cred {
    let Ok(b) = std::fs::read(cred_file(id)) else {
        return Cred::Missing;
    };
    let Some(inner) = secrets::decrypt_local(data(), &b) else {
        return Cred::Broken;
    };
    let plain = if secrets::is_sealed(&inner) {
        match with(|c| c.login_key) {
            Some(k) => match secrets::open_bytes(&k, &inner) {
                Some(p) => p,
                None => return Cred::Broken,
            },
            None => return Cred::Locked,
        }
    } else {
        inner
    };
    let Ok(v) = serde_json::from_slice::<Value>(&plain) else {
        return Cred::Broken;
    };
    match (v["u"].as_str(), v["p"].as_str()) {
        (Some(u), Some(p)) => Cred::Ok(u.into(), p.into()),
        _ => Cred::Broken,
    }
}
/// Every login file again, with the current setting and key (turning the seal on/off, new password).
/// All or nothing: first every file is encrypted and written next to the old one (".new"); only when
/// all of them made it are they swapped in. A failure leaves every old file as it was.
fn rewrite_creds(logins: &[(String, String, String)]) -> bool {
    let fresh = |id: &str| cred_file(id).with_extension("bin.new");
    let mut written: Vec<&str> = vec![];
    let mut ok = true;
    for (id, u, p) in logins {
        let done = cred_bytes(&json!({ "u": u, "p": p }).to_string())
            .is_some_and(|b| store::write_atomic(&fresh(id), &b).is_ok());
        if !done {
            ok = false;
            break;
        }
        written.push(id.as_str());
    }
    if !ok {
        for id in written {
            let _ = std::fs::remove_file(fresh(id));
        }
        log_error(
            "cred",
            "re-encrypting the logins failed – nothing was changed",
        );
        return false;
    }
    for id in written {
        if std::fs::rename(fresh(id), cred_file(id)).is_err() {
            log_error("cred", "a re-encrypted login could not replace the old one");
            ok = false;
        }
    }
    ok
}
fn all_creds() -> Vec<(String, String, String)> {
    let ids: Vec<String> = with(|c| {
        c.st.accounts
            .iter()
            .map(|a| str_of(a, "puuid").to_string())
            .collect()
    });
    ids.into_iter()
        .filter_map(|id| match cred_state(&id) {
            Cred::Ok(u, p) => Some((id, u, p)),
            _ => None,
        })
        .collect()
}

/// false: the file couldn't be written (encryption or disk) – the account keeps its old state
#[must_use]
fn store_cred(id: &str, u: &str, p: &str) -> bool {
    if !is_id(id) || !write_cred_file(id, &json!({ "u": u, "p": p }).to_string()) {
        log_error("cred", "a login could not be saved");
        return false;
    }
    with(|c| {
        if let Some(a) = c.st.account_mut(id) {
            a.insert("hasCred".into(), json!(true));
            a.insert("credBroken".into(), json!(false));
        }
    });
    true
}
fn load_cred(id: &str) -> Option<(String, String)> {
    match cred_state(id) {
        Cred::Ok(u, p) => Some((u, p)),
        _ => None,
    }
}
fn check_creds() {
    let ids: Vec<String> = with(|c| {
        c.st.accounts
            .iter()
            .map(|a| str_of(a, "puuid").to_string())
            .collect()
    });
    for id in ids {
        let state = cred_state(&id);
        let has = !matches!(state, Cred::Missing);
        let broken = matches!(state, Cred::Broken);
        if broken {
            log_error("cred", &format!("cannot decrypt login for {id}"));
        }
        with(|c| {
            if let Some(a) = c.st.account_mut(&id) {
                a.insert("hasCred".into(), json!(has));
                a.insert("credBroken".into(), json!(broken));
            }
        });
    }
}
/// Tiles whose list entry got lost are rebuilt from the encrypted files that still exist.
fn recover_orphans() {
    let mut ids = std::collections::BTreeSet::new();
    for dir in ["creds", "sessions"] {
        for e in std::fs::read_dir(data().join(dir))
            .into_iter()
            .flatten()
            .flatten()
        {
            if let Some(id) = e.file_name().to_string_lossy().strip_suffix(".bin") {
                if is_id(id) {
                    ids.insert(id.to_string());
                }
            }
        }
    }
    let mut changed = false;
    for id in ids {
        if with(|c| c.st.has(&id)) {
            continue;
        }
        let mut acc = obj(
            json!({ "puuid": id, "note": "", "addedAt": now_ms(), "gameName": "…", "tagLine": "", "needsInfo": true }),
        );
        if is_placeholder(&id) {
            let name =
                load_cred(&id).map_or("Gespeicherter Login".to_string(), |c| mask_login(&c.0)); // the window translates this marker
            acc.insert("placeholder".into(), json!(true));
            acc.insert("gameName".into(), json!(name));
            acc.remove("needsInfo");
        }
        with(|c| c.st.accounts.push(acc));
        changed = true;
    }
    if changed {
        save();
    }
}

fn move_file(from: &Path, to: &Path) {
    if from.exists() {
        let _ = std::fs::create_dir_all(to.parent().unwrap());
        let _ = std::fs::rename(from, to);
    }
}
/// Placeholder old_id turned out to be new_id.
fn resolve_placeholder(c: &mut Core, old_id: &str, new_id: &str) {
    let Some(oi) =
        c.st.accounts
            .iter()
            .position(|a| str_of(a, "puuid") == old_id)
    else {
        return;
    };
    if let Some(ri) =
        c.st.accounts
            .iter()
            .position(|a| str_of(a, "puuid") == new_id)
    {
        // already saved: keep the real tile, take over the login if it had none
        let old = c.st.accounts[oi].clone();
        let real = &mut c.st.accounts[ri];
        if !truthy(real.get("hasCred")) && truthy(old.get("hasCred")) {
            move_file(&cred_file(old_id), &cred_file(new_id));
            real.insert("hasCred".into(), json!(true));
        } else {
            let _ = std::fs::remove_file(cred_file(old_id));
        }
        if !truthy(real.get("note")) && truthy(old.get("note")) {
            real.insert("note".into(), old["note"].clone());
        }
        c.st.accounts.remove(oi);
    } else {
        move_file(&cred_file(old_id), &cred_file(new_id));
        move_file(&session_file(old_id), &session_file(new_id));
        let a = &mut c.st.accounts[oi];
        a.insert("puuid".into(), json!(new_id));
        a.remove("placeholder");
    }
    if c.st.active.as_deref() == Some(old_id) {
        c.st.active = Some(new_id.into());
    }
    if c.expecting.as_deref() == Some(old_id) {
        c.expecting = Some(new_id.into());
    }
}
fn upsert(acc: Obj) {
    let renamed = with(|c| {
        let r =
            c.st.account(str_of(&acc, "puuid"))
                .and_then(|p| accounts::rename_of(p, &acc));
        upsert_into(&mut c.st.accounts, acc, now_ms());
        r
    });
    // a Riot ID changed outside the app: the tile follows it, the window says so once
    if let Some((old, new)) = renamed {
        emit(
            "toast",
            json!({ "key": "acc.renamed", "vars": { "old": old, "new": new } }),
        );
    }
}

// ---------- watcher: keeps tiles fresh while League is open ----------

fn stale_in(c: &Core, my_gen: u64) -> bool {
    c.busy || c.gen != my_gen
}

async fn tick() {
    // no window: the heavy caches go (game data); back as soon as it opens
    riot::set_tray(!win_shown());
    let my_gen = {
        let mut c = core();
        if c.busy || c.ticking {
            return;
        }
        c.ticking = true;
        c.gen
    };
    tick_inner(my_gen).await;
    with(|c| c.ticking = false);
}

fn merge_history(id: &str, hs: &riot::HistorySummary, own: bool) {
    with(|c| {
        if let Some(a) = c.st.account_mut(id) {
            if let Some(lp) = hs.last_played {
                a.insert("lastPlayed".into(), json!(lp));
            }
            accounts::merge_ranked_games(a, &hs.ranked);
            // normal games only matter while the account has no rank yet (own account: always)
            if own || !RANK_QUEUES.iter().any(|k| truthy(a.get(*k))) {
                let n = accounts::best_normals(a.get("normals"), &hs.normals);
                a.insert("normals".into(), n);
            }
        }
        c.mh.note(id, &hs.list);
    });
}

const IN_GAME: [&str; 3] = ["GameStart", "InProgress", "Reconnect"];
/// From a game (or its end screens) to the end screen or out of it: the game is over.
fn after_game(was: Option<&str>, now: &str) -> bool {
    const PLAYED: [&str; 6] = [
        "GameStart",
        "InProgress",
        "Reconnect",
        "WaitingForStats",
        "PreEndOfGame",
        "EndOfGame",
    ];
    was.is_some_and(|w| PLAYED.contains(&w))
        && matches!(now, "EndOfGame" | "Lobby" | "None" | "Matchmaking")
}
/// A game is on (loading screen or running) – the phase comes from the client's events the moment
/// it changes (else from the last tick): long request loops stop as soon as a game starts.
fn game_on() -> bool {
    with(|c| {
        c.live
            .phase
            .as_deref()
            .is_some_and(|p| IN_GAME.contains(&p))
    })
}
/// League must not be closed now (champion select or a game)
const RISKY_PHASES: [&str; 5] = [
    "ChampSelect",
    "GameStart",
    "InProgress",
    "Reconnect",
    "ReadyCheck",
];

async fn tick_inner(my_gen: u64) {
    let stale = || with(|c| c.busy || c.gen != my_gen);
    if let Some(tx) = EVENTS.get() {
        events::connect(riot::lockfile(), tx.clone());
    }
    // While a game runs, the League client is asked one single thing (the phase) – nothing that
    // could cost a frame. Ranks, history and the other accounts follow when the game is over.
    let first = riot::gameflow_phase().await;
    if let Some(p) = first.as_deref().filter(|p| IN_GAME.contains(p)) {
        // also right after the app started (account not known yet): it is learnt after the game
        let changed = with(|c| {
            if stale_in(c, my_gen) {
                return None;
            }
            let ch = c.live.phase.as_deref() != Some(p);
            c.live.phase = Some(p.to_string());
            c.live.client_up = true;
            Some(ch)
        });
        if changed == Some(true) {
            push();
        }
        return;
    }
    let cur = if first.is_some() {
        riot::current_account().await
    } else {
        None
    };
    let (phase, rc) = if cur.is_some() {
        tokio::join!(riot::gameflow_phase(), async {
            riot::rc_login_state().await.subject
        })
    } else {
        (None, None)
    };
    if stale() {
        return;
    }
    let cur_id = cur.as_ref().map(|c| str_of(c, "puuid").to_string());
    if phase.as_deref() == Some("ReadyCheck")
        && with(|c| c.live.phase.as_deref() != Some("ReadyCheck"))
    {
        match_found();
    }
    let (new_puuid, changed) = with(|c| {
        let np = cur_id != c.live.puuid;
        let ch = np || phase != c.live.phase || rc != c.live.rc;
        let waits = if cur_id == c.live.puuid {
            std::mem::take(&mut c.live.waits)
        } else {
            vec![]
        };
        c.live = Live {
            puuid: cur_id.clone(),
            phase: phase.clone(),
            client_up: cur.is_some(),
            waits,
            rc: rc.clone(),
        };
        (np, ch)
    });
    let Some(cur) = cur else {
        if changed {
            push();
        }
        return;
    };
    let id = cur_id.unwrap();
    undo_offline().await;
    let now = now_ms();
    // first login of an account that was only saved so far; and: is it the one that was picked?
    let wrong = with(|c| {
        let e = c.expecting.take()?;
        let want = c.st.account(&e).cloned()?;
        let got = format!("{}#{}", str_of(&cur, "gameName"), str_of(&cur, "tagLine"));
        let want_name = format!("{}#{}", str_of(&want, "gameName"), str_of(&want, "tagLine"));
        let differs = if is_placeholder(&e) {
            // a saved login with a Riot ID: the login belongs to another account
            truthy(want.get("tagLine")) && !want_name.eq_ignore_ascii_case(&got)
        } else {
            e != id
        };
        if is_placeholder(&e) {
            resolve_placeholder(c, &e, &id);
        }
        differs.then_some((got, want_name))
    });
    if let Some((got, want)) = wrong {
        // no names in the log (it goes into diagnostics files)
        log_error("login", "signed in as another account than picked");
        emit(
            "toast",
            json!({ "key": "login.wrong", "vars": { "got": got, "want": want }, "err": true }),
        );
    }
    let (known, pending_add) = with(|c| (c.st.has(&id), c.pending_add));
    if known || pending_add {
        upsert(cur.clone());
        with(|c| c.st.active = Some(id.clone()));
        if new_puuid {
            with(|c| c.no_persist = None);
            auto_load_ask(&id);
        }
        let skip = with(|c| c.no_persist.as_deref() == Some(id.as_str()));
        if pending_add || new_puuid || (!skip && !session_file(&id).exists()) {
            store_session(&id, false).await;
        }
        if let Some((u, p)) = with(|c| {
            if c.pending_add {
                c.pending_cred.clone()
            } else {
                None
            }
        }) {
            if !store_cred(&id, &u, &p) {
                emit("toast", json!("m.credSaveFailed"));
            }
        }
        // profile details of the signed-in account, every 5 minutes – every 30 seconds while the
        // collection is incomplete (right after a login the client often hasn't loaded it yet)
        let incomplete = with(|c| {
            c.st.account(&id).is_some_and(|a| {
                let coll = a.get("coll");
                coll.and_then(|x| x.get("champs")).is_none()
                    || coll.and_then(|x| x.get("skins")).is_none()
            })
        });
        let every = if incomplete { 30_000 } else { 300_000 };
        if new_puuid || with(|c| now - c.last_profile_at > every) {
            with(|c| c.last_profile_at = now);
            let (p, hs, elig, notices, rview) = tokio::join!(
                riot::profile_data(&cur),
                riot::history_summary(&id),
                riot::ranked_eligibility(),
                riot::leaver_notices(),
                riot::restriction_view()
            );
            if stale() {
                return;
            }
            let mast_line = with(|c| {
                let mut line = None;
                if let Some(a) = c.st.account_mut(&id) {
                    let mut prof = a
                        .get("profile")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    let mut p = p;
                    // part by part: what the client couldn't tell yet keeps its last good answer
                    if let Some(Value::Object(new)) = p.remove("_coll") {
                        let c = a.entry("coll").or_insert_with(|| json!({}));
                        if !c.is_object() {
                            *c = json!({});
                        }
                        let c = c.as_object_mut().unwrap();
                        let good = new.contains_key("champs") || new.contains_key("skins");
                        for (k, v) in new {
                            // the counts too: a number the client didn't tell keeps the last one
                            if let (Value::Object(add), Some(Value::Object(had))) =
                                (&v, c.get_mut("counts").filter(|_| k == "counts"))
                            {
                                had.extend(add.clone());
                            } else if k != "at" || good {
                                c.insert(k, v);
                            }
                        }
                    }
                    // every champion's mastery; what changed goes to the account's mastery history
                    if let Some(new) = p.remove("_mast") {
                        line = ops::mastery_changes(a.get("mast"), &new);
                        a.insert("mast".into(), new);
                    }
                    prof.extend(p);
                    a.insert("profile".into(), Value::Object(prof));
                    // the low priority queue: the restriction view tells it best (wait per game and
                    // games left, also without queueing); else the LeaverBuster notices
                    match rview {
                        Some((secs, games)) => {
                            ops::set_low_prio(a, Some(secs), Some(games), now);
                        }
                        None => {
                            let games = notices.iter().find_map(|n| n["games"].as_i64());
                            ops::set_low_prio(a, None, Some(games), now);
                        }
                    }
                    if let Some((check, mut pens)) = elig {
                        a.insert("rankedCheck".into(), check);
                        // the low priority queue has its own mark (games / wait per game)
                        pens.extend(notices.into_iter().filter(|n| n["games"].is_null()));
                        ops::set_penalties(a, pens, now);
                    }
                }
                line
            });
            if let Some(line) = mast_line {
                append_mastery(&id, &line);
            }
            load_step("mast", 0, 0);
            if let Some(hs) = hs {
                merge_history(&id, &hs, true);
            }
        }
        with(|c| {
            c.pending_add = false;
            c.pending_cred = None;
            if !c.login.is_null() {
                c.login_token += 1;
                c.login = Value::Null;
            }
        });
        save();
    } else if changed {
        push();
    }

    // lobby / queue: the low priority queue or a dodge timer shows up here
    if matches!(phase.as_deref(), Some("Lobby" | "Matchmaking")) {
        // who is in the own lobby: a party in the game that follows (Live)
        live::watch_party().await;
        let (waits, low) = riot::queue_wait_now().await;
        let changed = with(|c| {
            let lp =
                c.st.account_mut(&id)
                    .is_some_and(|a| ops::set_low_prio(a, low, None, now));
            let ch = c.live.waits != waits || lp;
            if ch {
                c.live.waits = waits.clone();
                if let Some(a) = c.st.account_mut(&id) {
                    let mut list: Vec<Value> = a
                        .get("penalties")
                        .and_then(|p| p["list"].as_array().cloned())
                        .unwrap_or_default();
                    list.retain(|p| !waits.iter().any(|w| w["code"] == p["code"]));
                    list.extend(waits.iter().cloned());
                    ops::set_penalties(a, list, now);
                }
            }
            ch
        });
        if changed {
            save();
        }
    } else if with(|c| !c.live.waits.is_empty()) {
        with(|c| c.live.waits.clear());
        push();
    }

    // the other saved accounts of the same region: every 2 minutes, 5 when hidden
    let every = if win_shown() { 120_000 } else { 300_000 };
    let due = with(|c| {
        now - c.last_rank_sweep > every || c.st.accounts.iter().any(|a| truthy(a.get("needsInfo")))
    });
    if due {
        with(|c| c.last_rank_sweep = now);
        let region = str_of(&cur, "region").to_string();
        let list: Vec<Obj> = with(|c| c.st.accounts.clone());
        let n = list.len();
        for (i, a) in list.into_iter().enumerate() {
            if stale() || game_on() {
                return;
            }
            load_step("ranks", i, n);
            let aid = str_of(&a, "puuid").to_string();
            with(|c| {
                if let Some(x) = c.st.account_mut(&aid) {
                    x.remove("needsInfo");
                }
            });
            if truthy(a.get("placeholder")) {
                if !truthy(a.get("tagLine")) {
                    continue;
                }
                if let Some(hit) =
                    riot::lookup_riot_id(str_of(&a, "gameName"), str_of(&a, "tagLine")).await
                {
                    if !stale() && with(|c| c.st.has(&aid)) {
                        let hid = str_of(&hit, "puuid").to_string();
                        with(|c| resolve_placeholder(c, &aid, &hid));
                        upsert(hit);
                    }
                }
                continue;
            }
            let ar = str_of(&a, "region");
            if aid == id || (!ar.is_empty() && ar != region) {
                continue;
            }
            let r = riot::ranked_for(&aid, false).await;
            let s = riot::summoner_by_puuid(&aid).await;
            if stale() || !with(|c| c.st.has(&aid)) {
                continue;
            }
            if r.is_some() || s.is_some() {
                let mut u = obj(json!({ "puuid": aid }));
                u.extend(r.unwrap_or_default());
                if let Some(s) = s {
                    u.insert("iconId".into(), s["profileIconId"].clone());
                    u.insert("level".into(), s["summonerLevel"].clone());
                    let gn = s["gameName"]
                        .as_str()
                        .filter(|x| !x.is_empty())
                        .unwrap_or(str_of(&a, "gameName"));
                    let tl = s["tagLine"]
                        .as_str()
                        .filter(|x| !x.is_empty())
                        .unwrap_or(str_of(&a, "tagLine"));
                    u.insert("gameName".into(), json!(gn));
                    u.insert("tagLine".into(), json!(tl));
                }
                upsert(u);
            }
            let due = with(|c| now_ms() - c.history_at.get(&aid).copied().unwrap_or(0) > 1_800_000);
            if let Some(hs) = if due {
                riot::history_summary(&aid).await
            } else {
                None
            } {
                with(|c| c.history_at.insert(aid.clone(), now_ms()));
                merge_history(&aid, &hs, false);
            }
        }
        save();
    }
    if !stale() && !game_on() && !with(|c| c.mh.missing().is_empty()) {
        let got = fill_games(if win_shown() { 8 } else { 3 }).await;
        if got > 0 && win_shown() {
            emit("matches-changed", Value::Null);
        }
    }
    // older Summoner's Rift games get their positions – only while the window is open
    if !stale() && !game_on() && win_shown() {
        let ids: Vec<String> = with(|c| {
            let failed = &c.failed_games;
            c.mh.outdated(64)
                .into_iter()
                .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
                .take(4)
                .collect()
        });
        if !ids.is_empty() && fetch_games(ids).await > 0 {
            emit("matches-changed", Value::Null);
        }
    }
}

/// The steps of "Load", in order (the window names them).
const LOAD_STEPS: [&str; 5] = ["coll", "mast", "ranks", "lists", "games"];
/// "Load" reached a step (only while it runs; the tick calls this too).
fn load_step(step: &str, done: usize, total: usize) {
    let moved = with(|c| {
        if !c.loading.is_object() {
            return false;
        }
        let n = LOAD_STEPS.iter().position(|s| *s == step).unwrap_or(0) + 1;
        c.loading["step"] = json!(step);
        c.loading["n"] = json!(n);
        c.loading["done"] = json!(done);
        c.loading["total"] = json!(total);
        true
    });
    if moved {
        push();
    }
}

/// "Load": everything the client has for the signed-in account at once – collection and mastery
/// (the profile), ranks of every account, then the new games. Every Load button shows this one run.
async fn load_all() -> Value {
    let before = with(|c| c.mh.count());
    // the profile and the rank sweep run in the next tick; one that is running now may have read
    // before this: wait for it (up to 20 s), then tick
    with(|c| {
        c.last_profile_at = 0;
        c.last_rank_sweep = 0;
    });
    load_step("coll", 0, 0);
    for _ in 0..200 {
        if !with(|c| c.ticking) {
            break;
        }
        sleep(100).await;
    }
    tick().await;
    // right after a login the client may not have its champion list yet: read again (a few times)
    for _ in 0..4 {
        let has = with(|c| {
            c.live
                .puuid
                .clone()
                .and_then(|p| {
                    c.st.account(&p)
                        .map(|a| a.get("coll").and_then(|x| x.get("champs")).is_some())
                })
                .unwrap_or(true)
        });
        if has {
            break;
        }
        sleep(2500).await;
        with(|c| c.last_profile_at = 0);
        tick().await;
    }
    let in_game = || {
        with(|c| {
            !c.live.client_up
                || c.live
                    .phase
                    .as_deref()
                    .is_some_and(|p| IN_GAME.contains(&p))
        })
    };
    // every account's match list on this server: the 200 newest games the client hands out (paging
    // doesn't work – it answers every later request with the first page, see riot::HISTORY_MAX)
    let (accs, region) = with(|c| {
        let region = c
            .live
            .puuid
            .clone()
            .and_then(|p| c.st.account(&p).map(|a| str_of(a, "region").to_string()))
            .unwrap_or_default();
        (c.st.accounts.clone(), region)
    });
    let accs: Vec<String> = accs
        .iter()
        .filter(|a| {
            let r = str_of(a, "region");
            !truthy(a.get("placeholder")) && (region.is_empty() || r.is_empty() || r == region)
        })
        .map(|a| str_of(a, "puuid").to_string())
        .collect();
    for (i, id) in accs.iter().enumerate() {
        load_step("lists", i, accs.len());
        if in_game() {
            break;
        }
        if let Some(list) = riot::match_list(id, 0, riot::HISTORY_MAX - 1).await {
            with(|c| c.mh.note(id, &list));
        }
    }
    // then the details of every game missing them, and of games stored in an older format
    let todo: Vec<String> = with(|c| {
        let failed = &c.failed_games;
        let mut ids = c.mh.missing();
        ids.extend(c.mh.outdated(usize::MAX));
        ids.dedup();
        ids.into_iter()
            .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
            .collect()
    });
    let total = todo.len();
    load_step("games", 0, total);
    for (i, chunk) in todo.chunks(4).enumerate() {
        if in_game() {
            break;
        }
        fetch_games(chunk.to_vec()).await;
        load_step("games", ((i + 1) * 4).min(total), total);
        if i % 5 == 4 {
            emit("matches-changed", Value::Null);
        }
    }
    if total > 0 {
        emit("matches-changed", Value::Null);
    }
    let r = with(|c| {
        let me = c.live.puuid.clone().unwrap_or_default();
        let a = c.st.account(&me);
        let len = |k: &str, sub: &str| {
            a.and_then(|a| a.get(k))
                .and_then(|x| x.get(sub))
                .map(|x| match x {
                    Value::Array(v) => v.len(),
                    Value::Object(o) => o.len(),
                    _ => 0,
                })
                .unwrap_or(0)
        };
        let r = json!({ "ok": true, "puuid": me, "champs": len("coll", "champs"), "skins": len("coll", "skins"),
            "mastery": len("mast", "champs"), "games": c.mh.count().saturating_sub(before) });
        c.loading = Value::Null;
        r
    });
    push();
    lanes_rebuild();
    r
}

async fn fill_games(max: usize) -> usize {
    let ids: Vec<String> = with(|c| {
        let failed = &c.failed_games;
        c.mh.missing()
            .into_iter()
            .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
            .take(max)
            .collect()
    });
    fetch_games(ids).await
}
/// One game from the client: its details, compacted, with the parts of its timeline we keep –
/// and the client's raw answers (details, timeline) for the own games' archive.
async fn fetch_game(id: String) -> Option<(Value, Value, Option<Value>)> {
    fetch_game_timed(id).await.0
}
type Fetched = Option<(Value, Value, Option<Value>)>;
/// fetch_game, plus how long the details and the timeline took (ms) – for the scout log.
async fn fetch_game_timed(id: String) -> (Fetched, u64, u64) {
    // the game and its timeline at the same time (the timeline is only used when the game came)
    let timed = |path: String| async move {
        let t = std::time::Instant::now();
        let r = riot::lcu(&path, 10_000, "GET").await;
        (r, t.elapsed().as_millis() as u64)
    };
    let ((g, g_ms), (tl, tl_ms)) = tokio::join!(
        timed(format!("/lol-match-history/v1/games/{id}")),
        timed(format!("/lol-match-history/v1/game-timelines/{id}"))
    );
    let Some(g) = g else {
        return (None, g_ms, tl_ms);
    };
    let Some(mut c) = matches::compact(&g) else {
        return (None, g_ms, tl_ms);
    };
    let pids = matches::participant_ids(&g);
    if let Some(tl) = &tl {
        matches::add_timeline(&mut c, tl, &pids);
    }
    (Some((c, g, tl)), g_ms, tl_ms)
}
/// The own games: one after the other, stopping when a game starts (Live's scouting has its own pace).
async fn fetch_games(ids: Vec<String>) -> usize {
    let mut got = 0;
    for id in ids {
        if game_on() {
            break;
        }
        match fetch_game(id.clone()).await {
            Some((c, raw, tl)) => {
                if with(|c2| {
                    let new = c2.mh.insert(&c);
                    if new {
                        c2.mh.append_raw(&id, &raw, tl.as_ref());
                    }
                    new
                }) {
                    got += 1;
                }
            }
            None => with(|c| *c.failed_games.entry(id).or_insert(0) += 1),
        }
    }
    got
}

// ---------- scouting: the other players of the current game (Live) ----------
// Their match lists first (stage A, kept 30 minutes: the 200 newest games, each with that player's
// own numbers – stored as "lite" games), then the details + timeline of their newest 50 ranked
// games (stages B + C) – all into a store of their own (matches-others). As fast as the client
// answers: every match list at once, then always PAR_FAST games on their way (when one comes, the
// next starts – no waiting for the slowest of a round), the players in turn: everyone's newest game
// first, then everyone's second … – so every card has something within seconds. While the game runs
// (game time > 0) PAR_IN_GAME at a time. When the client starts refusing (half a round's worth in a
// row) a short pause, BACK_OFF. Goes on while the window is in the tray as long as a game is on (champion
// select to the end screen); never in a test copy that mustn't talk to Riot. Every round goes into
// scout.log (the times, what was refused, when all was there).
const PAR_FAST: usize = 12;
const PAR_IN_GAME: usize = 10;
const BACK_OFF: i64 = 3000;
/// at most this many games per round (rounds stay short: a new phase or game is noticed)
const ROUND_MAX: usize = 60;
/// The phases Live loads in: champion select, the game, its end.
const SCOUT_PHASES: [&str; 7] = [
    "ChampSelect",
    "GameStart",
    "InProgress",
    "Reconnect",
    "WaitingForStats",
    "PreEndOfGame",
    "EndOfGame",
];
fn scout_phase_on() -> bool {
    with(|c| {
        c.live
            .phase
            .as_deref()
            .is_some_and(|p| SCOUT_PHASES.contains(&p))
    })
}
/// The lane table (lanes.rs): built again in a thread of its own from both stores – one at a time.
static LANES_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn lanes_rebuild() {
    use std::sync::atomic::Ordering;
    if LANES_BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let dir = data().to_path_buf();
    std::thread::spawn(move || {
        let t = lanes::build(&[dir.join("matches"), dir.join("matches-others")], now_ms());
        if let Err(e) = store::write_atomic(&dir.join("lanes.json"), t.to_string().as_bytes()) {
            log_error("lanes", &e.to_string());
        }
        LANES_BUSY.store(false, Ordering::SeqCst);
    });
}
/// Other players' games: loaded when Live needs them, let go when the window goes to the tray.
static OTHERS: Mutex<Option<matches::Matches>> = Mutex::new(None);
fn others<R>(f: impl FnOnce(&mut matches::Matches) -> R) -> R {
    let mut m = OTHERS.lock().unwrap_or_else(|e| e.into_inner());
    f(m.get_or_insert_with(|| {
        let dir = DATA
            .get()
            .cloned()
            .unwrap_or_default()
            .join("matches-others");
        matches::Matches::load_others(dir)
    }))
}
/// The window went to the tray: Live's memory goes (the index of other players' games, what was
/// noted about the players of the last game).
fn live_memory_free() {
    *OTHERS.lock().unwrap_or_else(|e| e.into_inner()) = None;
    scout(|s| *s = Scout::default());
    *LOOK.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
/// The storage limit of other players' games in bytes (Settings → Data; 1 GB unless set lower or
/// higher – there is no "unlimited")
fn others_limit() -> u64 {
    let mb = with(|c| {
        c.st.settings
            .get("othersLimit")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    });
    (if mb == 0 { 1000 } else { mb }) * 1_000_000
}
#[derive(Default)]
struct Scout {
    pruned_at: i64,
    targets: Vec<String>,
    /// per player of this game: when the match list was read, the mastery (cleared with a new game)
    listed: HashMap<String, i64>,
    mastery: HashMap<String, Value>,
    /// game ids that couldn't be read (twice = given up)
    failed: HashMap<String, u8>,
    running: bool,
    // no round before this (the client refused much of the last one)
    pause_until: i64,
    /// when the players of this game came (scout.log counts from here), whether "all there" is logged
    started_at: i64,
    done_logged: bool,
}
static SCOUT: Mutex<Option<Scout>> = Mutex::new(None);
fn scout<R>(f: impl FnOnce(&mut Scout) -> R) -> R {
    f(SCOUT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(Scout::default))
}
/// Live's progress: per player (stored, noted) games, the totals, whether the game runs. Sent with
/// "scout-changed" and the answer of "scout-games" – not with the state, so a round doesn't send
/// (and the window doesn't redraw) everything.
fn scout_snapshot() -> Value {
    let (targets, running, listed) = scout(|s| {
        let l = s
            .targets
            .iter()
            .filter(|p| s.listed.contains_key(*p))
            .count();
        (s.targets.clone(), s.running, l)
    });
    if targets.is_empty() {
        return Value::Null;
    }
    let per: Obj = others(|o| {
        targets
            .iter()
            .map(|p| {
                let (d, n) = o.progress(p);
                (p.clone(), json!([d, n]))
            })
            .collect()
    });
    let (done, total) = per.values().fold((0, 0), |(a, b), v| {
        (
            a + v[0].as_u64().unwrap_or(0),
            b + v[1].as_u64().unwrap_or(0),
        )
    });
    json!({ "players": per, "done": done, "total": total, "running": running, "listed": listed, "of": targets.len() })
}
/// Own games by id, read from disk outside the lock; once more with fresh places when a rewrite
/// (removed account, shrinking) moved the lines in between.
async fn read_own_games(ids: Vec<String>) -> Vec<Value> {
    let mut got = vec![];
    for _ in 0..2 {
        let (file, entries) = with(|c| (c.mh.games_file(), c.mh.entries(&ids)));
        let n = entries.len();
        got = tokio::task::spawn_blocking(move || matches::read_entries(&file, &entries))
            .await
            .unwrap_or_default();
        if got.len() == n {
            break;
        }
    }
    got
}
/// Wakes the scouting loop at once (the player page opened another player).
static LOOK_KICK: tokio::sync::Notify = tokio::sync::Notify::const_new();
async fn scout_loop() {
    loop {
        tokio::select! {
            _ = sleep(1500) => {}
            _ = LOOK_KICK.notified() => {}
        }
        if riot::offline_test() {
            continue;
        }
        // in the tray: only while a game is on (Live's cards are ready when the window opens);
        // afterwards what Live kept in memory goes again
        if !win_shown() && !scout_phase_on() {
            if window().is_none() && OTHERS.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
                live_memory_free();
            }
            continue;
        }
        // other players' games are kept 30 days: the older ones go, once an hour
        let now = now_ms();
        if scout(|s| now - s.pruned_at > 3_600_000) {
            scout(|s| s.pruned_at = now);
            others(|o| o.prune_old(now));
        }
        // a round that did something: the next one right away (until there is nothing left)
        loop {
            if scout_round().await {
                emit("scout-changed", scout_snapshot());
            } else if look_round().await {
                let p = look(|l| l.puuid.clone());
                emit(
                    "player-changed",
                    json!({ "puuid": p, "progress": look_snapshot(&p) }),
                );
            } else {
                break;
            }
            if !win_shown() && !scout_phase_on() {
                break;
            }
            sleep(40).await;
        }
    }
}
fn puuids_of(list: &[&Value]) -> Vec<String> {
    list.iter()
        .flat_map(|t| t.as_array().into_iter().flatten())
        .filter_map(|p| p["puuid"].as_str())
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect()
}
/// One step of the plan; true when something changed.
async fn scout_round() -> bool {
    let phase = with(|c| c.live.phase.clone()).unwrap_or_default();
    let own: std::collections::HashSet<String> = with(|c| {
        c.st.accounts
            .iter()
            .map(|a| str_of(a, "puuid").to_string())
            .collect()
    });
    if now_ms() < scout(|s| s.pause_until) {
        return false;
    }
    let (mut targets, par) = match phase.as_str() {
        "ChampSelect" => {
            scout(|s| s.running = false);
            let Some(cs) = riot::lcu("/lol-champ-select/v1/session", 3000, "GET").await else {
                return false;
            };
            (puuids_of(&[&cs["myTeam"]]), PAR_FAST)
        }
        "GameStart" | "InProgress" | "Reconnect" => {
            let running = scout(|s| s.running);
            if !running && riot::live_game_time().await.is_some_and(|t| t > 0.0) {
                scout(|s| s.running = true);
                scout_log("the game runs (game time > 0)");
                return true;
            }
            let Some(gs) = riot::lcu("/lol-gameflow/v1/session", 3000, "GET").await else {
                return false;
            };
            let gd = &gs["gameData"];
            (
                puuids_of(&[&gd["teamOne"], &gd["teamTwo"]]),
                if running { PAR_IN_GAME } else { PAR_FAST },
            )
        }
        "WaitingForStats" | "PreEndOfGame" | "EndOfGame" => {
            scout(|s| s.running = false);
            (scout(|s| s.targets.clone()), PAR_FAST)
        }
        _ => {
            scout(|s| s.running = false);
            return false;
        }
    };
    targets.retain(|p| !own.contains(p));
    targets.dedup();
    if targets.is_empty() {
        return false;
    }
    let new_targets = scout(|s| {
        let ch = s.targets != targets;
        if ch {
            // another game: what was noted about players no longer in it goes
            s.listed.retain(|p, _| targets.contains(p));
            s.mastery.retain(|p, _| targets.contains(p));
            s.failed.clear();
            s.targets = targets.clone();
            s.started_at = now_ms();
            s.done_logged = false;
        }
        ch
    });
    if new_targets {
        scout_log(&format!(
            "{} players ({phase}), window {}",
            targets.len(),
            if win_shown() { "open" } else { "in the tray" }
        ));
    }
    // stage A: match lists (and mastery) of everyone first
    let now = now_ms();
    let need: Vec<String> = scout(|s| {
        targets
            .iter()
            .filter(|p| s.listed.get(*p).is_none_or(|t| now - t > 1_800_000))
            .cloned()
            .collect()
    });
    if !need.is_empty() {
        let t0 = std::time::Instant::now();
        let got = futures_util::future::join_all(need.iter().map(|p| async move {
            let t = std::time::Instant::now();
            let (l, m) = tokio::join!(riot::match_games(p), riot::mastery_points_of(p));
            (p.clone(), l, m, t.elapsed().as_millis() as u64)
        }))
        .await;
        let slowest = got.iter().map(|g| g.3).max().unwrap_or(0);
        let ok = got.iter().filter(|g| g.1.is_some()).count();
        let n_games: usize = got.iter().map(|g| g.1.as_ref().map_or(0, Vec::len)).sum();
        scout_log(&format!(
            "match lists: {ok}/{} in {} ms (slowest {slowest} ms), {n_games} games listed",
            need.len(),
            t0.elapsed().as_millis()
        ));
        for (p, list, mast, _) in got {
            if let Some(l) = list {
                store_list(&p, &l);
            }
            scout(|s| {
                s.listed.insert(p.clone(), now);
                if let Some(m) = mast {
                    s.mastery.insert(p.clone(), m);
                }
            });
        }
        return true;
    }
    // stages B + C: their games – the players in turn, newest first; always `par` on their way
    let failed = scout(|s| s.failed.clone());
    let all: Vec<String> = others(|o| o.missing_for(&targets))
        .into_iter()
        .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
        .collect();
    if all.is_empty() {
        if !scout(|s| std::mem::replace(&mut s.done_logged, true)) {
            let (done, total) = others(|o| {
                targets.iter().fold((0, 0), |(a, b), p| {
                    let (d, n) = o.progress(p);
                    (a + d, b + n)
                })
            });
            scout_log(&format!("all there: {done} of {total} games with details"));
        }
        return new_targets;
    }
    let left = all.len();
    let ids: Vec<String> = all.into_iter().take(ROUND_MAX).collect();
    let asked = ids.len();
    let t0 = std::time::Instant::now();
    use futures_util::StreamExt;
    let mut jobs = futures_util::stream::iter(ids.into_iter().map(|id| async move {
        let r = fetch_one_into_others_timed(&id).await;
        (id, r)
    }))
    .buffer_unordered(par);
    let (mut ok, mut own, mut refused, mut run) = (0usize, 0usize, 0usize, 0usize);
    let (mut g_ms, mut tl_ms, mut g_max, mut tl_max, mut n_timed) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut last_emit = now_ms();
    while let Some((id, r)) = jobs.next().await {
        match r {
            Some((g, tl)) => {
                ok += 1;
                run = 0;
                if g == 0 && tl == 0 {
                    own += 1;
                } else {
                    n_timed += 1;
                    (g_ms, tl_ms) = (g_ms + g, tl_ms + tl);
                    (g_max, tl_max) = (g_max.max(g), tl_max.max(tl));
                }
            }
            None => {
                refused += 1;
                run += 1;
                scout(|s| *s.failed.entry(id).or_insert(0) += 1);
            }
        }
        // a new phase, the window gone without a game, the client refusing: the next round decides
        let phase_now = with(|c| c.live.phase.clone()).unwrap_or_default();
        if phase_now != phase || (!win_shown() && !scout_phase_on()) || run >= par / 2 {
            break;
        }
        if now_ms() - last_emit > 400 {
            last_emit = now_ms();
            emit("scout-changed", scout_snapshot());
        }
    }
    drop(jobs);
    let limit = others_limit();
    others(|o| o.prune_to(limit));
    let avg = |sum: u64| sum.checked_div(n_timed).unwrap_or(0);
    scout_log(&format!(
        "games: {ok}/{asked} in {} ms (par {par}{}), {own} from own history · details avg {} max {g_max} ms · timelines avg {} max {tl_max} ms · refused {refused} · left {}",
        t0.elapsed().as_millis(),
        if scout(|s| s.running) { ", game runs" } else { "" },
        avg(g_ms),
        avg(tl_ms),
        left.saturating_sub(ok)
    ));
    if run >= par / 2 {
        scout(|s| s.pause_until = now_ms() + BACK_OFF);
        scout_log(&format!(
            "pause {BACK_OFF} ms: the client refused {run} in a row"
        ));
    }
    true
}

/// A player's match list (the 200 newest, each with that player's own numbers) into the others'
/// store: noted for the player, each game as a lite game until its details come.
fn store_list(p: &str, l: &[Value]) {
    let short: Vec<Value> = l
        .iter()
        .map(|g| json!({ "id": g["gameId"], "t": g["gameCreation"], "q": g["queueId"] }))
        .collect();
    others(|o| {
        o.note(p, &short);
        for g in l.iter().filter_map(matches::lite) {
            o.insert_lite(&g);
        }
    });
}
// ---------- the player page: any player, looked at on their own ----------
// Like Live's scouting, for one player: the match list (200 newest, lite) with mastery and ranks
// first, then the details of every one of them (all queues), 4 at a time. Only when Live has nothing to
// do and no game is on; the same store (matches-others) and the same limits.
#[derive(Default)]
struct Look {
    puuid: String,
    listed_at: i64,
    listed: bool,
    info: Option<Value>,
    mastery: Option<Value>,
    failed: HashMap<String, u8>,
}
static LOOK: Mutex<Option<Look>> = Mutex::new(None);
fn look<R>(f: impl FnOnce(&mut Look) -> R) -> R {
    f(LOOK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(Look::default))
}
/// The player page's progress: whether the list is read, (games with details, games that get them).
fn look_snapshot(p: &str) -> Value {
    let listed = look(|l| l.puuid == p && l.listed);
    let (done, total) = others(|o| o.progress_all(p));
    json!({ "listed": listed, "done": done, "total": total })
}
/// One step for the player page; true when something changed.
async fn look_round() -> bool {
    let (p, listed_at) = look(|l| (l.puuid.clone(), l.listed_at));
    // Live goes first (champion select, a game); nothing in the tray
    let champ_select = || with(|c| c.live.phase.as_deref() == Some("ChampSelect"));
    if p.is_empty() || game_on() || champ_select() || !win_shown() || with(|c| c.st.has(&p)) {
        return false;
    }
    let now = now_ms();
    if now - listed_at > 1_800_000 {
        let (l, m, info) = tokio::join!(
            riot::match_games(&p),
            riot::mastery_points_of(&p),
            live::player_info(&p)
        );
        let ok = l.is_some();
        if let Some(l) = &l {
            store_list(&p, l);
        }
        look(|x| {
            if x.puuid == p {
                // not read (League closed …): again in 15 s
                x.listed_at = if ok { now } else { now - 1_800_000 + 15_000 };
                x.listed |= ok;
                if m.is_some() {
                    x.mastery = m;
                }
                if info.is_some() {
                    x.info = info;
                }
            }
        });
        return ok;
    }
    let failed = look(|l| l.failed.clone());
    let ids: Vec<String> = others(|o| o.missing_all(&p))
        .into_iter()
        .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
        .collect();
    if ids.is_empty() {
        return false;
    }
    // always PAR_FAST games on their way: when one comes, the next starts (no waiting for the
    // slowest of a round); progress to the window now and then. Stops for another player, a game,
    // Live's own work, or when the client keeps refusing (the loop tries again after a pause).
    use futures_util::StreamExt;
    let mut jobs = futures_util::stream::iter(ids.into_iter().map(|id| async move {
        let ok = fetch_one_into_others(&id).await;
        (id, ok)
    }))
    .buffer_unordered(PAR_FAST);
    let (mut last_emit, mut refused) = (now_ms(), 0usize);
    while let Some((id, ok)) = jobs.next().await {
        if ok {
            refused = 0;
        } else {
            refused += 1;
            look(|l| *l.failed.entry(id).or_insert(0) += 1);
        }
        let stop = look(|l| l.puuid != p) || game_on() || champ_select() || !win_shown();
        if stop || refused >= PAR_FAST / 2 {
            break;
        }
        if now_ms() - last_emit > 400 {
            last_emit = now_ms();
            emit(
                "player-changed",
                json!({ "puuid": p, "progress": look_snapshot(&p) }),
            );
        }
    }
    let limit = others_limit();
    others(|o| o.prune_to(limit));
    if refused >= PAR_FAST / 2 {
        sleep(BACK_OFF as u64).await;
    }
    true
}
/// One game into the others' store, with the ms its details and its timeline took ((0, 0): it was in
/// the own match history); None when the client didn't give it.
async fn fetch_one_into_others_timed(id: &str) -> Option<(u64, u64)> {
    if with(|c| c.mh.has(id)) {
        return fetch_one_into_others(id).await.then_some((0, 0));
    }
    let (g, g_ms, tl_ms) = fetch_game_timed(id.to_string()).await;
    let (g, _, _) = g?;
    others(|o| o.insert(&g));
    Some((g_ms, tl_ms))
}
/// One game into the others' store: from the own match history if it is there, else from the
/// client (game and timeline). false when the client didn't give it.
async fn fetch_one_into_others(id: &str) -> bool {
    let own = with(|c| c.mh.has(id));
    if own {
        let ids = [id.to_string()];
        let games = with(|c| matches::read_entries(&c.mh.games_file(), &c.mh.entries(&ids)));
        others(|o| {
            for g in &games {
                o.insert(g);
            }
        });
        return !games.is_empty();
    }
    match fetch_game(id.to_string()).await {
        Some((g, _, _)) => {
            others(|o| o.insert(&g));
            true
        }
        None => false,
    }
}

// ---------- auto-login ----------

const AUTOFILL_ERR: [&str; 6] = [
    "noform",
    "nowindow",
    "nofocus",
    "lostfocus",
    "badinput",
    "error",
];

/// Waits for the Riot Client; if it shows the login screen, types the login.
/// settle_ms: how long the client must stay signed out before typing.
/// since: the client was restarted then – only type into a window started after it.
async fn auto_login(u: String, p: String, name: String, settle_ms: i64, since: Option<i64>) {
    let token = with(|c| {
        c.login_token += 1;
        c.login_token
    });
    let alive = || with(|c| c.login_token == token);
    set_login(json!({ "name": name, "stage": "wait" }));
    let t0 = now_ms();
    let (mut signed_out_since, mut typed_at): (Option<i64>, Option<i64>) = (None, None);
    let (mut tries, mut shown) = (0u32, false);
    while alive() && now_ms() - t0 < 120_000 {
        let st = riot::rc_login_state().await;
        if !alive() {
            return;
        }
        if st.subject.is_some() {
            set_login(Value::Null);
            return;
        }
        // the Riot Client hasn't come up after 20 s (started to the tray, slow first start): open it
        if !st.up && !shown && now_ms() - t0 > 20_000 {
            shown = true;
            riot::show_riot_client();
        }
        if st.up {
            sw_step("signin", "");
            let since_out = *signed_out_since.get_or_insert(now_ms());
            if typed_at.is_none() && now_ms() - since_out >= settle_ms {
                set_login(json!({ "name": name, "stage": "typing" }));
                sw_step("signin", "typing");
                let r = riot::autofill(&u, &p, since).await;
                if !alive() {
                    return;
                }
                // window not there / not in front / form not drawn yet (first start, still loading):
                // bring the Riot Client up and try again – up to three times before giving up
                if matches!(r.as_str(), "nowindow" | "nofocus" | "noform") && tries < 3 {
                    tries += 1;
                    riot::show_riot_client();
                    set_login(json!({ "name": name, "stage": "wait" }));
                    sw_step("signin", "");
                    sleep(3000).await;
                    continue;
                }
                if r != "ok" && r != "ok-nopersist" {
                    let k = if AUTOFILL_ERR.contains(&r.as_str()) {
                        r.as_str()
                    } else {
                        "error"
                    };
                    return set_login(
                        json!({ "name": name, "stage": "failed", "msgKey": format!("af.{k}") }),
                    );
                }
                if r == "ok-nopersist" {
                    log_error("autofill", "\"Stay signed in\" could not be ticked");
                    emit("toast", json!("login.noPersist"));
                }
                typed_at = Some(now_ms());
                set_login(json!({ "name": name, "stage": "verify" }));
                sw_step("signin", "verify");
            }
            if let Some(t) = typed_at {
                if with(|c| c.login["stage"] == "verify") && now_ms() - t > 10_000 {
                    set_login(json!({ "name": name, "stage": "check" }));
                }
            }
        }
        sleep(1200).await;
    }
    if alive() {
        set_login(json!({ "name": name, "stage": "failed", "msgKey": "m.timeout" }));
    }
}

// ---------- auto "Play" ----------
// After a switch the Riot Client sometimes stops on its home screen (always after a typed
// login). Once it is signed in and League hasn't started, press Play for the user.

fn pl_of(a: Option<&Obj>) -> &'static str {
    if a.is_some_and(|a| str_of(a, "region") == "PBE") {
        "pbe"
    } else {
        "live"
    }
}
async fn auto_play(pl: &'static str) {
    let token = with(|c| {
        c.play_line = pl;
        c.play_token += 1;
        c.play_token
    });
    let alive = || with(|c| c.play_token == token);
    let t0 = now_ms();
    let (mut signed_in_since, mut presses, mut checked): (Option<i64>, u32, bool) =
        (None, 0, false);
    let mut reopened = false;
    // an update in the Riot Client extends the wait (up to 30 minutes)
    let mut deadline = t0 + 180_000;
    while alive() && now_ms() < deadline {
        let st = riot::rc_login_state().await;
        if st.up && st.subject.is_none() {
            sw_step("signin", "");
        }
        if let Some(subject) = st.subject {
            signed_in_since.get_or_insert(now_ms());
            sw_step("play", "");
            // once per login: which platform is this account on? (PBE1 = PBE account)
            if !checked {
                let rc = riot::rc_account().await;
                if !alive() {
                    return;
                }
                if let Some(rc) = rc.filter(|r| !r.region.is_empty()) {
                    checked = true;
                    let changed = with(|c| {
                        let id = if c.st.has(&subject) {
                            Some(subject.clone())
                        } else {
                            c.expecting.clone()
                        };
                        match id.and_then(|id| c.st.account_mut(&id)) {
                            Some(a) if str_of(a, "region") != rc.region => {
                                a.insert("region".into(), json!(rc.region));
                                true
                            }
                            _ => false,
                        }
                    });
                    if changed {
                        save();
                    }
                    if rc.region == "PBE" && with(|c| c.play_line) != "pbe" {
                        // close live League if the client started it, start PBE instead
                        with(|c| c.play_line = "pbe");
                        if riot::league_running() && riot::patchline() != "pbe" {
                            riot::close_league_only().await;
                        }
                        if riot::dismiss_pbe_dialog().await != "closed" {
                            sleep(800).await;
                        }
                        // PBE waiting for an update: the loop below waits and presses Play after it
                        if riot::patch_state("pbe").await.is_none_or(|p| p.ready) {
                            riot::press_play("pbe").await;
                        }
                        tauri::async_runtime::spawn(async {
                            sleep(2500).await;
                            riot::dismiss_pbe_dialog().await;
                        });
                        presses += 1;
                        signed_in_since = Some(now_ms());
                    }
                }
            }
            if riot::league_running() {
                // a League left over from another account (the Riot Client was signed in anew
                // while it ran): close just League, the Play below starts it for this account
                if !reopened {
                    let lol = riot::current_account()
                        .await
                        .map(|a| str_of(&a, "puuid").to_string());
                    let busy = riot::gameflow_phase()
                        .await
                        .is_some_and(|p| RISKY_PHASES.contains(&p.as_str()));
                    if !busy && lol.as_deref().is_some_and(|l| l != subject) {
                        reopened = true;
                        log_error(
                            "play",
                            "League ran for another account than the Riot Client – restarted",
                        );
                        riot::close_league_only().await;
                        presses = 0;
                        continue;
                    }
                }
                sw_done();
                return;
            }
            if !with(|c| c.st.set_bool("autoPlay")) {
                if checked {
                    sw_clear();
                    return;
                }
            } else if let Some(ps) = match riot::patch_state(with(|c| c.play_line)).await {
                Some(ps) if !ps.ready => Some(ps),
                // older Riot Clients: any running download counts as "updating"
                None if riot::updating().await => Some(riot::PatchState {
                    ready: false,
                    pct: None,
                }),
                _ => None,
            } {
                // League is updating (or waits for an update): Play only works afterwards – no
                // pressing meanwhile, the steps say so (with the progress)
                sw_step("play", "update");
                with(|c| c.sw["pct"] = json!(ps.pct.map(|p| p.round())));
                push();
                deadline = deadline.max((now_ms() + 120_000).min(t0 + 1_800_000));
                signed_in_since = Some(now_ms());
            } else if presses == 0 || now_ms() - signed_in_since.unwrap_or(0) > 12_000 {
                // give the client a moment to start League by itself; then press again
                if presses >= 3 {
                    sw_clear();
                    return;
                }
                sw_step("play", "");
                // right after a login the client often answers "not ready" for a few seconds:
                // only a press it accepted counts (a refused one is tried again within a second)
                if riot::press_play(with(|c| c.play_line)).await {
                    presses += 1;
                    signed_in_since = Some(now_ms());
                    sw_step("launch", "");
                }
            }
        } else {
            signed_in_since = None;
        }
        sleep(if presses > 0 { 1500 } else { 700 }).await;
    }
}

// ---------- actions ----------

async fn save_active_before_leaving() -> bool {
    with(|c| c.gen += 1);
    // leave lobby / queue first, otherwise the new account often still "sits" in the old lobby
    if riot::leave_lobby().await {
        sleep(1200).await;
    }
    let who = with(|c| {
        c.live
            .puuid
            .clone()
            .or(c.st.active.clone())
            .filter(|w| c.st.has(w))
    });
    let signed_in_as_who = match &who {
        Some(w) => riot::rc_login_state().await.subject.as_deref() == Some(w.as_str()),
        None => false,
    };
    if signed_in_as_who {
        store_session(who.as_deref().unwrap(), true).await;
    }
    if !riot::close_clients().await {
        return false;
    }
    // the client may write its newest tokens on exit: keep that copy too
    if signed_in_as_who {
        store_session(who.as_deref().unwrap(), true).await;
    }
    true
}

fn err_key(k: &str) -> Value {
    json!({ "ok": false, "errorKey": k })
}

async fn with_busy<F: std::future::Future<Output = Value>>(f: F) -> Value {
    if with(|c| std::mem::replace(&mut c.busy, true)) {
        return err_key("m.busy");
    }
    push();
    let r = f.await;
    with(|c| c.busy = false);
    push();
    r
}

async fn do_switch(id: String) -> Value {
    if !is_id(&id) {
        return json!({ "ok": false });
    }
    let acc = with(|c| c.st.account(&id).cloned());
    let session = read_secret(&session_file(&id));
    let cred = load_cred(&id);
    if session.is_none() && cred.is_none() {
        return err_key(
            if acc.as_ref().is_some_and(|a| truthy(a.get("credBroken"))) {
                "m.credBroken"
            } else {
                "m.noSession"
            },
        );
    }
    with(|c| {
        c.login_token += 1;
        c.login = Value::Null;
    });
    let name = |cred: &(String, String)| {
        acc.as_ref()
            .map_or(cred.0.clone(), |a| str_of(a, "gameName").to_string())
    };
    let pl = pl_of(acc.as_ref());

    // a full restart is only needed when another account is signed in or League is running
    let rc = riot::rc_login_state().await;
    if rc.up && !riot::league_running() {
        if rc.subject.as_deref() == Some(id.as_str()) {
            // already signed in as this account, League just isn't open: only press Play
            sw_start(&id, &["play", "launch"]);
            with(|c| {
                c.gen += 1;
                c.st.active = Some(id.clone());
            });
            save();
            let rca = riot::rc_account().await;
            let line = if rca.is_some_and(|r| r.region == "PBE") || pl == "pbe" {
                "pbe"
            } else {
                "live"
            };
            // the client may still be busy for a moment: try again until it takes the press
            tauri::async_runtime::spawn(async move {
                for _ in 0..20 {
                    if riot::league_running() {
                        return sw_done();
                    }
                    if riot::press_play(line).await {
                        sw_step("launch", "");
                        // League's window shows up a few seconds later
                        for _ in 0..60 {
                            if riot::league_running() {
                                return sw_done();
                            }
                            sleep(1000).await;
                        }
                        return sw_clear();
                    }
                    sleep(700).await;
                }
                sw_clear();
            });
            return json!({ "ok": true, "fast": "play" });
        }
        if rc.subject.is_none() {
            if let Some(cr) = &cred {
                // login screen already open and we have the password: type it straight in
                sw_start(&id, &["signin", "play", "launch"]);
                with(|c| {
                    c.gen += 1;
                    c.st.active = Some(id.clone());
                    c.expecting = Some(id.clone());
                    c.expecting_since = now_ms();
                    c.live = Live::default();
                });
                save();
                tauri::async_runtime::spawn(auto_login(
                    cr.0.clone(),
                    cr.1.clone(),
                    name(cr),
                    1500,
                    None,
                ));
                tauri::async_runtime::spawn(auto_play(pl));
                return json!({ "ok": true, "fast": "login" });
            }
        }
    }
    // nothing to start League with: say so before anything is closed
    if !riot::riot_client_found() {
        return err_key("m.noRiotClient");
    }
    sw_start(&id, &["close", "client", "signin", "play", "launch"]);
    if !save_active_before_leaving().await {
        sw_clear();
        return err_key("m.closeFailed");
    }
    let restored = match &session {
        Some(s) => riot::restore_session(s),
        None => {
            riot::clear_session();
            true
        }
    };
    // the sign-in couldn't be put back: with a password it is typed instead, else say so
    if !restored && cred.is_none() {
        sw_clear();
        return err_key("m.restoreFailed");
    }
    let session = session.filter(|_| restored);
    with(|c| {
        c.st.active = Some(id.clone());
        c.expecting = Some(id.clone());
        c.expecting_since = now_ms();
        c.live = Live::default();
    });
    save();
    let started = now_ms();
    if !riot::launch_league(pl) {
        sw_clear();
        return err_key("m.noRiotClient");
    }
    sw_step("client", "");
    if let Some(cr) = &cred {
        tauri::async_runtime::spawn(auto_login(
            cr.0.clone(),
            cr.1.clone(),
            name(cr),
            if session.is_some() { 4000 } else { 1500 },
            Some(started),
        ));
    }
    tauri::async_runtime::spawn(auto_play(pl));
    json!({ "ok": true })
}

async fn do_add_new(c_in: Value) -> Value {
    let cred = valid_cred(&c_in);
    with(|c| {
        c.login_token += 1;
        c.login = Value::Null;
    });
    if !save_active_before_leaving().await {
        return err_key("m.closeFailed");
    }
    riot::clear_session();
    let keep = c_in.get("save") != Some(&json!(false)); // "save" unticked: type it once, keep nothing
    with(|c| {
        c.st.active = None;
        c.live = Live::default();
        c.pending_add = true;
        c.pending_cred = if keep { cred.clone() } else { None };
    });
    save();
    let started = now_ms();
    if !riot::launch_league("live") {
        with(|c| c.pending_add = false);
        return err_key("m.noRiotClient");
    }
    if let Some((u, p)) = cred {
        tauri::async_runtime::spawn(auto_login(u.clone(), p, u, 1500, Some(started)));
    }
    tauri::async_runtime::spawn(auto_play("live"));
    json!({ "ok": true })
}

/// Save a login for later – nothing is closed or logged in now.
/// Save an account for later – nothing is closed or logged in now. With a login (+ optional Riot ID
/// or profile link), or only a Riot ID / profile link: then the tile shows ranks, and switching to it
/// works once you have logged in to it by hand (the app keeps that sign-in).
async fn do_add_saved(c_in: Value) -> Value {
    with(|c| c.gen += 1);
    let cred = valid_cred(&c_in);
    let half = !c_in["u"].as_str().unwrap_or("").trim().is_empty()
        || !c_in["p"].as_str().unwrap_or("").is_empty();
    let rid = c_in["riotId"].as_str().unwrap_or("").trim().to_string();
    if cred.is_none() && (half || rid.is_empty()) {
        return err_key("m.fill");
    }
    let (mut gn, mut tl) = (String::new(), String::new());
    if !rid.is_empty() {
        let Some((g, t)) = accounts::parse_profile_link(&rid).or_else(|| parse_riot_id(&rid))
        else {
            return err_key("m.riotIdFormat");
        };
        gn = g;
        tl = t;
    }
    // already a tile with that Riot ID?
    let existing = with(|c| {
        c.st.accounts
            .iter()
            .find(|a| {
                str_of(a, "gameName").eq_ignore_ascii_case(&gn)
                    && str_of(a, "tagLine").eq_ignore_ascii_case(&tl)
                    && !gn.is_empty()
            })
            .map(|a| str_of(a, "puuid").to_string())
    });
    if let (Some(id), None) = (&existing, &cred) {
        return json!({ "ok": true, "existed": true, "puuid": id });
    }
    let hit = if gn.is_empty() {
        None
    } else {
        riot::lookup_riot_id(&gn, &tl).await
    };
    let id = match &hit {
        _ if existing.is_some() && hit.is_none() => existing.clone().unwrap(),
        Some(h) => {
            let id = str_of(h, "puuid").to_string();
            upsert(h.clone());
            with(|c| {
                if c.live.puuid.as_deref() == Some(id.as_str()) {
                    c.st.active = Some(id.clone());
                }
            });
            id
        }
        None => {
            let id = format!("new-{}", uuid4());
            let name = if gn.is_empty() {
                mask_login(&cred.as_ref().map(|c| c.0.clone()).unwrap_or_default())
            } else {
                gn.clone()
            };
            upsert(obj(
                json!({ "puuid": id, "placeholder": true, "gameName": name, "tagLine": tl }),
            ));
            id
        }
    };
    let saved = cred.as_ref().is_none_or(|(u, p)| store_cred(&id, u, p));
    save();
    if !saved {
        return err_key("m.credSaveFailed");
    }
    json!({ "ok": true, "found": hit.is_some(), "riotId": !gn.is_empty(), "noLogin": cred.is_none(), "puuid": id })
}

fn uuid4() -> String {
    use rand::RngCore;
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

async fn do_set_cred(id: String, c_in: Value) -> Value {
    let Some(a) = with(|c| c.st.account(&id).cloned()) else {
        return err_key("m.userMissing");
    };
    let u = c_in["u"].as_str().unwrap_or("").trim().to_string();
    if u.is_empty() {
        return err_key("m.userMissing");
    }
    let mut p = c_in["p"].as_str().unwrap_or("").to_string();
    if p.is_empty() {
        if let Some(old) = load_cred(&id) {
            p = old.1;
        }
    }
    if p.is_empty() {
        return err_key("m.passMissing");
    }
    // Riot ID for a saved account that had none yet
    let rid = if truthy(a.get("placeholder")) && !truthy(a.get("tagLine")) {
        c_in["riotId"].as_str().unwrap_or("").trim().to_string()
    } else {
        String::new()
    };
    let m = if rid.is_empty() {
        None
    } else {
        parse_riot_id(&rid)
    };
    if !rid.is_empty() && m.is_none() {
        return err_key("m.riotIdFormat");
    }
    if !store_cred(&id, &u, &p) {
        return err_key("m.credSaveFailed");
    }
    let mut found = false;
    if let Some((gn, tl)) = m {
        with(|c| c.gen += 1);
        match riot::lookup_riot_id(&gn, &tl).await {
            Some(hit) if with(|c| c.st.has(&id)) => {
                let hid = str_of(&hit, "puuid").to_string();
                with(|c| resolve_placeholder(c, &id, &hid));
                upsert(hit);
                found = true;
            }
            _ => with(|c| {
                if let Some(a) = c.st.account_mut(&id) {
                    a.insert("gameName".into(), json!(gn));
                    a.insert("tagLine".into(), json!(tl));
                }
            }),
        }
    }
    save();
    json!({ "ok": true, "found": found })
}

async fn do_tool(what: String) -> Value {
    let rc = riot::rc_dir();
    match what.as_str() {
        // closing tools keep the newest sign-in of the current account first (like a switch)
        "closeAll" => json!({ "ok": save_active_before_leaving().await }),
        "restart" => {
            if !save_active_before_leaving().await {
                return json!({ "ok": false });
            }
            let pl = with(|c| {
                pl_of(
                    c.st.active
                        .clone()
                        .and_then(|a| c.st.account(&a).cloned())
                        .as_ref(),
                )
            });
            if !riot::launch_league(pl) {
                return json!({ "ok": false });
            }
            tauri::async_runtime::spawn(auto_play(pl));
            json!({ "ok": true })
        }
        "clearCache" => {
            // only the Riot Client's web cache and logs – never its Data folder (the sign-in)
            if !save_active_before_leaving().await {
                return json!({ "ok": false });
            }
            for d in ["HttpCache", "Logs"] {
                let _ = std::fs::remove_dir_all(rc.join(d));
            }
            json!({ "ok": true })
        }
        "openLogs" => {
            let logs = rc.join("Logs");
            json!({ "ok": logs.exists() && open_path(&logs.to_string_lossy()) })
        }
        "openData" => json!({ "ok": open_path(&data().to_string_lossy()) }),
        _ => json!({ "ok": false }),
    }
}

fn open_path(target: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let w: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    let op: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let r = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(op.as_ptr()),
            PCWSTR(w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    r.0 as isize > 32
}
const SUPPORT_URL: &str = "https://buymeacoffee.com/zlizz3r";

// ---------- export / import ----------

async fn pick_file(save: bool) -> Option<PathBuf> {
    pick_file_as(save, "rift-switch-backup.json", "JSON", "json").await
}
async fn pick_file_as(save: bool, name: &str, kind: &str, ext: &str) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut d = app().dialog().file().add_filter(kind, &[ext]);
    if let Some(w) = window() {
        d = d.set_parent(&w);
    }
    if save {
        d.set_file_name(name).save_file(move |p| {
            let _ = tx.send(p);
        });
    } else {
        d.pick_file(move |p| {
            let _ = tx.send(p);
        });
    }
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}

/// A text file for a bug report: versions, what was found where, the state of League and the
/// Riot Client, counts (no names) and the end of the error log – personal bits replaced.
async fn do_diagnostics() -> Value {
    let Some(file) = pick_file_as(true, "rift-switch-diagnostics.txt", "Text", "txt").await else {
        return json!({ "ok": false });
    };
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let (st, ver) = (riot::rc_login_state().await, env!("CARGO_PKG_VERSION"));
    let mut out = format!(
        "Rift Switch {ver}\nWindows: {} {}\nTime: {}\nData folder: {}\n\n## Installs\n",
        std::env::var("OS").unwrap_or_default(),
        std::env::var("PROCESSOR_ARCHITECTURE").unwrap_or_default(),
        now_ms(),
        data().display()
    );
    for (what, path, ok) in riot::install_report() {
        out += &format!(
            "{what}: {path} ({})\n",
            if ok { "found" } else { "MISSING" }
        );
    }
    let (n, creds, saved, regions, live, settings) = with(|c| {
        let mut regions: std::collections::BTreeMap<String, usize> = Default::default();
        for a in &c.st.accounts {
            *regions.entry(str_of(a, "region").to_string()).or_default() += 1;
        }
        (
            c.st.accounts.len(),
            c.st.accounts
                .iter()
                .filter(|a| truthy(a.get("hasCred")))
                .count(),
            c.st.accounts
                .iter()
                .filter(|a| truthy(a.get("placeholder")))
                .count(),
            regions,
            json!({ "clientUp": c.live.client_up, "phase": c.live.phase, "busy": c.busy, "switching": !c.sw.is_null() }),
            Value::Object(c.st.settings.clone()),
        )
    });
    out += &format!(
        "\n## Now\nRiot Client: {}\nLeague: {live}\n\n## Accounts\n{n} accounts, {creds} with a saved login, {saved} not logged in yet\nServers: {regions:?}\n\n## Settings\n{settings}\n\n## error.log (last 200 lines)\n",
        if !st.up { "not running" } else if st.subject.is_some() { "signed in" } else { "login screen" }
    );
    let log = std::fs::read_to_string(data().join("error.log")).unwrap_or_default();
    let lines: Vec<&str> = log.lines().collect();
    for l in &lines[lines.len().saturating_sub(200)..] {
        out += &ops::redact(l, &home);
        out.push('\n');
    }
    let scout = std::fs::read_to_string(data().join("scout.log")).unwrap_or_default();
    let lines: Vec<&str> = scout.lines().collect();
    if !lines.is_empty() {
        out += "\n## scout.log (Live's loading, last 120 lines)\n";
        for l in &lines[lines.len().saturating_sub(120)..] {
            out += &ops::redact(l, &home);
            out.push('\n');
        }
    }
    let out = ops::redact(&out, &home);
    // the names of the saved accounts too (a Riot ID with spaces would otherwise keep its first words)
    let names: Vec<String> = with(|c| {
        c.st.accounts
            .iter()
            .map(|a| str_of(a, "gameName").to_string())
            .filter(|n| n.chars().count() >= 3)
            .collect()
    });
    let out = names
        .iter()
        .fold(out, |o, n| o.replace(n.as_str(), "<name>"));
    match std::fs::write(&file, out) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.kind().to_string() }),
    }
}

/// "Is it really you?" before saved passwords leave their safe: Windows Hello (PIN, fingerprint,
/// face) – or, given `app_pass` (where Hello isn't set up), the app password.
/// Some(true) = confirmed, Some(false) = not, None = no Windows Hello on this PC.
async fn confirm_owner(app_pass: Option<&str>, why: &str) -> Option<bool> {
    if let Some(p) = app_pass {
        let lock = with(|c| c.st.lock.clone());
        let p = p.to_string();
        return Some(
            lock.is_some()
                && tokio::task::spawn_blocking(move || {
                    secrets::lock_matches(lock.as_ref(), Some(&p))
                })
                .await
                .unwrap_or(false),
        );
    }
    let hwnd = window()
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
        .unwrap_or(0);
    let msg = tr(why, &[]);
    match tokio::task::spawn_blocking(move || secrets::windows_confirm(hwnd, &msg)).await {
        Ok(Ok(v)) => Some(v),
        Ok(Err(_)) => None,
        Err(_) => Some(false),
    }
}
/// what: "user" | "pass". → { ok } or { ok: false, noHello / denied / noLogin / failed }
async fn copy_login(id: &str, what: &str, app_pass: Option<&str>) -> Value {
    if !is_id(id) {
        return json!({ "ok": false, "noLogin": true });
    }
    let Some((u, p)) = load_cred(id) else {
        return json!({ "ok": false, "noLogin": true });
    };
    let text = if what == "pass" {
        match confirm_owner(app_pass, "reveal.copy").await {
            Some(true) => p,
            Some(false) => return json!({ "ok": false, "denied": true }),
            None => return json!({ "ok": false, "noHello": true }),
        }
    } else {
        u
    };
    let Some(seq) = tokio::task::spawn_blocking(move || winsys::copy_private(&text))
        .await
        .ok()
        .flatten()
    else {
        return json!({ "ok": false, "failed": true });
    };
    *COPIED.lock().unwrap_or_else(|e| e.into_inner()) = Some(seq);
    tauri::async_runtime::spawn(async move {
        sleep(30_000).await;
        let _ = tokio::task::spawn_blocking(move || clear_copied(Some(seq))).await;
    });
    json!({ "ok": true })
}
/// What copy_login put on the clipboard (its sequence number) until it is cleared – also when the
/// app quits (an update, the tray menu) or panics within the 30 s.
static COPIED: Mutex<Option<u32>> = Mutex::new(None);
/// Clears the clipboard if it still holds the copied login: `only` that copy, or any pending one.
fn clear_copied(only: Option<u32>) {
    let mut c = COPIED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(seq) = *c {
        if only.is_none_or(|o| o == seq) {
            winsys::clear_clipboard_if(seq);
            *c = None;
        }
    }
}

/// "Appear offline" is gone (Riot's policies allow no way into League's chat). Whoever had it on
/// is set online once – the first time League is up after the update – and the setting goes.
async fn undo_offline() {
    if !with(|c| c.st.set_bool("appearOffline")) {
        return;
    }
    if riot::chat_online().await {
        with(|c| c.st.settings.remove("appearOffline"));
        save();
    }
}

/// Load by itself (setting "autoLoad", on): an account just signed in – once the client has
/// settled, the same as pressing Load, once per account in 30 minutes. It waits for a quiet moment
/// (not in a game, nothing else loading) up to 10 minutes and gives up when another account signs in.
static AUTO_LOADED: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);
// the sign-in is noticed inside tick(), and a Load runs tick() itself: a loop of its own takes the
// account (no task spawned from tick that waits on tick)
static AUTO_PENDING: Mutex<Option<String>> = Mutex::new(None);
static AUTO_KICK: tokio::sync::Notify = tokio::sync::Notify::const_new();
fn auto_load_ask(id: &str) {
    *AUTO_PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(id.to_string());
    AUTO_KICK.notify_one();
}
async fn auto_load_loop() {
    loop {
        AUTO_KICK.notified().await;
        let id = AUTO_PENDING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(id) = id {
            auto_load(id).await;
        }
    }
}
async fn auto_load(id: String) {
    if riot::offline_test() || !with(|c| c.st.set_bool("autoLoad")) {
        return;
    }
    {
        let mut m = AUTO_LOADED.lock().unwrap_or_else(|e| e.into_inner());
        let m = m.get_or_insert_with(HashMap::new);
        if m.get(&id).is_some_and(|t| now_ms() - t < 1_800_000) {
            return;
        }
        m.insert(id.clone(), now_ms());
    }
    sleep(45_000).await;
    for _ in 0..40 {
        if with(|c| c.live.puuid.as_deref() != Some(id.as_str())) {
            return;
        }
        // not while queueing or in champion select either: Live goes first
        let quiet = with(|c| {
            !c.live
                .phase
                .as_deref()
                .is_some_and(|p| ["Matchmaking", "ReadyCheck", "ChampSelect"].contains(&p))
        });
        match if quiet { load_start() } else { Some("inGame") } {
            None => {
                push();
                load_all().await;
                return;
            }
            Some("closed") => return,
            Some(_) => sleep(15_000).await,
        }
    }
}
/// Starts a Load (the progress every Load button shows) – or why not: closed, inGame, busy, running.
fn load_start() -> Option<&'static str> {
    with(|c| {
        if !c.live.client_up || c.live.puuid.is_none() {
            return Some("closed");
        }
        if c.live
            .phase
            .as_deref()
            .is_some_and(|p| IN_GAME.contains(&p))
        {
            return Some("inGame");
        }
        if c.busy {
            return Some("busy");
        }
        if c.loading.is_object() {
            return Some("running");
        }
        c.loading = json!({ "step": "coll", "n": 1, "of": LOAD_STEPS.len(), "done": 0, "total": 0, "since": now_ms() });
        None
    })
}

/// pass: the export password (logins go along, encrypted with it) or null (no logins).
/// With logins, Windows Hello (or the app password, `app_pass`) confirms it first – like showing one.
async fn do_export(pass: Value, app_pass: Value) -> Value {
    if pass.as_str().is_some_and(|p| p.chars().count() >= 8) {
        match confirm_owner(app_pass.as_str(), "reveal.export").await {
            Some(true) => {}
            Some(false) => return json!({ "ok": false, "denied": true }),
            None => return json!({ "ok": false, "noHello": true }),
        }
    }
    let Some(file) = pick_file(true).await else {
        return json!({ "ok": false });
    };
    let secrets = match pass.as_str() {
        Some(p) if p.chars().count() >= 8 => {
            let accs: Vec<Obj> = with(|c| c.st.accounts.clone());
            let mut logins = vec![];
            for a in accs {
                if !(truthy(a.get("hasCred")) || truthy(a.get("placeholder"))) {
                    continue;
                }
                let id = str_of(&a, "puuid");
                if let Some((u, pw)) = load_cred(id) {
                    let mut l = json!({ "puuid": id, "u": u, "p": pw });
                    if truthy(a.get("placeholder")) {
                        l["placeholder"] = json!(true);
                        l["gameName"] = a.get("gameName").cloned().unwrap_or(json!(""));
                        l["tagLine"] = json!(str_of(&a, "tagLine"));
                    }
                    logins.push(l);
                }
            }
            let p = p.to_string();
            Some(
                tokio::task::spawn_blocking(move || {
                    secrets::seal(&json!({ "logins": logins }), &p)
                })
                .await
                .unwrap_or(Value::Null),
            )
        }
        _ => None,
    };
    let f = with(|c| store::build_export(&c.st, secrets, now_ms()));
    let n = f["accounts"].as_array().map_or(0, Vec::len);
    let mut buf = vec![];
    let mut ser = serde_json::Serializer::with_formatter(
        &mut buf,
        serde_json::ser::PrettyFormatter::with_indent(b" "),
    );
    let _ = serde::Serialize::serialize(&f, &mut ser);
    match std::fs::write(&file, buf) {
        Ok(()) => json!({ "ok": true, "n": n }),
        Err(e) => json!({ "ok": false, "error": e.kind().to_string() }),
    }
}
fn read_import(f: &Path) -> Option<Value> {
    let t = std::fs::read_to_string(f).ok()?;
    store::check_file(serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()?)
}
/// pass: null = pick a file; a string = the password for the file picked before; "skip" = without logins
async fn do_import(pass: Value) -> Value {
    if pass.is_null() {
        let Some(f) = pick_file(false).await else {
            return json!({ "ok": false });
        };
        with(|c| c.import_file = Some(f));
    }
    let Some(d) = with(|c| c.import_file.clone()).and_then(|f| read_import(&f)) else {
        return json!({ "ok": false, "error": "format" });
    };
    let has_secrets = d.get("secrets").is_some_and(|s| !s.is_null());
    if has_secrets && pass.is_null() {
        return json!({ "needPass": true, "logins": "" });
    }
    let mut logins = vec![];
    if has_secrets && pass.as_str() != Some("skip") {
        let (bx, p) = (
            d["secrets"].clone(),
            pass.as_str().unwrap_or("").to_string(),
        );
        let Some(s) = tokio::task::spawn_blocking(move || secrets::open(&bx, &p))
            .await
            .ok()
            .flatten()
        else {
            return json!({ "ok": false, "error": "pass" });
        };
        logins = s["logins"].as_array().cloned().unwrap_or_default();
    }
    let cat = tr("cat.new", &[]);
    let (added, updated, restore) = with(|c| {
        c.import_file = None;
        c.gen += 1;
        let (a, u) = store::apply_import(&mut c.st, &d, &cat, now_ms());
        let r = store::logins_to_restore(&mut c.st, &logins, now_ms());
        (a, u, r)
    });
    apply_scale();
    let stored = restore
        .iter()
        .filter(|(id, u, p)| store_cred(id, u, p))
        .count();
    save();
    json!({ "ok": true, "added": added, "updated": updated, "logins": stored })
}

// ---------- the one command the window calls ----------

const LOCK_FREE: [&str; 3] = ["get-state", "unlock", "win"];

#[tauri::command]
async fn call(ch: String, args: Vec<Value>) -> Value {
    // while locked the window gets no account data and every action except unlocking is refused
    if with(|c| c.locked) && !LOCK_FREE.contains(&ch.as_str()) {
        return Value::Null;
    }
    dispatch(&ch, args).await
}

async fn dispatch(ch: &str, args: Vec<Value>) -> Value {
    let a = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let s = |i: usize| {
        args.get(i)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match ch {
        "get-state" => {
            let pending = with(|c| {
                c.last_pushed = 0;
                c.after_load_switch.take()
            });
            if let Some(id) = pending {
                tauri::async_runtime::spawn(async move {
                    sleep(300).await;
                    emit("tray-switch", json!(id));
                });
            }
            with(|c| snapshot(c))
        }
        "unlock" => {
            let _one = UNLOCKING.lock().await;
            let fails = with(|c| c.unlock_fails);
            sleep((400 * fails as u64).min(5000)).await; // slows down guessing
            let (lock, pass) = (with(|c| c.st.lock.clone()), s(0));
            let ok = tokio::task::spawn_blocking(move || {
                let ok = secrets::lock_matches(lock.as_ref(), Some(&pass));
                let key = lock
                    .as_ref()
                    .filter(|_| ok)
                    .and_then(|l| l["ksalt"].as_str())
                    .and_then(|ks| secrets::login_key(&pass, ks));
                (ok, key)
            })
            .await
            .unwrap_or((false, None));
            let (ok, key) = ok;
            with(|c| {
                if ok {
                    c.unlock_fails = 0;
                    c.locked = false;
                    c.last_pushed = 0;
                    if key.is_some() {
                        c.login_key = key;
                    }
                } else {
                    c.unlock_fails += 1;
                }
            });
            if ok {
                check_creds(); // sealed logins are readable again
                push();
                update_tray();
            }
            json!(ok)
        }
        "lock" => {
            let (what, pass, old) = (s(0), a(1), a(2));
            match what.as_str() {
                "now" => {
                    lock_now();
                    json!(true)
                }
                "set" => {
                    let Some(p) = pass
                        .as_str()
                        .filter(|p| p.chars().count() >= 4)
                        .map(String::from)
                    else {
                        return json!(false);
                    };
                    let lock = with(|c| c.st.lock.clone());
                    let sealed = with(|c| sealed_on(c));
                    let made = tokio::task::spawn_blocking(move || {
                        if lock.is_some() && !secrets::lock_matches(lock.as_ref(), old.as_str()) {
                            None
                        } else {
                            let mut l = secrets::make_lock(&p);
                            let ks = secrets::new_key_salt();
                            let key = secrets::login_key(&p, &ks);
                            l["ksalt"] = json!(ks);
                            if sealed {
                                l["sealLogins"] = json!(true);
                            }
                            Some((l, key))
                        }
                    })
                    .await
                    .ok()
                    .flatten();
                    match made {
                        Some((l, key)) => {
                            let logins = all_creds(); // read with the old key
                            let before = with(|c| {
                                let b = (c.st.lock.clone(), c.login_key);
                                c.st.lock = Some(l);
                                c.login_key = key;
                                b
                            });
                            if sealed && !rewrite_creds(&logins) {
                                // the logins stay sealed with the old password: so does the lock
                                with(|c| (c.st.lock, c.login_key) = before);
                                return json!(false);
                            }
                            save();
                            json!(true)
                        }
                        None => json!(false),
                    }
                }
                "off" => {
                    let lock = with(|c| c.st.lock.clone());
                    let ok = lock.is_none()
                        || tokio::task::spawn_blocking(move || {
                            secrets::lock_matches(lock.as_ref(), pass.as_str())
                        })
                        .await
                        .unwrap_or(false);
                    if ok {
                        let logins = all_creds();
                        let before = with(|c| c.st.lock.take());
                        if !rewrite_creds(&logins) {
                            with(|c| c.st.lock = before); // logins still sealed: the lock stays
                            return json!(false);
                        }
                        with(|c| c.login_key = None);
                        save();
                    }
                    json!(ok)
                }
                // logins additionally sealed with the app password: on / off (asks the password)
                "seal" | "unseal" => {
                    let Some(l) = with(|c| c.st.lock.clone()) else {
                        return json!(false);
                    };
                    let p = pass.as_str().unwrap_or("").to_string();
                    let l2 = l.clone();
                    let key = tokio::task::spawn_blocking(move || {
                        if !secrets::lock_matches(Some(&l2), Some(&p)) {
                            return None;
                        }
                        let ks = l2["ksalt"]
                            .as_str()
                            .map(String::from)
                            .unwrap_or_else(secrets::new_key_salt);
                        secrets::login_key(&p, &ks).map(|k| (k, ks))
                    })
                    .await
                    .ok()
                    .flatten();
                    let Some((key, ks)) = key else {
                        return json!(false);
                    };
                    let logins = all_creds();
                    let before = with(|c| {
                        let b = (c.st.lock.clone(), c.login_key);
                        c.login_key = Some(key);
                        if let Some(lock) = c.st.lock.as_mut() {
                            lock["ksalt"] = json!(ks);
                            lock["sealLogins"] = json!(what == "seal");
                        }
                        b
                    });
                    let ok = rewrite_creds(&logins);
                    if !ok {
                        with(|c| (c.st.lock, c.login_key) = before);
                    }
                    save();
                    json!(ok)
                }
                _ => json!(false),
            }
        }
        // a saved password, shown in the login details: only after Windows confirms it's you
        // (or with the app password where Windows Hello isn't set up)
        "reveal-pass" => {
            let id = s(0);
            if !is_id(&id) {
                return json!({ "ok": false });
            }
            match confirm_owner(a(1).as_str(), "reveal.why").await {
                Some(true) => {}
                Some(false) => return json!({ "ok": false }),
                None => return json!({ "ok": false, "noHello": true }),
            }
            match load_cred(&id) {
                Some((_, p)) => json!({ "ok": true, "p": p }),
                None => json!({ "ok": false }),
            }
        }
        "get-history" => with(|c| {
            c.st.account(&s(0))
                .and_then(|a| a.get("history").cloned())
                .unwrap_or(json!([]))
        }),
        // the overview page: LP history and ranked games of every real account at once
        "dashboard" => with(|c| {
            let list: Vec<Value> =
                c.st.accounts
                    .iter()
                    .filter(|a| !truthy(a.get("placeholder")))
                    .map(|a| {
                        json!({ "puuid": str_of(a, "puuid"),
                        "history": a.get("history").cloned().unwrap_or(json!([])),
                        "games": a.get("rankedGames").cloned().unwrap_or(json!([])) })
                    })
                    .collect();
            Value::Array(list)
        }),
        // the collection page: what every account owns (as of its last login)
        "collections" => with(|c| {
            let list: Vec<Value> =
                c.st.accounts
                    .iter()
                    .filter(|a| a.get("coll").is_some_and(Value::is_object))
                    .map(|a| {
                        let mut x = a["coll"].clone();
                        x["puuid"] = json!(str_of(a, "puuid"));
                        x
                    })
                    .collect();
            Value::Array(list)
        }),
        // the mastery page: every champion's points per account (as of its last reading)
        "masteries" => with(|c| {
            let list: Vec<Value> =
                c.st.accounts
                    .iter()
                    .filter(|a| a.get("mast").is_some_and(Value::is_object))
                    .map(|a| {
                        let mut x = a["mast"].clone();
                        x["puuid"] = json!(str_of(a, "puuid"));
                        x
                    })
                    .collect();
            Value::Array(list)
        }),
        // the readings of each account's mastery (for the play time estimate): { puuid: [lines] }
        "mastery-history" => {
            let ids: Vec<String> = with(|c| {
                c.st.accounts
                    .iter()
                    .filter(|a| a.get("mast").is_some())
                    .map(|a| str_of(a, "puuid").to_string())
                    .collect()
            });
            Value::Object(
                ids.into_iter()
                    .map(|id| {
                        let h = read_mastery(&id);
                        (id, Value::Array(h))
                    })
                    .collect(),
            )
        }
        // a rank goal per account and queue: Solo/Duo in "goal", the others in "goals"
        "goal" => {
            let goal = ops::goal_of(&a(1));
            let q = s(2);
            if with(|c| {
                c.st.account_mut(&s(0))
                    .map(|a| {
                        if q.is_empty() || q == "solo" {
                            match goal {
                                Some(g) => a.insert("goal".into(), g),
                                None => a.remove("goal"),
                            };
                        } else if RANK_QUEUES.contains(&q.as_str()) {
                            let gs = a.entry("goals").or_insert_with(|| json!({}));
                            if !gs.is_object() {
                                *gs = json!({});
                            }
                            let gs = gs.as_object_mut().unwrap();
                            match goal {
                                Some(g) => gs.insert(q.clone(), g),
                                None => gs.remove(&q),
                            };
                        }
                    })
                    .is_some()
            }) {
                save();
            }
            Value::Null
        }
        // earlier seasons entered by hand (kept apart, marked as such)
        "seasons-set" => {
            let list = ops::seasons_of(&a(1));
            let ok = with(|c| {
                c.st.account_mut(&s(0))
                    .map(|a| {
                        if list.is_empty() {
                            a.remove("seasonsManual");
                        } else {
                            a.insert("seasonsManual".into(), json!(list));
                        }
                    })
                    .is_some()
            });
            if ok {
                save();
                push();
            }
            json!({ "ok": ok })
        }
        "ranked-games" => with(|c| {
            c.st.account(&s(0))
                .and_then(|a| a.get("rankedGames").cloned())
                .unwrap_or(json!([]))
        }),
        "switch" => with_busy(do_switch(s(0))).await,
        "add-new" => with_busy(do_add_new(a(0))).await,
        "add-saved" => do_add_saved(a(0)).await,
        "add-current" => {
            with_busy(async {
                with(|c| c.gen += 1);
                let Some(cur) = riot::current_account().await else {
                    return err_key("m.notLoggedIn");
                };
                let id = str_of(&cur, "puuid").to_string();
                upsert(cur);
                with(|c| c.st.active = Some(id.clone()));
                let stored = store_session(&id, false).await;
                save();
                if stored {
                    json!({ "ok": true, "puuid": id })
                } else {
                    err_key("m.noSessionFound")
                }
            })
            .await
        }
        "cancel-add" => {
            with(|c| {
                c.pending_add = false;
                c.pending_cred = None;
                c.login_token += 1;
                c.login = Value::Null;
            });
            push();
            Value::Null
        }
        "fix-mismatch" => {
            let (phase, rc) = with(|c| (c.live.phase.clone(), c.live.rc.clone()));
            if phase.as_deref().is_some_and(|p| RISKY_PHASES.contains(&p)) {
                return json!({ "ok": false, "risky": true });
            }
            let Some(rc) = rc else {
                return json!({ "ok": false });
            };
            let pl = with(|c| pl_of(c.st.account(&rc)));
            with_busy(async move {
                riot::close_league_only().await;
                tauri::async_runtime::spawn(auto_play(pl));
                json!({ "ok": true })
            })
            .await
        }
        "show-riot-client" => {
            riot::show_riot_client();
            Value::Null
        }
        "dismiss-login" => {
            with(|c| c.login_token += 1);
            set_login(Value::Null);
            Value::Null
        }
        "cancel-switch" => {
            with(|c| {
                c.login_token += 1;
                c.play_token += 1;
                c.login = Value::Null;
            });
            sw_clear();
            Value::Null
        }
        // the password never goes back to the window – only the username, for the edit form
        "get-cred-user" => {
            let id = s(0);
            json!(if is_id(&id) {
                load_cred(&id).map(|c| c.0).unwrap_or_default()
            } else {
                String::new()
            })
        }
        "set-cred" => do_set_cred(s(0), a(1)).await,
        "del-cred" => {
            let id = s(0);
            if is_id(&id) {
                let _ = std::fs::remove_file(cred_file(&id));
                with(|c| {
                    if let Some(a) = c.st.account_mut(&id) {
                        a.insert("hasCred".into(), json!(false));
                    }
                });
                save();
            }
            Value::Null
        }
        "remove" => {
            let id = s(0);
            if is_id(&id) {
                with(|c| {
                    c.gen += 1;
                    c.st.accounts.retain(|a| str_of(a, "puuid") != id);
                    c.mh.forget(&id);
                    if c.st.active.as_deref() == Some(id.as_str()) {
                        c.st.active = None;
                    }
                });
                let _ = std::fs::remove_file(session_file(&id));
                let _ = std::fs::remove_file(cred_file(&id));
                let _ = std::fs::remove_file(mastery_file(&id));
                save();
            }
            Value::Null
        }
        "note" => {
            let note: String = match a(1) {
                Value::String(x) => x,
                Value::Null => String::new(),
                v => v.to_string(),
            }
            .chars()
            .take(24)
            .collect();
            if with(|c| {
                c.st.account_mut(&s(0))
                    .map(|a| a.insert("note".into(), json!(note)))
                    .is_some()
            }) {
                save();
            }
            Value::Null
        }
        "cat-add" => {
            let def = tr("cat.new", &[]);
            let id = format!("c{}", &uuid4()[..8]);
            let name = a(0).as_str().unwrap_or("").to_string();
            with(|c| ops::cat_add(&mut c.st, &name, &def, &id));
            save();
            json!(id)
        }
        "cat-rename" => {
            if with(|c| ops::cat_rename(&mut c.st, &s(0), &s(1))) {
                save()
            } else {
                push()
            }
            Value::Null
        }
        "cat-toggle" => {
            if with(|c| ops::cat_toggle(&mut c.st, &s(0))) {
                save();
            }
            Value::Null
        }
        "cat-move" => {
            if with(|c| ops::cat_move(&mut c.st, &s(0), num_of(args.get(1)))) {
                save();
            }
            Value::Null
        }
        "cat-del" => {
            with(|c| ops::cat_del(&mut c.st, &s(0)));
            save();
            Value::Null
        }
        // new order (+ category with "arrange") of every tile: drag & drop, "move to"
        "arrange" | "reorder" => {
            let Some(list) = a(0).as_array().cloned() else {
                return Value::Null;
            };
            with(|c| {
                c.gen += 1;
                ops::arrange(&mut c.st, &list, ch == "arrange");
            });
            save();
            Value::Null
        }
        "live" => live::snapshot(data()).await,
        "champions" => live::champions(data()).await,
        "champ-damage" => {
            let ids: Vec<i64> = a(0)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .take(20)
                .collect();
            live::damage_types(data(), &ids).await
        }
        // a game's replay: its state, download it, or watch it (League plays it)
        "replay" => match s(0).parse::<u64>() {
            Ok(id) if !game_on() => riot::replay(id, &s(1)).await,
            Ok(_) => json!({ "state": "inGame" }),
            Err(_) => json!({ "state": "missingOrExpired" }),
        },
        // champion select: a random owned skin of the picked champion, maybe in one of its chromas
        "random-skin" => riot::random_skin().await,
        // League's own language: which ones there are and which is set; set one (League closed)
        "client-language" => riot::client_language(),
        "client-language-set" => riot::set_client_language(&s(0), riot::league_running()),
        // a saved login on the clipboard (kept out of the clipboard history, cleared after 30 s):
        // the name as it is, the password only after Windows Hello (or the app password)
        "copy-login" => copy_login(&s(0), &s(1), a(2).as_str()).await,
        "tool" => with_busy(do_tool(s(0))).await,
        "open-multi" => {
            // op.gg multisearch for up to 5 Riot IDs (Clash opponents, picked tiles)
            if let Some(url) =
                ops::opgg_multi_url(&s(0), a(1).as_array().map(Vec::as_slice).unwrap_or(&[]))
            {
                open_path(&url);
            }
            Value::Null
        }
        // the collection page: read the signed-in account's profile and collection now
        // "Load" (collection, mastery, panel, overview): everything for the signed-in account at
        // once; a second press while it runs just shows the same progress
        "load-all" => {
            if let Some(why) = load_start() {
                return json!({ "ok": false, "why": why });
            }
            push();
            load_all().await
        }
        "refresh" => {
            if with(|c| c.ticking || c.busy) {
                return json!({ "ok": false, "busy": true });
            }
            with(|c| c.last_rank_sweep = 0);
            tick().await;
            push();
            json!({ "ok": true })
        }
        // the page's list: [id, time, queue, owners…] of every game – it asks only for games it lacks
        "matches" => {
            let f = a(0);
            let accs: Vec<String> = with(|c| {
                c.st.accounts
                    .iter()
                    .map(|a| str_of(a, "puuid").to_string())
                    .collect()
            });
            let puuid = f["puuid"].as_str().filter(|p| is_id(p)).map(String::from);
            // "" / null = every queue; else one or several groups, comma separated
            let queue = f["queue"]
                .as_str()
                .filter(|q| {
                    !q.is_empty()
                        && q.split(',')
                            .all(|k| matches::QUEUE_GROUPS.iter().any(|(g, _)| *g == k))
                })
                .map(String::from);
            with(|c| {
                json!({ "index": c.mh.index_list(&accs, puuid.as_deref(), queue.as_deref()), "waiting": c.mh.missing().len(),
                "clientUp": c.live.client_up })
            })
        }
        // up to 500 games by id, read from disk outside the lock
        "matches-get" => {
            let ids: Vec<String> = a(0)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .take(500)
                .map(String::from)
                .collect();
            json!(read_own_games(ids).await)
        }
        // every own account's games in short (time, length, queue, champion, win, remake)
        "own-games" => {
            let (ids, owners) = with(|c| {
                let accs: Vec<String> =
                    c.st.accounts
                        .iter()
                        .map(|a| str_of(a, "puuid").to_string())
                        .collect();
                let ids: Vec<String> =
                    c.mh.index_list(&accs, None, None)
                        .iter()
                        .filter_map(|r| r[0].as_str().map(String::from))
                        .collect();
                (
                    ids,
                    accs.into_iter()
                        .collect::<std::collections::HashSet<String>>(),
                )
            });
            Value::Object(matches::own_rows(&read_own_games(ids).await, &owners))
        }
        "mh-assets" => live::game_assets(data()).await,
        "mh-storage" => with(|c| json!({ "bytes": c.mh.size(), "games": c.mh.count() })),
        // other players' games (Live): size, delete, and what is known of up to ten of them
        "others-storage" => others(|o| json!({ "bytes": o.size(), "games": o.count() })),
        "others-clear" => {
            others(|o| o.clear());
            scout(|s| {
                s.listed.clear();
                s.mastery.clear();
                s.failed.clear();
            });
            json!({ "ok": true })
        }
        // the players of this game: each one's game ids and mastery, and the games the window doesn't
        // hold yet (arg 1: the keys "k" of the games it has) – not up to 10 MB again at every refresh
        // the player page: this player from now on (what is known comes at once, the rest follows
        // with "player-changed"); arg 1: the keys "k" of the games the window holds
        "player-games" => {
            let p = s(0);
            if p.is_empty() || p.len() > 80 {
                return Value::Null;
            }
            let fresh = look(|l| {
                let fresh = l.puuid != p;
                if fresh {
                    *l = Look {
                        puuid: p.clone(),
                        ..Default::default()
                    };
                }
                fresh
            });
            if fresh {
                LOOK_KICK.notify_one();
            }
            let have: std::collections::HashSet<String> = a(1)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect();
            let (ids, games) = others(|o| o.games_of(&p, &have));
            let mut info = look(|l| l.info.clone());
            if info.is_none() && !riot::offline_test() {
                info = live::player_info(&p).await;
                look(|l| {
                    if l.puuid == p && info.is_some() {
                        l.info = info.clone();
                    }
                });
            }
            json!({ "ids": ids, "games": games, "info": info, "mastery": look(|l| l.mastery.clone()), "progress": look_snapshot(&p) })
        }
        // the search for the player page: "Name#Tag" (without a tag: the server's own, like EUW) →
        // { puuid, gameName, tagLine, region, … } or null – through the client, like adding an account
        // the lane table for the champ select helper (lanes.rs); null before the first build
        "lane-stats" => {
            let t = lanes::read(data());
            if now_ms() - t["at"].as_i64().unwrap_or(0) > lanes::STALE_MS {
                lanes_rebuild();
            }
            t
        }
        "find-player" => {
            let q = s(0);
            let q = q.trim();
            if q.is_empty() || q.len() > 60 || riot::offline_test() {
                return Value::Null;
            }
            let (gn, tl) = match q.rsplit_once('#') {
                Some((g, t)) => (g.trim().to_string(), t.trim().to_string()),
                None => (q.to_string(), riot::region().await),
            };
            if gn.is_empty() || tl.is_empty() {
                return Value::Null;
            }
            riot::lookup_riot_id(&gn, &tl)
                .await
                .map(Value::Object)
                .unwrap_or(Value::Null)
        }
        "scout-games" => {
            let ids: Vec<String> = a(0)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|p| is_id(p))
                .take(10)
                .map(String::from)
                .collect();
            let have: std::collections::HashSet<String> = a(1)
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect();
            let mast = scout(|s| s.mastery.clone());
            let mut games: Vec<Value> = vec![];
            let mut seen = std::collections::HashSet::new();
            let out: Obj = others(|o| {
                ids.iter()
                    .map(|p| {
                        let (list, new) = o.games_of(p, &have);
                        for g in new {
                            if seen.insert(g["k"].as_str().unwrap_or("").to_string()) {
                                games.push(g);
                            }
                        }
                        (p.clone(), json!({ "ids": list, "mastery": mast.get(p) }))
                    })
                    .collect()
            });
            json!({ "players": out, "games": games, "progress": scout_snapshot() })
        }
        "mh-clear" => {
            with(|c| {
                c.mh.clear();
                c.failed_games.clear();
            });
            emit("matches-changed", Value::Null);
            json!({ "ok": true })
        }
        // ranks of the players in the shown games: cached ones right away, missing ones fetched
        "player-ranks" => {
            // [{ region, ids }]: the players of games on each server. The running client can only
            // tell ranks of its own server – asking it about others gives empty answers.
            let is_puuid =
                |p: &&str| p.len() == 36 && p.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
            let (up, reg) = with(|c| {
                let reg = c
                    .live
                    .puuid
                    .as_deref()
                    .and_then(|p| c.st.account(p))
                    .map(|a| str_of(a, "region").to_uppercase())
                    .unwrap_or_default();
                (c.live.client_up, reg)
            });
            let mut all: Vec<String> = vec![];
            let mut here: Vec<String> = vec![];
            for g in a(0).as_array().into_iter().flatten() {
                let greg = g["region"].as_str().unwrap_or("").to_uppercase();
                let ids: Vec<String> = g["ids"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(is_puuid)
                    .take(500)
                    .map(String::from)
                    .collect();
                if !reg.is_empty() && (greg.is_empty() || greg == reg) {
                    here.extend(ids.iter().cloned());
                }
                all.extend(ids);
            }
            let todo = with(|c| {
                if up && !reg.is_empty() && !c.fetching_ranks {
                    c.mh.stale_ranks(&here, now_ms(), &reg)
                } else {
                    vec![]
                }
            });
            let mut pending = 0;
            if !todo.is_empty() {
                with(|c| c.fetching_ranks = true);
                for part in todo.chunks(4).take(8) {
                    let res = futures_util::future::join_all(
                        part.iter().map(|p| riot::ranked_for(p, false)),
                    )
                    .await;
                    with(|c| {
                        for (p, r) in part.iter().zip(res) {
                            if let Some(r) = r {
                                c.mh.set_rank(p, &r, now_ms(), &reg);
                            }
                        }
                    });
                }
                pending = with(|c| {
                    c.mh.ranks_done(now_ms());
                    c.fetching_ranks = false;
                    c.mh.stale_ranks(&here, now_ms(), &reg).len()
                });
            }
            with(|c| json!({ "ranks": c.mh.ranks_for(&all), "pending": pending }))
        }
        "update" => {
            if s(0) == "install" {
                if updater::install_now() {
                    quit();
                }
            } else {
                let cb: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(push);
                tauri::async_runtime::spawn(updater::check(cb));
            }
            Value::Null
        }
        "win" => {
            match s(0).as_str() {
                "min" => {
                    if let Some(w) = window() {
                        let _ = w.minimize();
                    }
                }
                "tray" => {
                    let first = with(|c| {
                        let seen = c.st.set_bool("trayHintShown");
                        if !seen {
                            c.st.settings.insert("trayHintShown".into(), json!(true));
                        }
                        !seen
                    });
                    if first && !test_mode() {
                        save();
                        return json!({ "hint": true }); // the window shows the hint, then asks again
                    }
                    to_tray();
                }
                "quit" | "close" => quit(),
                _ => {}
            }
            Value::Null
        }
        "open-external" => {
            let u = s(0);
            if ops::allowed_url(&u) {
                open_path(&u);
            }
            Value::Null
        }
        "set-setting" => {
            let k = s(0);
            if let Some(v) = settings::clean_setting(&k, &a(1)) {
                with(|c| c.st.settings.insert(k.clone(), v));
                if k == "uiScale" {
                    apply_scale();
                }
                if k == "autostart" {
                    apply_autostart();
                }
                save();
            }
            Value::Null
        }
        "data-export" => do_export(a(0), a(1)).await,
        // the match notification needs Windows notifications on (the settings say so if they aren't)
        "toasts-enabled" => json!(winsys::toasts_enabled()),
        "diagnostics" => do_diagnostics().await,
        "data-import" => do_import(a(0)).await,
        "check-import-pass" => {
            let Some(d) = with(|c| c.import_file.clone()).and_then(|f| read_import(&f)) else {
                return json!(false);
            };
            let p = s(0);
            json!(
                tokio::task::spawn_blocking(move || secrets::open(&d["secrets"], &p).is_some())
                    .await
                    .unwrap_or(false)
            )
        }
        _ => Value::Null,
    }
}

fn lock_now() {
    let locked = with(|c| {
        if c.st.lock.is_none() {
            return false;
        }
        c.locked = true;
        c.last_pushed = 0;
        true
    });
    if locked {
        push();
        update_tray();
    }
}

// ---------- window ----------

fn apply_scale() {
    let z = with(|c| {
        c.st.settings
            .get("uiScale")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(100.0)
    });
    if let Some(w) = window() {
        let _ = w.set_zoom(z / 100.0);
    }
}
fn apply_autostart() {
    if test_mode() {
        return; // test copies never touch Windows settings
    }
    let on = with(|c| c.st.set_bool("autostart"));
    if let Ok(exe) = std::env::current_exe() {
        winsys::set_autostart(on, &exe);
    }
}

/// The window only exists while it's on screen: in the tray it is closed completely, which
/// ends the whole WebView (its processes and memory). Opening it again rebuilds it.
fn show_window() {
    if let Some(w) = window() {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    with(|c| {
        if c.st.lock.is_some() {
            c.locked = true;
        }
        c.last_pushed = 0;
    });
    riot::set_tray(false);
    create_window();
}
/// WebView2 switches: flat tiles need no GPU process, no extensions, no Edge background traffic
/// (measured: one process less, about half the CPU) (RS_WV_ARGS replaces them in test copies).
fn browser_args() -> String {
    let def = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-gpu --disable-gpu-compositing --in-process-gpu --disable-extensions --disable-component-update --disable-background-networking";
    if test_mode() {
        std::env::var("RS_WV_ARGS").unwrap_or_else(|_| def.into())
    } else {
        def.into()
    }
}
fn create_window() {
    let shot = shot_mode();
    let width = std::env::var("RS_W")
        .ok()
        .and_then(|w| w.parse().ok())
        .unwrap_or(1040.0);
    let mut b = WebviewWindowBuilder::new(app(), "main", WebviewUrl::App("index.html".into()))
        .title(tr("app.name", &[]))
        .inner_size(width, 640.0)
        .min_inner_size(720.0, 460.0)
        .decorations(false)
        .background_color(tauri::window::Color(11, 14, 20, 255))
        .disable_drag_drop_handler() // tiles are dragged inside the page
        .additional_browser_args(&browser_args())
        .visible(!shot)
        .focused(!shot);
    if test_mode() {
        b = b.data_directory(data().join("webview"));
    }
    if shot {
        b = b.position(-4000.0, 0.0);
    }
    match b.build() {
        Ok(w) => {
            if shot {
                let _ = w.show();
                run_shot(w);
            }
        }
        Err(e) => log_error("window", &e.to_string()),
    }
    apply_scale();
    tauri::async_runtime::spawn(async {
        sleep(50).await;
        KICK.notify_one();
    });
}
fn to_tray() {
    // closed from inside its own call: a moment later
    tauri::async_runtime::spawn(async {
        sleep(30).await;
        if let Some(w) = window() {
            let _ = w.destroy();
        }
        // what only the window needs goes with it
        live_memory_free();
        riot::set_tray(true);
        with(|c| c.last_pushed = 0);
    });
}
fn quit() {
    clear_copied(None);
    with(|c| c.quitting = true);
    app().exit(0);
}
fn switch_from_outside(argv: &[String]) {
    let id = with(|c| {
        if c.locked {
            None
        } else {
            menu::switch_arg(argv, &c.st)
        }
    });
    switch_in_window(id);
}
/// Opens the window and lets it ask "switch to …?" (the window shows its usual confirmation).
fn switch_in_window(id: Option<String>) {
    let existed = window().is_some();
    show_window();
    if let Some(id) = id {
        if existed {
            emit("tray-switch", json!(id));
        } else {
            with(|c| c.after_load_switch = Some(id));
        }
    }
}

/// Test helper: RS_SHOT=<file> runs RS_JS (';;'-separated steps), then writes <file>.ready with
/// the window handle (a script takes the picture) and quits.
fn run_shot(w: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        sleep(5000).await;
        for js in std::env::var("RS_JS")
            .unwrap_or_default()
            .split(";;")
            .filter(|s| !s.trim().is_empty())
        {
            let _ = w.eval(js);
            sleep(1500).await;
        }
        let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        let f = std::env::var("RS_SHOT").unwrap_or_default();
        let _ = std::fs::write(format!("{f}.ready"), hwnd.to_string());
        sleep(6000).await;
        quit();
    });
}

// ---------- tray + jump list ----------

fn update_tray() {
    let (items, accept, streamer, tip, jump) = with(|c| {
        let items = menu::account_items(&c.st, c.locked);
        let lang = c.st.lang();
        let name = menu::tr(&lang, "app.name", &[]);
        let tip = match c.st.active.as_deref().and_then(|a| c.st.account(a)) {
            Some(a) => format!("{name} – {}", menu::display_name(a, &c.st)),
            None => name,
        };
        let (accept, streamer) = (c.st.set_bool("autoAccept"), c.st.set_bool("streamer"));
        let key = format!("{items:?}{accept}{streamer}{tip}{lang}");
        let changed = key != c.tray_key;
        c.tray_key = key;
        let jump = menu::jump_tasks(&c.st, c.locked);
        let jk = format!("{jump:?}");
        let jump_changed = jk != c.jump_key;
        c.jump_key = jk;
        (
            changed.then_some(items),
            accept,
            streamer,
            tip,
            jump_changed.then_some(jump),
        )
    });
    if let Some(items) = items {
        if let Err(e) = build_tray_menu(items, accept, streamer, &tip) {
            log_error("tray", &e.to_string());
        }
    }
    if let Some(jump) = jump {
        if !test_mode() {
            if let Ok(exe) = std::env::current_exe() {
                std::thread::spawn(move || winsys::set_jump_list(&exe, &jump));
            }
        }
    }
}

fn build_tray_menu(
    items: Vec<menu::Item>,
    accept: bool,
    streamer: bool,
    tip: &str,
) -> tauri::Result<()> {
    let app = app();
    let mut parts: Vec<Box<dyn IsMenuItem<Wry>>> = vec![];
    for it in items {
        match it {
            menu::Item::Account {
                puuid,
                label,
                checked,
            } => parts.push(Box::new(CheckMenuItem::with_id(
                app,
                format!("acc:{puuid}"),
                label,
                true,
                checked,
                None::<&str>,
            )?)),
            menu::Item::Header(l) | menu::Item::Locked(l) => {
                parts.push(Box::new(MenuItem::new(app, l, false, None::<&str>)?))
            }
            menu::Item::Separator => parts.push(Box::new(PredefinedMenuItem::separator(app)?)),
        }
    }
    parts.push(Box::new(CheckMenuItem::with_id(
        app,
        "accept",
        tr("tray.accept", &[]),
        true,
        accept,
        None::<&str>,
    )?));
    parts.push(Box::new(CheckMenuItem::with_id(
        app,
        "streamer",
        tr("tray.streamer", &[]),
        true,
        streamer,
        None::<&str>,
    )?));
    parts.push(Box::new(PredefinedMenuItem::separator(app)?));
    parts.push(Box::new(MenuItem::with_id(
        app,
        "support",
        tr("tray.support", &[]),
        true,
        None::<&str>,
    )?));
    parts.push(Box::new(PredefinedMenuItem::separator(app)?));
    parts.push(Box::new(MenuItem::with_id(
        app,
        "open",
        tr("tray.open", &[]),
        true,
        None::<&str>,
    )?));
    parts.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        tr("tray.quit", &[]),
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = parts.iter().map(|b| b.as_ref()).collect();
    let m = Menu::with_items(app, &refs)?;
    // a copy of the handle: set_menu waits for the main thread, which may itself want TRAY (menu click)
    let tray = TRAY.lock().unwrap().clone();
    if let Some(t) = tray {
        t.set_menu(Some(m))?;
        t.set_tooltip(Some(tip))?;
    }
    if let Some(w) = window() {
        let _ = w.set_title(&tr("app.name", &[]));
    }
    Ok(())
}

fn on_menu(id: &str) {
    if let Some(p) = id.strip_prefix("acc:") {
        // the radio tick would flip by itself: the menu is rebuilt from the real state
        with(|c| c.tray_key.clear());
        update_tray();
        let p = p.to_string();
        let ok = with(|c| !c.locked && c.st.has(&p));
        switch_in_window(ok.then_some(p));
        return;
    }
    match id {
        "accept" | "streamer" => {
            let k = if id == "accept" {
                "autoAccept"
            } else {
                "streamer"
            };
            with(|c| {
                let v = !c.st.set_bool(k);
                c.st.settings.insert(k.into(), json!(v));
                c.tray_key.clear();
            });
            save();
        }
        "support" => {
            open_path(SUPPORT_URL);
        }
        "open" => show_window(),
        "quit" => quit(),
        _ => {}
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(tr("app.name", &[]))
        .show_menu_on_left_click(false)
        .on_menu_event(|_app, ev| on_menu(ev.id().as_ref()))
        .on_tray_icon_event(|_t, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                show_window();
            }
        })
        .build(app)?;
    *TRAY.lock().unwrap() = Some(tray);
    Ok(())
}

// ---------- League events, auto-accept, polling ----------

/// "Match found": a Windows notification (setting, off by default), once per ready check.
fn match_found() {
    use std::sync::atomic::{AtomicI64, Ordering};
    static LAST: AtomicI64 = AtomicI64::new(0);
    let (on, accept) = with(|c| (c.st.set_bool("matchNotify"), c.st.set_bool("autoAccept")));
    let now = now_ms();
    if !on || now - LAST.load(Ordering::SeqCst) < 15_000 {
        return;
    }
    LAST.store(now, Ordering::SeqCst);
    let body = tr(
        if accept {
            "tray.matchAuto"
        } else {
            "tray.matchAccept"
        },
        &[],
    );
    let _ = winsys::toast(APP_ID, &tr("tray.matchFound", &[]), &body);
}

async fn try_accept() {
    if !with(|c| c.st.set_bool("autoAccept") && !std::mem::replace(&mut c.accepting, true)) {
        return;
    }
    if riot::accept_ready_check().await && win_shown() {
        emit("toast", json!("tray.accepted"));
    }
    with(|c| c.accepting = false);
}
fn soon_tick(ms: u64) {
    {
        let mut s = SOON.lock().unwrap();
        if *s {
            return;
        }
        *s = true;
    }
    tauri::async_runtime::spawn(async move {
        sleep(ms).await;
        *SOON.lock().unwrap() = false;
        KICK.notify_one();
    });
}
fn on_lcu_event(ev: events::Event) {
    match ev.uri.as_str() {
        "/lol-gameflow/v1/gameflow-phase" => {
            if let Some(p) = ev.data.as_str() {
                let changed = with(|c| {
                    if c.live.phase.as_deref() == Some(p) {
                        return false;
                    }
                    let was = c.live.phase.clone();
                    c.live.phase = Some(p.to_string());
                    // a game just ended: the own match list at once, so the game is stored before
                    // the next one (Live's "do I know them?" needs it)
                    if after_game(was.as_deref(), p) {
                        c.last_profile_at = 0;
                    }
                    true
                });
                if changed {
                    if matches!(p, "EndOfGame" | "Lobby" | "None") {
                        // the client lists a game only once its stats are in: read once more later
                        tauri::async_runtime::spawn(async {
                            sleep(25_000).await;
                            with(|c| c.last_profile_at = 0);
                            KICK.notify_one();
                        });
                    }
                    push();
                    if p == "ReadyCheck" {
                        match_found();
                        tauri::async_runtime::spawn(try_accept());
                    }
                }
            }
            soon_tick(300);
        }
        "/lol-matchmaking/v1/ready-check" => {
            if ev.data["state"] == "InProgress" && ev.data["playerResponse"] == "None" {
                tauri::async_runtime::spawn(try_accept());
            }
        }
        "/lol-end-of-game/v1/eog-stats-block" => {
            with(|c| c.last_profile_at = 0); // a game just ended: fresh ranks, history and LP right away
                                             // Live shows the game from these numbers at once (long before the match history has it)
            tauri::async_runtime::spawn(live::eog_event(ev.data.clone(), data().to_path_buf()));
            soon_tick(3000);
        }
        _ => soon_tick(800),
    }
}

/// Polling pace: every 4 s while the window is open or something waits on League; 15 s in the
/// tray (60 s once the client's events are connected – they wake it up when something happens).
async fn tick_loop() {
    loop {
        tick().await;
        let (waiting, queue) = with(|c| {
            // a switch that never led to a login is forgotten after 3 minutes
            if c.expecting.is_some() && now_ms() - c.expecting_since > 180_000 {
                c.expecting = None;
            }
            let login_waits = !c.login.is_null() && c.login["stage"] != "failed";
            let wait =
                c.pending_add || login_waits || c.expecting.is_some() || !c.live.waits.is_empty();
            let queue = c.st.set_bool("autoAccept")
                && matches!(
                    c.live.phase.as_deref(),
                    Some("Lobby" | "Matchmaking" | "ReadyCheck")
                );
            (wait, queue)
        });
        let ev = events::connected();
        let ms = ops::poll_ms(waiting, queue, win_shown(), ev);
        tokio::select! {
            _ = sleep(ms) => {}
            _ = KICK.notified() => {}
        }
    }
}
/// A queue pop only lasts ~10 s: without events, check every second while queueing.
async fn accept_loop() {
    loop {
        sleep(1000).await;
        let phase = with(|c| c.live.phase.clone());
        if events::connected() && phase.as_deref() != Some("ReadyCheck") {
            continue;
        }
        if matches!(phase.as_deref(), Some("Matchmaking" | "ReadyCheck")) {
            try_accept().await;
        }
    }
}

// ---------- start ----------

fn main() {
    let data_dir = std::env::var_os("RS_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("rift-switch")
        });
    let _ = std::fs::create_dir_all(&data_dir);
    let _ = DATA.set(data_dir.clone());
    // panic = "abort" ends the app at once: the hook writes where and why to error.log first, so a
    // crash shows up in the diagnostics file instead of vanishing
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let at = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let thread = std::thread::current();
        log_error(
            "panic",
            &ops::panic_line(thread.name().unwrap_or("?"), &at, &msg),
        );
        // a password copied within the last 30 s must not stay behind (COPIED is never held long)
        if let Ok(mut c) = COPIED.try_lock() {
            if let Some(seq) = c.take() {
                winsys::clear_clipboard_if(seq);
            }
        }
        default_hook(info);
    }));

    let (st, read_only) = match store::read_state(&data_dir.join("accounts.json")) {
        store::Loaded::Ok(st) => (st, false),
        store::Loaded::Damaged(st, e) => {
            log_error("load", &e);
            (st, false)
        }
        store::Loaded::Unreadable(e) => {
            log_error("load", &e);
            (store::normalize(Value::Null), true)
        }
    };
    if !test_mode() {
        winsys::set_app_id(APP_ID);
    }
    // test helper: RS_TOAST shows the "match found" notification once (is it really shown?)
    if test_mode() && std::env::var_os("RS_TOAST").is_some() {
        let r = winsys::toast(APP_ID, "Match found!", "Rift Switch – notification test");
        let _ = std::fs::write(
            data_dir.join("toast-test.txt"),
            r.join().unwrap_or_default(),
        );
    }
    updater::set_dir(data_dir.join("updates"));
    let _ = CORE.set(Mutex::new(Core::new(
        st,
        matches::Matches::load(&data_dir),
        read_only,
    )));

    let mut builder = tauri::Builder::default();
    if !test_mode() {
        // only one copy may work on the data folder; a second start hands over its arguments
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            switch_from_outside(&argv)
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![call])
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            if let Ok(res) = app.path().resource_dir() {
                riot::set_scripts_dir(res.join("scripts"));
            }
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let _ = EVENTS.set(tx);
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    on_lcu_event(ev);
                }
            });
            let argv: Vec<String> = std::env::args().collect();
            // started with Windows and "stay in the tray" on (or an old --hidden entry): no window
            // at all until the tray icon is clicked
            let quiet = argv.iter().any(|a| a == "--hidden")
                || (argv.iter().any(|a| a == "--autostart")
                    && with(|c| c.st.set_bool("startMinimized")));
            if shot_mode() || !quiet {
                create_window();
            }
            if !shot_mode() {
                if let Err(e) = create_tray(app.handle()) {
                    log_error("tray", &e.to_string());
                }
            }
            apply_autostart();
            migrate_secrets();
            clean_debug_pictures();
            check_crypto();
            recover_orphans();
            check_creds();
            save();
            update_tray();
            // test copies: RS_TRAY_AFTER=<s> sends the window to the tray after that time
            if let Some(secs) = std::env::var("RS_TRAY_AFTER")
                .ok()
                .filter(|_| test_mode())
                .and_then(|v| v.parse::<u64>().ok())
            {
                tauri::async_runtime::spawn(async move {
                    sleep(secs * 1000).await;
                    to_tray();
                });
            }
            tauri::async_runtime::spawn(tick_loop());
            tauri::async_runtime::spawn(scout_loop());
            tauri::async_runtime::spawn(auto_load_loop());
            // counterstats.net is no longer read (Riot's policies): its old cache goes
            let _ = std::fs::remove_file(data().join("counters.json"));
            tauri::async_runtime::spawn(async {
                sleep(90_000).await;
                if now_ms() - lanes::built_at(data()) > lanes::STALE_MS {
                    lanes_rebuild();
                }
            });
            tauri::async_runtime::spawn(accept_loop());
            updater::init(push, || with(|c| c.st.set_bool("updateCheck")));
            if with(|c| menu::switch_arg(&argv, &c.st)).is_some() {
                switch_from_outside(&argv);
            }
            Ok(())
        })
        .on_window_event(|w, ev| {
            // Alt+F4 / closing from the taskbar ends the app; the tray button destroys the window instead
            if let tauri::WindowEvent::CloseRequested { .. } = ev {
                if w.label() == "main" {
                    quit();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Rift Switch");

    app.run(|_app, ev| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = ev {
            // the last window closed because it went to the tray: keep running there
            if code.is_none() && !with(|c| c.quitting) && !shot_mode() {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    //! The background part's own state handling, without a window: the encrypted login files,
    //! what the window gets to see, and a saved login turning into its real account.
    //! (One test: the app has one shared state.)
    use super::*;

    #[test]
    fn a_game_ending_reads_the_history() {
        assert!(super::after_game(Some("InProgress"), "EndOfGame"));
        assert!(super::after_game(Some("EndOfGame"), "Lobby"));
        assert!(super::after_game(Some("WaitingForStats"), "None"));
        assert!(!super::after_game(Some("Lobby"), "Matchmaking"));
        assert!(!super::after_game(None, "EndOfGame"));
        assert!(!super::after_game(Some("ChampSelect"), "Lobby"));
    }

    const P1: &str = "11111111-1111-1111-1111-111111111111";
    const P2: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn logins_snapshot_and_placeholders() {
        let dir = std::env::temp_dir().join(format!("rs-main-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _ = DATA.set(dir.clone());
        let st = store::normalize(json!({
            "accounts": [{ "puuid": P1, "gameName": "A", "history": [{ "t": 1 }, { "t": 2 }] },
                         { "puuid": format!("new-{P2}"), "placeholder": true, "gameName": "x•••", "note": "duo" }] }));
        let _ = CORE.set(Mutex::new(Core::new(
            st,
            matches::Matches::load(&dir),
            false,
        )));

        // a login file: plain DPAPI, then readable
        assert!(store_cred(P1, "user", "Müller€"));
        assert!(matches!(cred_state(P1), Cred::Ok(ref u, ref p) if u == "user" && p == "Müller€"));
        assert!(matches!(cred_state(P2), Cred::Missing));
        std::fs::write(cred_file(P2), b"garbage").unwrap();
        assert!(matches!(cred_state(P2), Cred::Broken));
        let _ = std::fs::remove_file(cred_file(P2));

        // sealed with the app password: unreadable without the key ("locked"), readable with it
        let ks = secrets::new_key_salt();
        let key = secrets::login_key("1234", &ks).unwrap();
        with(|c| {
            c.st.lock = Some(json!({ "salt": "", "hash": "", "ksalt": ks, "sealLogins": true }));
            c.login_key = Some(key);
        });
        let logins = all_creds();
        assert!(rewrite_creds(&logins));
        assert!(secrets::is_sealed(
            &secrets::decrypt_local(&dir, &std::fs::read(cred_file(P1)).unwrap()).unwrap()
        ));
        with(|c| c.login_key = None);
        assert!(matches!(cred_state(P1), Cred::Locked));
        check_creds();
        assert_eq!(
            with(|c| c.st.account(P1).unwrap()["credBroken"].clone()),
            json!(false),
            "locked is not broken"
        );
        assert!(!write_cred_file(P1, "{}"), "no writing without the key");
        with(|c| c.login_key = Some(key));
        assert_eq!(load_cred(P1), Some(("user".into(), "Müller€".into())));
        // unsealed again
        with(|c| c.st.lock = Some(json!({ "salt": "", "hash": "" })));
        assert!(rewrite_creds(&all_creds()));
        with(|c| c.login_key = None);
        assert_eq!(load_cred(P1), Some(("user".into(), "Müller€".into())));
        // all or nothing: re-sealing that can't happen (no key) leaves the old file as it was
        let before = std::fs::read(cred_file(P1)).unwrap();
        with(|c| c.st.lock = Some(json!({ "salt": "", "hash": "", "sealLogins": true })));
        assert!(!rewrite_creds(&[(
            P1.to_string(),
            "user".into(),
            "Müller€".into()
        )]));
        assert_eq!(std::fs::read(cred_file(P1)).unwrap(), before);
        assert!(!cred_file(P1).with_extension("bin.new").exists());
        with(|c| c.st.lock = Some(json!({ "salt": "", "hash": "" })));

        // what the window gets: no LP history list (only its length), no lock hash
        let snap = with(|c| snapshot(c));
        assert_eq!(snap["accounts"][0]["historyLen"], 2);
        assert!(snap["accounts"][0].get("history").is_none());
        assert!(snap.get("lock").is_none());
        assert_eq!(snap["hasLock"], true);
        // locked: nothing about the accounts
        with(|c| c.locked = true);
        let snap = with(|c| snapshot(c));
        assert_eq!(snap["accounts"], json!([]));
        assert_eq!(snap["locked"], true);
        with(|c| c.locked = false);

        // a saved login turns out to be an account: tile, login and note move over
        let old = format!("new-{P2}");
        assert!(store_cred(&old, "u2", "p2"));
        with(|c| {
            c.st.active = Some(old.clone());
            resolve_placeholder(c, &old, P2);
        });
        let (acc, active) = with(|c| (c.st.account(P2).cloned(), c.st.active.clone()));
        let acc = acc.expect("moved to its real id");
        assert!(acc.get("placeholder").is_none());
        assert_eq!(active.as_deref(), Some(P2));
        assert_eq!(load_cred(P2), Some(("u2".into(), "p2".into())));
        assert!(!cred_file(&old).exists());
        // ... and into an account that is already a tile: the tile stays, gets the login and the note
        let old2 = format!(
            "new-{}",
            "3".repeat(36)
                .chars()
                .enumerate()
                .map(|(i, c)| if [8, 13, 18, 23].contains(&i) { '-' } else { c })
                .collect::<String>()
        );
        with(|c| {
            c.st.accounts.push(
                json!({ "puuid": old2, "placeholder": true, "note": "main", "hasCred": true })
                    .as_object()
                    .unwrap()
                    .clone(),
            )
        });
        with(|c| {
            c.st.account_mut(P1)
                .unwrap()
                .insert("hasCred".into(), json!(false))
        });
        let _ = std::fs::remove_file(cred_file(P1));
        assert!(store_cred(&old2, "u3", "p3"));
        with(|c| {
            c.st.account_mut(P1)
                .unwrap()
                .insert("hasCred".into(), json!(false))
        });
        with(|c| resolve_placeholder(c, &old2, P1));
        assert_eq!(with(|c| c.st.accounts.len()), 2, "no second tile");
        assert_eq!(with(|c| c.st.account(P1).unwrap()["note"].clone()), "main");
        assert_eq!(load_cred(P1), Some(("u3".into(), "p3".into())));

        // the canary file
        check_crypto();
        assert!(!with(|c| c.crypto_broken));
        // only the canary damaged, the logins still readable: written again, nothing reported
        std::fs::write(dir.join("keycheck.bin"), b"not dpapi").unwrap();
        check_crypto();
        assert!(
            !with(|c| c.crypto_broken),
            "a damaged canary alone is no broken key"
        );
        assert_eq!(
            read_secret(&dir.join("keycheck.bin")).as_deref(),
            Some("rift-switch")
        );
        // nothing readable any more: reported – and still at the next start
        for d in ["sessions", "creds"] {
            for e in std::fs::read_dir(dir.join(d))
                .into_iter()
                .flatten()
                .flatten()
            {
                std::fs::write(e.path(), b"other key").unwrap();
            }
        }
        std::fs::write(dir.join("keycheck.bin"), b"not dpapi").unwrap();
        check_crypto();
        assert!(
            with(|c| c.crypto_broken),
            "a key this start can't read is reported"
        );
        check_crypto();
        assert!(with(|c| c.crypto_broken), "and stays reported");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn file_names_only_from_real_ids() {
        for bad in ["../../evil", "a\\b", "C:\\x", "", "new-..\\..\\x"] {
            assert_eq!(safe_id(bad), "invalid", "{bad}");
        }
        assert_eq!(safe_id(P1), P1);
    }
}
