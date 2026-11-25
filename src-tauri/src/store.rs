//! accounts.json (reading with repairs + one-time migrations, atomic writing) and the
//! export / import file.

use crate::accounts::{clean_text, is_id, is_puuid, mask_login, str_of, truthy, valid_cred, Obj};
use crate::settings::{defaults, merge_settings};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct State {
    pub accounts: Vec<Obj>,
    pub categories: Vec<Obj>,
    pub active: Option<String>,
    pub settings: Obj,
    pub lock: Option<Value>,
    /// anything else in the file is kept as it was
    pub extra: Obj,
}

impl State {
    pub fn to_json(&self) -> Value {
        let mut o = Obj::new();
        o.insert(
            "accounts".into(),
            Value::Array(self.accounts.iter().cloned().map(Value::Object).collect()),
        );
        o.insert(
            "categories".into(),
            Value::Array(self.categories.iter().cloned().map(Value::Object).collect()),
        );
        o.insert(
            "active".into(),
            self.active.clone().map_or(Value::Null, Value::String),
        );
        o.insert("settings".into(), Value::Object(self.settings.clone()));
        if let Some(l) = &self.lock {
            o.insert("lock".into(), l.clone());
        }
        for (k, v) in &self.extra {
            o.entry(k.clone()).or_insert_with(|| v.clone());
        }
        Value::Object(o)
    }
    pub fn account(&self, id: &str) -> Option<&Obj> {
        self.accounts.iter().find(|a| str_of(a, "puuid") == id)
    }
    pub fn account_mut(&mut self, id: &str) -> Option<&mut Obj> {
        self.accounts.iter_mut().find(|a| str_of(a, "puuid") == id)
    }
    pub fn has(&self, id: &str) -> bool {
        self.account(id).is_some()
    }
    pub fn set_bool(&self, k: &str) -> bool {
        truthy(self.settings.get(k))
    }
    pub fn lang(&self) -> String {
        self.settings
            .get("lang")
            .and_then(Value::as_str)
            .unwrap_or("en")
            .to_string()
    }
}

/// Whatever was in the file -> a complete, current state.
pub fn normalize(raw: Value) -> State {
    let mut o = raw.as_object().cloned().unwrap_or_default();
    let objs = |v: Option<Value>| -> Vec<Obj> {
        v.and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|x| x.as_object().cloned())
            .collect()
    };
    let mut accounts = objs(o.remove("accounts"));
    // an id becomes a file name (sessions/<id>.bin): nothing that could leave that folder
    // (the file functions in main.rs only take real ids anyway)
    accounts.retain(|a| {
        a.get("puuid").and_then(Value::as_str).is_some_and(|id| {
            !id.is_empty() && id.len() <= 80 && !id.contains("..") && !id.contains(['/', '\\', ':'])
        })
    });
    for a in &mut accounts {
        for k in ["gameName", "tagLine"] {
            if let Some(Value::String(s)) = a.get(k) {
                let c = clean_text(s);
                a.insert(k.into(), json!(c));
            }
        }
    }
    let categories = objs(o.remove("categories"));
    let active = o
        .remove("active")
        .and_then(|v| v.as_str().map(String::from));
    let mut settings = defaults();
    let saved = o.remove("settings");
    // the very first start (nothing saved yet): Windows' display language, if the app has it
    if !saved.as_ref().is_some_and(|s| s.get("lang").is_some()) {
        settings.insert("lang".into(), json!(crate::settings::first_lang()));
    }
    // one-time: a lane picked before the helper followed the main role stays picked
    let old_lane = saved.as_ref().is_some_and(|s| {
        s.get("laneChosen").is_none() && s.get("lane").and_then(Value::as_str).is_some_and(|l| l != "top")
    });
    if old_lane {
        settings.insert("laneChosen".into(), json!(true));
    }
    if let Some(Value::Object(s)) = saved {
        for (k, v) in s {
            settings.insert(k, v);
        }
    }
    // one-time: sorting by level became the default (existing saves had "custom")
    if !truthy(settings.get("sortLevelDefault")) {
        settings.insert("sort".into(), json!("level"));
        settings.insert("sortLevelDefault".into(), json!(true));
    }
    // one-time: "Start League automatically" is on by default
    if !truthy(settings.get("autoPlayDefault")) {
        settings.insert("autoPlay".into(), json!(true));
        settings.insert("autoPlayDefault".into(), json!(true));
    }
    let lock = o.remove("lock").filter(|l| l.is_object());
    State {
        accounts,
        categories,
        active,
        settings,
        lock,
        extra: o,
    }
}

