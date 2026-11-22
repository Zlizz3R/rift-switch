//! Rift Switch – background part. Keeps the tiles fresh while League runs, switches accounts,
//! and serves the window. In the tray there is no window (no WebView) at all: only this small
//! native process, which asks League a few questions every 15–60 seconds.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod accounts;
mod events;
mod live;
mod matches;
mod menu;
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
}

struct Core {
    st: State,
    mh: matches::Matches,
    live: Live,
    pending_add: bool,
    pending_cred: Option<(String, String)>, // login typed in the "add" form, kept until League says whose it is
    login: Value,                           // auto-login progress shown in the overlay
    login_token: u64,
    busy: bool,
    expecting: Option<String>, // account we just switched to
    locked: bool,
    crypto_broken: bool,
    save_error: Option<String>,
    last_saved: String,
    last_pushed: String,
    last_rank_sweep: i64,
    last_profile_at: i64,
    gen: u64, // bumped by switch/add: results of a tick that started before are thrown away
    ticking: bool,
    play_token: u64,
    play_line: &'static str,
    loading_older: bool,
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
    let line = format!("{} {place}: {e}\n", now_ms());
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data().join("error.log"))
    {
        let _ = f.write_all(line.as_bytes());
    }
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
                a.insert("historyLen".into(), json!(n));
                Value::Object(a)
            })
            .collect();
    let mut o = c.st.to_json();
    let m = o.as_object_mut().unwrap();
    m.remove("lock");
    m.insert("accounts".into(), Value::Array(accounts));
    m.insert("hasLock".into(), json!(c.st.lock.is_some()));
    m.insert("live".into(), json!({ "puuid": c.live.puuid, "phase": c.live.phase, "clientUp": c.live.client_up, "waits": c.live.waits }));
    m.insert("pendingAdd".into(), json!(c.pending_add));
    m.insert("busy".into(), json!(c.busy));
    m.insert("login".into(), c.login.clone());
    m.insert("saveError".into(), json!(c.save_error));
    m.insert("cryptoBroken".into(), json!(c.crypto_broken));
    m.insert("version".into(), json!(version));
    m.insert("update".into(), updater::get());
    o
}