pub enum Loaded {
    /// read fine (or no file yet)
    Ok(State),
    /// the file is not valid JSON: it was copied aside, the app starts empty
    Damaged(State, String),
    /// the file could not be read at all (locked by a virus scanner …): the app must not save,
    /// or it would replace the real file with an empty one
    Unreadable(String),
}

const KEEP_DAYS: usize = 5;

/// "2026-11-23" for a time in ms (UTC), without a date library.
fn day_name(ms: i64) -> String {
    // days since 1970-01-01 -> civil date (Howard Hinnant's algorithm)
    let z = ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}
/// The daily copies in backups/, newest first.
fn daily_backups(file: &Path) -> Vec<std::path::PathBuf> {
    let dir = file.with_file_name("backups");
    let mut list: Vec<std::path::PathBuf> = fs::read_dir(&dir)
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("accounts-"))
                })
                .collect()
        })
        .unwrap_or_default();
    list.sort();
    list.reverse(); // the date in the name sorts them
    list
}
/// A good file: one copy per day in backups/ (the newest 5 days stay), next to file.bak.
fn keep_daily(file: &Path, now: i64) {
    let dir = file.with_file_name("backups");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = fs::copy(file, dir.join(format!("accounts-{}.json", day_name(now))));
    for old in daily_backups(file).into_iter().skip(KEEP_DAYS) {
        let _ = fs::remove_file(old);
    }
}

/// Reads the file (or file.bak, then the daily backups, if the real one is missing or broken).
/// A damaged file is copied aside first, never silently overwritten. A good file is kept as
/// file.bak once per start and once per day in backups/ (the last 5 days).
pub fn read_state(file: &Path) -> Loaded {
    let bak = file.with_extension("json.bak");
    let parse = |p: &Path| -> Result<Option<Value>, String> {
        if !p.exists() {
            return Ok(None);
        }
        // a locked file (virus scanner, backup tool) usually frees up within a moment
        let mut last = String::new();
        for i in 0..10 {
            match fs::read(p) {
                Ok(b) => {
                    let t = String::from_utf8_lossy(&b);
                    return serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}'))
                        .map(Some)
                        .map_err(|e| format!("damaged: {e}"));
                }
                Err(e) => last = e.to_string(),
            }
            std::thread::sleep(std::time::Duration::from_millis(100 * (i + 1)));
        }
        Err(format!("unreadable: {last}"))
    };
    // the newest good copy: file.bak, then the daily backups
    let fallback = || {
        std::iter::once(bak.clone())
            .chain(daily_backups(file))
            .find_map(|p| parse(&p).ok().flatten())
    };
    match parse(file) {
        Ok(Some(v)) => {
            let _ = fs::copy(file, &bak);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as i64);
            keep_daily(file, now);
            Loaded::Ok(normalize(v))
        }
        Ok(None) => match fallback() {
            Some(v) => Loaded::Ok(normalize(v)),
            None => Loaded::Ok(normalize(Value::Null)),
        },
        Err(e) if e.starts_with("unreadable") => Loaded::Unreadable(e),
        Err(e) => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis());
            let _ = fs::copy(
                file,
                file.with_file_name(format!("accounts.damaged-{ts}.json")),
            );
            // the copy from the last good start is better than nothing
            match fallback().map(Ok::<_, String>).transpose() {
                Ok(Some(v)) => Loaded::Damaged(normalize(v), e),
                _ => Loaded::Damaged(normalize(Value::Null), e),
            }
        }
    }
}

/// Write to a temporary file, flush it to the disk, then rename over the old file: a crash or power
/// cut mid-write never leaves half a file. A rename blocked for a moment (virus scanner) is retried.
pub fn write_atomic(file: &Path, text: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(d) = file.parent() {
        fs::create_dir_all(d)?;
    }
    let tmp = tmp_path(file);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text)?;
        f.sync_all()?;
    }
    replace(&tmp, file)
}
/// A temporary file next to `file` that no other writer uses (two writes of the same file at once
/// – e.g. the counters cache while pre-loading – must not share one).
pub fn tmp_path(file: &Path) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    file.with_extension(format!("tmp{}", N.fetch_add(1, Ordering::Relaxed)))
}
/// Renames `tmp` over `file`, retried a few times; on failure `tmp` is removed.
pub fn replace(tmp: &Path, file: &Path) -> std::io::Result<()> {
    let mut last = None;
    for i in 0..8 {
        match fs::rename(&tmp, file) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(std::time::Duration::from_millis(25 * (i + 1)));
    }
    let _ = fs::remove_file(&tmp);
    Err(last.unwrap())
}

// ---------- export / import ----------

const EXPORT_FIELDS: [&str; 21] = [
    "puuid",
    "gameName",
    "tagLine",
    "region",
    "note",
    "category",
    "addedAt",
    "iconId",
    "level",
    "solo",
    "flex",
    "r5",
    "classic",
    "lastPlayed",
    "history",
    "rankedGames",
    "goal",
    "goals",
    "coll",
    "mast",
    "seasonsManual",
];