/// Sends the state to the window – only when it's open and something changed.
fn push() {
    if !win_shown() && !shot_mode() {
        return;
    }
    let s = with(|c| {
        let s = snapshot(c);
        let key = s.to_string();
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
    with(|c| c.login = l);
    push();
}

/// Writes accounts.json only when something really changed, and refreshes the tray then.
fn save() {
    let changed = with(|c| {
        if c.read_only {
            c.save_error = Some("accounts.json unreadable".into());
            return false;
        }
        let text = c.st.to_json().to_string();
        if text == c.last_saved {
            c.save_error = None;
            return false;
        }
        match store::write_atomic(&data().join("accounts.json"), text.as_bytes()) {
            Ok(()) => {
                c.last_saved = text;
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

fn session_file(id: &str) -> PathBuf {
    data().join("sessions").join(format!("{id}.bin"))
}
fn cred_file(id: &str) -> PathBuf {
    data().join("creds").join(format!("{id}.bin"))
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
fn check_crypto() {
    let f = data().join("keycheck.bin");
    let exists = f.exists();
    let broken = exists && read_secret(&f).as_deref() != Some("rift-switch");
    if broken {
        log_error(
            "crypto",
            "saved data was encrypted with a key this start cannot read",
        );
    }
    with(|c| c.crypto_broken = broken);
    if !exists || broken {
        write_secret(&f, "rift-switch");
    }
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
fn store_cred(id: &str, u: &str, p: &str) {
    write_secret(&cred_file(id), &json!({ "u": u, "p": p }).to_string());
    with(|c| {
        if let Some(a) = c.st.account_mut(id) {
            a.insert("hasCred".into(), json!(true));
            a.insert("credBroken".into(), json!(false));
        }
    });
}
fn load_cred(id: &str) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(&read_secret(&cred_file(id))?).ok()?;
    Some((v["u"].as_str()?.to_string(), v["p"].as_str()?.to_string()))
}
fn check_creds() {
    let ids: Vec<String> = with(|c| {
        c.st.accounts
            .iter()
            .map(|a| str_of(a, "puuid").to_string())
            .collect()
    });
    for id in ids {
        let has = cred_file(&id).exists();
        let broken = has && load_cred(&id).is_none();
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
    with(|c| {
        upsert_into(&mut c.st.accounts, acc, now_ms());
    });
}

// ---------- watcher: keeps tiles fresh while League is open ----------

fn stale_in(c: &Core, my_gen: u64) -> bool {
    c.busy || c.gen != my_gen
}

async fn tick() {
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

/// An account's known penalties (from its own last login): kept until they ran out.
fn set_penalties(a: &mut Obj, list: Vec<Value>, now: i64) {
    let list: Vec<Value> = list
        .into_iter()
        .filter(|p| p["until"].as_i64().is_none_or(|u| u == 0 || u > now))
        .collect();
    if list.is_empty() {
        a.remove("penalties");
    } else {
        a.insert("penalties".into(), json!({ "at": now, "list": list }));
    }
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

async fn tick_inner(my_gen: u64) {
    let stale = || with(|c| c.busy || c.gen != my_gen);
    if let Some(tx) = EVENTS.get() {
        events::connect(riot::lockfile(), tx.clone());
    }
    // While a game runs, the League client is asked one single thing (the phase) – nothing that
    // could cost a frame. Ranks, history and the other accounts follow when the game is over.
    let first = riot::gameflow_phase().await;
    if let Some(p) = first.as_deref().filter(|p| IN_GAME.contains(p)) {
        let changed = with(|c| {
            if c.live.puuid.is_none() || stale_in(c, my_gen) {
                return None;
            }
            let ch = c.live.phase.as_deref() != Some(p);
            c.live.phase = Some(p.to_string());
            c.live.client_up = true;
            Some(ch)
        });
        if let Some(ch) = changed {
            if ch {
                push();
            }
            return;
        }
    }
    let cur = if first.is_some() {
        riot::current_account().await
    } else {
        None
    };
    let phase = if cur.is_some() {
        riot::gameflow_phase().await
    } else {
        None
    };
    if stale() {
        return;
    }
    let cur_id = cur.as_ref().map(|c| str_of(c, "puuid").to_string());
    let (new_puuid, changed) = with(|c| {
        let np = cur_id != c.live.puuid;
        let ch = np || phase != c.live.phase;
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
    let now = now_ms();
    // first login of an account that was only saved so far
    with(|c| {
        if let Some(e) = c.expecting.clone() {
            if is_placeholder(&e) && c.st.has(&e) {
                resolve_placeholder(c, &e, &id);
            }
        }
        c.expecting = None;
    });
    let (known, pending_add) = with(|c| (c.st.has(&id), c.pending_add));
    if known || pending_add {
        upsert(cur.clone());
        with(|c| c.st.active = Some(id.clone()));
        if new_puuid {
            with(|c| c.no_persist = None);
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
            store_cred(&id, &u, &p);
        }
        // profile details of the signed-in account, every 5 minutes
        if new_puuid || with(|c| now - c.last_profile_at > 300_000) {
            with(|c| c.last_profile_at = now);
            let (p, hs, elig) = tokio::join!(
                riot::profile_data(&cur),
                riot::history_summary(&id),
                riot::ranked_eligibility()
            );
            if stale() {
                return;
            }
            with(|c| {
                if let Some(a) = c.st.account_mut(&id) {
                    let mut prof = a
                        .get("profile")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    prof.extend(p);
                    a.insert("profile".into(), Value::Object(prof));
                    if let Some((check, pens)) = elig {
                        a.insert("rankedCheck".into(), check);
                        set_penalties(a, pens, now);
                    }
                }
            });
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
        let waits = riot::queue_wait_now().await;
        let changed = with(|c| {
            let ch = c.live.waits != waits;
            if ch {
                c.live.waits = waits.clone();
                if let Some(a) = c.st.account_mut(&id) {
                    let mut list: Vec<Value> = a
                        .get("penalties")
                        .and_then(|p| p["list"].as_array().cloned())
                        .unwrap_or_default();
                    list.retain(|p| !waits.iter().any(|w| w["code"] == p["code"]));
                    list.extend(waits.iter().cloned());
                    set_penalties(a, list, now);
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
        for a in list {
            if stale() {
                return;
            }
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
            if let Some(hs) = riot::history_summary(&aid).await {
                merge_history(&aid, &hs, false);
            }
        }
        save();
    }
    if !stale() && !with(|c| c.mh.missing().is_empty()) {
        let got = fill_games(if win_shown() { 8 } else { 3 }).await;
        if got > 0 && win_shown() {
            emit("matches-changed", Value::Null);
        }
    }
}

/// Fetches up to `max` missing game details from the client. Games the client can't give
/// (twice) are skipped for the rest of this run.
async fn fill_games(max: usize) -> usize {
    let ids: Vec<String> = with(|c| {
        let failed = &c.failed_games;
        c.mh.missing()
            .into_iter()
            .filter(|id| failed.get(id).copied().unwrap_or(0) < 2)
            .take(max)
            .collect()
    });
    let mut got = 0;
    for id in ids {
        let g = riot::lcu(&format!("/lol-match-history/v1/games/{id}"), 6000, "GET").await;
        match g.as_ref().and_then(matches::compact) {
            Some(g) => {
                if with(|c| c.mh.insert(&g)) {
                    got += 1;
                }
            }
            None => with(|c| *c.failed_games.entry(id).or_insert(0) += 1),
        }
    }
    got
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
    while alive() && now_ms() - t0 < 120_000 {
        let st = riot::rc_login_state().await;
        if !alive() {
            return;
        }
        if st.subject.is_some() {
            set_login(Value::Null);
            return;
        }
        if st.up {
            let since_out = *signed_out_since.get_or_insert(now_ms());
            if typed_at.is_none() && now_ms() - since_out >= settle_ms {
                set_login(json!({ "name": name, "stage": "typing" }));
                let r = riot::autofill(&u, &p, since).await;
                if !alive() {
                    return;
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
    while alive() && now_ms() - t0 < 180_000 {
        let st = riot::rc_login_state().await;
        if let Some(subject) = st.subject {
            signed_in_since.get_or_insert(now_ms());
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
                        riot::press_play("pbe").await;
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
                return;
            }
            if !with(|c| c.st.set_bool("autoPlay")) {
                if checked {
                    return;
                }
            } else if presses == 0 || now_ms() - signed_in_since.unwrap_or(0) > 12_000 {
                // give the client a moment to start League by itself; retry once
                if presses >= 2 {
                    return;
                }
                riot::press_play(with(|c| c.play_line)).await;
                presses += 1;
                signed_in_since = Some(now_ms());
            }
        } else {
            signed_in_since = None;
        }
        sleep(if presses > 0 { 1500 } else { 600 }).await;
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
            with(|c| {
                c.gen += 1;
                c.st.active = Some(id.clone());
            });
            save();
            let rca = riot::rc_account().await;
            riot::press_play(if rca.is_some_and(|r| r.region == "PBE") || pl == "pbe" {
                "pbe"
            } else {
                "live"
            })
            .await;
            return json!({ "ok": true, "fast": "play" });
        }
        if rc.subject.is_none() {
            if let Some(cr) = &cred {
                // login screen already open and we have the password: type it straight in
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
    if !save_active_before_leaving().await {
        return err_key("m.closeFailed");
    }
    match &session {
        Some(s) => riot::restore_session(s),
        None => riot::clear_session(),
    }
    with(|c| {
        c.st.active = Some(id.clone());
        c.expecting = Some(id.clone());
        c.expecting_since = now_ms();
        c.live = Live::default();
    });
    save();
    let started = now_ms();
    riot::launch_league(pl);
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
    riot::launch_league("live");
    if let Some((u, p)) = cred {
        tauri::async_runtime::spawn(auto_login(u.clone(), p, u, 1500, Some(started)));
    }
    tauri::async_runtime::spawn(auto_play("live"));
    json!({ "ok": true })
}

/// Save a login for later – nothing is closed or logged in now.
async fn do_add_saved(c_in: Value) -> Value {
    with(|c| c.gen += 1);
    let Some((u, p)) = valid_cred(&c_in) else {
        return err_key("m.fill");
    };
    let rid = c_in["riotId"].as_str().unwrap_or("").trim().to_string();
    let (mut gn, mut tl) = (String::new(), String::new());
    if !rid.is_empty() {
        let Some((g, t)) = parse_riot_id(&rid) else {
            return err_key("m.riotIdFormat");
        };
        gn = g;
        tl = t;
    }
    let hit = if gn.is_empty() {
        None
    } else {
        riot::lookup_riot_id(&gn, &tl).await
    };
    let id = match &hit {
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
                mask_login(&u)
            } else {
                gn.clone()
            };
            upsert(obj(
                json!({ "puuid": id, "placeholder": true, "gameName": name, "tagLine": tl }),
            ));
            id
        }
    };
    store_cred(&id, &u, &p);
    save();
    json!({ "ok": true, "found": hit.is_some(), "riotId": !gn.is_empty() })
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
    store_cred(&id, &u, &p);
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
            riot::launch_league(pl);
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
fn allowed_url(u: &str) -> bool {
    [
        "op.gg/",
        "u.gg/",
        "leagueofgraphs.com/",
        "porofessor.gg/",
        "mobalytics.gg/",
        "buymeacoffee.com/",
    ]
    .iter()
    .any(|d| u.starts_with(&format!("https://{d}")) || u.starts_with(&format!("https://www.{d}")))
}

// ---------- export / import ----------

async fn pick_file(save: bool) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut d = app().dialog().file().add_filter("JSON", &["json"]);
    if let Some(w) = window() {
        d = d.set_parent(&w);
    }
    if save {
        d.set_file_name("rift-switch-backup.json")
            .save_file(move |p| {
                let _ = tx.send(p);
            });
    } else {
        d.pick_file(move |p| {
            let _ = tx.send(p);
        });
    }
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}

async fn do_export(pass: Value) -> Value {
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
    for (id, u, p) in &restore {
        store_cred(id, u, p);
    }
    save();
    json!({ "ok": true, "added": added, "updated": updated, "logins": restore.len() })
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
                c.last_pushed.clear();
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
                secrets::lock_matches(lock.as_ref(), Some(&pass))
            })
            .await
            .unwrap_or(false);
            with(|c| {
                if ok {
                    c.unlock_fails = 0;
                    c.locked = false;
                    c.last_pushed.clear();
                } else {
                    c.unlock_fails += 1;
                }
            });
            if ok {
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
                    let made = tokio::task::spawn_blocking(move || {
                        if lock.is_some() && !secrets::lock_matches(lock.as_ref(), old.as_str()) {
                            None
                        } else {
                            Some(secrets::make_lock(&p))
                        }
                    })
                    .await
                    .ok()
                    .flatten();
                    match made {
                        Some(l) => {
                            with(|c| c.st.lock = Some(l));
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
                        with(|c| c.st.lock = None);
                        save();
                    }
                    json!(ok)
                }
                _ => json!(false),
            }
        }
        "get-history" => with(|c| {
            c.st.account(&s(0))
                .and_then(|a| a.get("history").cloned())
                .unwrap_or(json!([]))
        }),
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
        "dismiss-login" => {
            with(|c| c.login_token += 1);
            set_login(Value::Null);
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
            let name: String = a(0)
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(32)
                .collect();
            let id = format!("c{}", &uuid4()[..8]);
            with(|c| {
                c.st.categories.push(obj(json!({ "id": id, "name": if name.is_empty() { def } else { name }, "collapsed": false })))
            });
            save();
            json!(id)
        }
        "cat-rename" => {
            let n: String = s(1).trim().chars().take(32).collect();
            let id = s(0);
            let ok = !n.is_empty()
                && with(|c| {
                    c.st.categories
                        .iter_mut()
                        .find(|x| str_of(x, "id") == id)
                        .map(|x| x.insert("name".into(), json!(n)))
                        .is_some()
                });
            if ok {
                save()
            } else {
                push()
            }
            Value::Null
        }
        "cat-toggle" => {
            let id = s(0);
            let hit = with(|c| {
                c.st.categories
                    .iter_mut()
                    .find(|x| str_of(x, "id") == id)
                    .map(|x| {
                        let v = !truthy(x.get("collapsed"));
                        x.insert("collapsed".into(), json!(v));
                    })
            });
            if hit.is_some() {
                save();
            }
            Value::Null
        }
        "cat-move" => {
            let (id, dir) = (s(0), num_of(args.get(1)));
            let moved = with(|c| {
                let Some(i) = c.st.categories.iter().position(|x| str_of(x, "id") == id) else {
                    return false;
                };
                let j = if dir < 0.0 {
                    i.checked_sub(1)
                } else {
                    Some(i + 1)
                };
                match j.filter(|j| *j < c.st.categories.len()) {
                    Some(j) => {
                        c.st.categories.swap(i, j);
                        true
                    }
                    None => false,
                }
            });
            if moved {
                save();
            }
            Value::Null
        }
        "cat-del" => {
            let id = s(0);
            with(|c| {
                c.st.categories.retain(|x| str_of(x, "id") != id);
                for a in &mut c.st.accounts {
                    if str_of(a, "category") == id {
                        a.remove("category");
                    }
                }
            });
            save();
            Value::Null
        }
        // new order (+ category with "arrange") of every tile: drag & drop, "move to"
        "arrange" | "reorder" => {
            let list = a(0);
            let Some(list) = list.as_array() else {
                return Value::Null;
            };
            let arrange = ch == "arrange";
            with(|c| {
                c.gen += 1;
                let mut next: Vec<Obj> = vec![];
                for item in list {
                    let (id, cat) = if arrange {
                        (
                            item["puuid"].as_str().unwrap_or(""),
                            item["category"].as_str(),
                        )
                    } else {
                        (item.as_str().unwrap_or(""), None)
                    };
                    if next.iter().any(|a| str_of(a, "puuid") == id) {
                        continue;
                    }
                    let Some(mut acc) = c.st.account(id).cloned() else {
                        continue;
                    };
                    if arrange {
                        match cat.filter(|k| {
                            !k.is_empty() && c.st.categories.iter().any(|x| str_of(x, "id") == *k)
                        }) {
                            Some(k) => {
                                acc.insert("category".into(), json!(k));
                            }
                            None => {
                                acc.remove("category");
                            }
                        }
                    }
                    next.push(acc);
                }
                for a in &c.st.accounts {
                    if !next
                        .iter()
                        .any(|x| str_of(x, "puuid") == str_of(a, "puuid"))
                    {
                        next.push(a.clone());
                    }
                }
                c.st.accounts = next;
            });
            save();
            Value::Null
        }
        "live" => live::snapshot().await,
        "champions" => live::champions(data()).await,
        "matchup" => live::matchup(&s(0), &s(1), &s(2)).await,
        "tool" => with_busy(do_tool(s(0))).await,
        "open-multi" => {
            // op.gg multisearch for up to 5 Riot IDs (Clash opponents)
            let list: Vec<String> = a(1)
                .as_array()
                .into_iter()
                .flatten()
                .take(5)
                .map(|x| {
                    x.as_str()
                        .unwrap_or("")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || " #_.-".contains(*c))
                        .collect()
                })
                .collect();
            if !list.is_empty() {
                let reg: String = s(0)
                    .to_lowercase()
                    .chars()
                    .filter(char::is_ascii_lowercase)
                    .collect();
                let reg = if reg.is_empty() {
                    "euw".to_string()
                } else {
                    reg
                };
                let q: String = list
                    .join(",")
                    .bytes()
                    .map(|b| {
                        if b.is_ascii_alphanumeric() {
                            (b as char).to_string()
                        } else {
                            format!("%{b:02X}")
                        }
                    })
                    .collect();
                open_path(&format!("https://op.gg/multisearch/{reg}?summoners={q}"));
            }
            Value::Null
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
            let queue = f["queue"]
                .as_str()
                .filter(|q| matches::QUEUE_GROUPS.iter().any(|(k, _)| k == q))
                .map(String::from);
            with(|c| {
                json!({ "index": c.mh.index_list(&accs, puuid.as_deref(), queue.as_deref()), "waiting": c.mh.missing().len(),
                "loadingOlder": c.loading_older, "clientUp": c.live.client_up })
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
            let (file, entries) = with(|c| (c.mh.games_file(), c.mh.entries(&ids)));
            json!(
                tokio::task::spawn_blocking(move || matches::read_entries(&file, &entries))
                    .await
                    .unwrap_or_default()
            )
        }
        "mh-assets" => live::game_assets(data()).await,
        "mh-storage" => with(|c| json!({ "bytes": c.mh.size(), "games": c.mh.count() })),
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
        // "Load older games": the next 20 games of every account the running client can see
        "matches-more" => {
            let ok = with(|c| {
                if c.loading_older || !c.live.client_up {
                    return false;
                }
                c.loading_older = true;
                true
            });
            if !ok {
                return json!({ "ok": false, "offline": !with(|c| c.live.client_up) });
            }
            let (accs, region) = with(|c| {
                let region = c
                    .live
                    .puuid
                    .clone()
                    .and_then(|p| c.st.account(&p).map(|a| str_of(a, "region").to_string()))
                    .unwrap_or_default();
                (c.st.accounts.clone(), region)
            });
            let mut added = 0;
            for acc in accs {
                let (id, r) = (str_of(&acc, "puuid"), str_of(&acc, "region"));
                if truthy(acc.get("placeholder"))
                    || (!region.is_empty() && !r.is_empty() && r != region)
                {
                    continue;
                }
                let beg = with(|c| c.mh.known(id));
                if let Some(list) = riot::match_list(id, beg, beg + 20).await {
                    added += with(|c| {
                        c.mh.note(id, &list);
                        c.mh.known(id) - beg
                    });
                }
            }
            // details: a few at a time so the client isn't flooded; the page refreshes as they come
            tauri::async_runtime::spawn(async {
                for _ in 0..40 {
                    if with(|c| c.mh.missing().is_empty() || !c.live.client_up) {
                        break;
                    }
                    if fill_games(4).await == 0 {
                        break;
                    }
                    emit("matches-changed", Value::Null);
                }
                with(|c| c.loading_older = false);
                emit("matches-changed", Value::Null);
            });
            json!({ "ok": true, "added": added })
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
            if allowed_url(&u) {
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
        "data-export" => do_export(a(0)).await,
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
        c.last_pushed.clear();
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
        c.last_pushed.clear();
    });
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
    });
}
fn quit() {
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
                    c.live.phase = Some(p.to_string());
                    true
                });
                if changed {
                    push();
                    if p == "ReadyCheck" {
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
        let ms = if waiting || queue || win_shown() {
            if ev && !waiting {
                10_000
            } else {
                4_000
            }
        } else if ev {
            60_000
        } else {
            15_000
        };
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
    updater::set_dir(data_dir.join("updates"));
    let locked = st.lock.is_some();
    let _ = CORE.set(Mutex::new(Core {
        st,
        mh: matches::Matches::load(&data_dir),
        live: Live::default(),
        pending_add: false,
        pending_cred: None,
        login: Value::Null,
        login_token: 0,
        busy: false,
        expecting: None,
        locked,
        crypto_broken: false,
        save_error: None,
        last_saved: String::new(),
        last_pushed: String::new(),
        last_rank_sweep: 0,
        last_profile_at: 0,
        gen: 0,
        ticking: false,
        play_token: 0,
        play_line: "live",
        loading_older: false,
        fetching_ranks: false,
        unlock_fails: 0,
        import_file: None,
        accepting: false,
        quitting: false,
        tray_key: String::new(),
        jump_key: String::new(),
        after_load_switch: None,
        failed_games: HashMap::new(),
        expecting_since: 0,
        read_only,
        no_persist: None,
    }));

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
            // started with --hidden (autostart): no window at all until the tray icon is clicked
            if shot_mode() || !argv.iter().any(|a| a == "--hidden") {
                create_window();
            }
            if !shot_mode() {
                if let Err(e) = create_tray(app.handle()) {
                    log_error("tray", &e.to_string());
                }
            }
            apply_autostart();
            migrate_secrets();
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
            tauri::async_runtime::spawn(accept_loop());
            updater::init(push);
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