fn pick_fields(x: &Obj) -> Obj {
    EXPORT_FIELDS
        .iter()
        .filter_map(|k| x.get(*k).map(|v| (k.to_string(), v.clone())))
        .collect()
}
fn is_cat_id(s: &str) -> bool {
    s.starts_with('c')
        && (2..=41).contains(&s.len())
        && s[1..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn build_export(st: &State, secrets: Option<Value>, now: i64) -> Value {
    let mut settings = st.settings.clone();
    settings.remove("autostart");
    let mut f = json!({
        "app": "rift-switch", "version": 1, "exportedAt": now,
        "accounts": st.accounts.iter().filter(|a| !truthy(a.get("placeholder"))).map(pick_fields).collect::<Vec<_>>(),
        "categories": st.categories, "settings": settings,
    });
    if let Some(s) = secrets {
        f["secrets"] = s;
    }
    f
}

/// A parsed file -> Some(file) if it is one of ours.
pub fn check_file(d: Value) -> Option<Value> {
    (d.get("app").and_then(Value::as_str) == Some("rift-switch")
        && d.get("accounts").is_some_and(Value::is_array))
    .then_some(d)
}

/// Merges the file into state (this PC's data wins, only gaps are filled); returns (added, updated).
pub fn apply_import(st: &mut State, d: &Value, new_cat_name: &str, now: i64) -> (u32, u32) {
    for c in d
        .get("categories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = c.get("id").and_then(Value::as_str) else {
            continue;
        };
        if is_cat_id(id) && !st.categories.iter().any(|x| str_of(x, "id") == id) {
            let name: String = c
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(32)
                .collect();
            st.categories.push(json!({ "id": id, "name": if name.is_empty() { new_cat_name.to_string() } else { name },
                "collapsed": truthy(c.get("collapsed")) }).as_object().unwrap().clone());
        }
    }
    let (mut added, mut updated) = (0, 0);
    for x in d
        .get("accounts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(x) = x.as_object() else { continue };
        if !is_puuid(str_of(x, "puuid")) {
            continue;
        }
        let mut acc = pick_fields(x);
        let note: String = str_of(&acc, "note").chars().take(24).collect();
        acc.insert("note".into(), json!(note));
        let cat = str_of(&acc, "category").to_string();
        if !cat.is_empty() && !st.categories.iter().any(|c| str_of(c, "id") == cat) {
            acc.remove("category");
        }
        let id = str_of(&acc, "puuid").to_string();
        if let Some(have) = st.account_mut(&id) {
            if !truthy(have.get("note")) && !note.is_empty() {
                have.insert("note".into(), json!(note));
            }
            if !truthy(have.get("category")) && acc.contains_key("category") {
                have.insert("category".into(), acc["category"].clone());
            }
            updated += 1;
        } else {
            if !truthy(acc.get("addedAt")) {
                acc.insert("addedAt".into(), json!(now));
            }
            st.accounts.push(acc);
            added += 1;
        }
    }
    if let Some(s) = d.get("settings") {
        merge_settings(&mut st.settings, s);
    }
    (added, updated)
}

/// Sealed logins -> [(account id, user, password)] to store; adds placeholder tiles for logins that
/// only existed as "saved, never signed in". A login already on this PC wins.
pub fn logins_to_restore(
    st: &mut State,
    logins: &[Value],
    now: i64,
) -> Vec<(String, String, String)> {
    let mut out = vec![];
    for l in logins {
        let Some((u, p)) = valid_cred(l) else {
            continue;
        };
        let id = l.get("puuid").and_then(Value::as_str).unwrap_or("");
        if !is_id(id) {
            continue;
        }
        if !st.has(id) && truthy(l.get("placeholder")) {
            let name: String = l
                .get("gameName")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| mask_login(&u))
                .chars()
                .take(32)
                .collect();
            let tag: String = l
                .get("tagLine")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(8)
                .collect();
            st.accounts.push(json!({ "puuid": id, "placeholder": true, "note": "", "addedAt": now, "gameName": name, "tagLine": tag })
                .as_object().unwrap().clone());
        }
        let Some(a) = st.account(id) else { continue };
        if truthy(a.get("hasCred")) && !truthy(a.get("credBroken")) {
            continue;
        }
        out.push((id.to_string(), u, p));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    const P1: &str = "11111111-1111-1111-1111-111111111111";
    const P2: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn migrations_damaged_file_atomic_write() {
        // the first start: a language for sure (Windows' own, in tests none: English); a lane picked
        // before stays picked, the default one follows the main role
        assert_eq!(normalize(Value::Null).settings["lang"], "en");
        assert_eq!(normalize(json!({ "settings": { "lang": "de" } })).settings["lang"], "de");
        assert_eq!(normalize(json!({ "settings": { "lane": "mid" } })).settings["laneChosen"], true);
        assert_eq!(normalize(json!({ "settings": { "lane": "top" } })).settings["laneChosen"], false);
        assert_eq!(normalize(json!({ "settings": { "lane": "mid", "laneChosen": false } })).settings["laneChosen"], false);
        let s = normalize(json!({ "settings": { "sort": "custom", "autoPlay": false } }));
        assert_eq!(s.settings["sort"], "level");
        assert_eq!(s.settings["autoPlay"], true);
        assert!(s.accounts.is_empty());
        assert_eq!(
            normalize(json!({ "settings": { "sort": "name", "sortLevelDefault": true } })).settings
                ["sort"],
            "name"
        );
        assert_eq!(normalize(json!({ "accounts": [{ "puuid": "a", "gameName": "\u{2066}A\u{2069}", "tagLine": "\u{2066}187\u{2069}" }] })).accounts[0]["tagLine"], "187");

        let dir = std::env::temp_dir().join(format!("rs-store-test-{}", std::process::id()));
        let file = dir.join("accounts.json");
        write_atomic(
            &file,
            json!({ "accounts": [{ "puuid": P1 }], "keepMe": 1 })
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        let Loaded::Ok(st) = read_state(&file) else {
            panic!()
        };
        assert_eq!(st.accounts[0]["puuid"], P1);
        assert_eq!(st.to_json()["keepMe"], 1);
        assert!(dir.join("accounts.json.bak").exists()); // the good file is kept as .bak
        fs::write(&file, "{ broken").unwrap();
        let Loaded::Damaged(st, _) = read_state(&file) else {
            panic!()
        };
        assert_eq!(st.accounts[0]["puuid"], P1); // back from the .bak
        assert!(fs::read_dir(&dir).unwrap().any(|f| f
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("accounts.damaged-")));
        fs::remove_file(&file).unwrap();
        let Loaded::Ok(st) = read_state(&file) else {
            panic!()
        };
        assert_eq!(st.accounts[0]["puuid"], P1); // missing file: the .bak
                                                 // .bak gone too: the daily copy in backups/
        fs::remove_file(dir.join("accounts.json.bak")).unwrap();
        assert_eq!(daily_backups(&file).len(), 1);
        let Loaded::Ok(st) = read_state(&file) else {
            panic!()
        };
        assert_eq!(st.accounts[0]["puuid"], P1);
        // only the newest 5 days stay
        for d in 1..=7 {
            fs::write(
                dir.join(format!("backups/accounts-2020-01-0{d}.json")),
                "{}",
            )
            .unwrap();
        }
        write_atomic(&file, json!({ "accounts": [] }).to_string().as_bytes()).unwrap();
        let _ = read_state(&file);
        let left = daily_backups(&file);
        assert_eq!(left.len(), 5);
        assert!(left[0].to_string_lossy().contains(&day_name(now_ms_test())));
        let _ = fs::remove_dir_all(&dir);
    }

    fn now_ms_test() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    #[test]
    fn day_names() {
        assert_eq!(day_name(0), "1970-01-01");
        assert_eq!(day_name(1_795_400_000_000), "2026-11-23");
        assert_eq!(day_name(951_782_400_000), "2000-02-29");
    }

    #[test]
    fn export_import_round_trip() {
        let st = normalize(json!({
            "accounts": [{ "puuid": P1, "gameName": "A", "note": "main", "category": "c1", "hasCred": true, "solo": { "tier": "GOLD" } },
                         { "puuid": format!("new-{P2}"), "placeholder": true, "gameName": "x•••" }],
            "categories": [{ "id": "c1", "name": "Mains" }], "settings": { "autostart": true, "lang": "de", "uiScale": "110" } }));
        let file = build_export(&st, None, 5);
        assert_eq!(file["accounts"].as_array().unwrap().len(), 1);
        assert!(file["accounts"][0].get("hasCred").is_none());
        assert!(file["settings"].get("autostart").is_none());
        assert!(check_file(file.clone()).is_some());
        assert!(check_file(json!({ "app": "other", "accounts": [] })).is_none());

        let mut here = normalize(
            json!({ "accounts": [{ "puuid": P1, "note": "", "gameName": "A" }], "settings": { "lang": "en" } }),
        );
        let mut f2 = file.clone();
        f2["accounts"].as_array_mut().unwrap().extend([
            json!({ "puuid": "../evil" }),
            json!({ "puuid": P2, "gameName": "B", "note": "x".repeat(50) }),
        ]);
        assert_eq!(apply_import(&mut here, &f2, "New", 1), (1, 1));
        assert_eq!(here.accounts[0]["note"], "main");
        assert_eq!(here.accounts[1]["note"].as_str().unwrap().len(), 24);
        assert_eq!(here.categories[0]["id"], "c1");
        assert_eq!(here.settings["lang"], "de");

        let logins = logins_to_restore(
            &mut here,
            &[
                json!({ "puuid": P1, "u": "a", "p": "b" }),
                json!({ "puuid": format!("new-{P1}"), "u": "c", "p": "d", "placeholder": true, "gameName": "c•••" }),
                json!({ "puuid": "bad", "u": "e", "p": "f" }),
                json!({ "puuid": P2, "u": "", "p": "x" }),
            ],
            1,
        );
        assert_eq!(
            logins.iter().map(|l| l.0.clone()).collect::<Vec<_>>(),
            vec![P1.to_string(), format!("new-{P1}")]
        );
        assert!(here
            .accounts
            .iter()
            .any(|a| a["puuid"] == format!("new-{P1}") && a["placeholder"] == true));
    }
    #[test]
    fn ids_that_could_leave_the_folder_are_dropped() {
        let s = normalize(json!({ "accounts": [
            { "puuid": "../../evil" }, { "puuid": "C:\\x" }, { "puuid": "a/b" }, { "puuid": "" },
            { "puuid": "00000001-1111-1111-1111-111111111111" }
        ] }));
        assert_eq!(s.accounts.len(), 1);
    }
}
