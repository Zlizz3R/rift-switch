//! Everything that touches the Riot Client / League Client on this PC.
//! An account's sign-in is a snapshot of the Riot Client's "stay signed in" session
//! (the files in %LOCALAPPDATA%\Riot Games\Riot Client\Data).

use crate::accounts::{num_of, Obj};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PROCESSES: [&str; 10] = [
    "League of Legends.exe",
    "LeagueClient.exe",
    "LeagueClientUx.exe",
    "LeagueClientUxRender.exe",
    "LeagueCrashHandler64.exe",
    "RiotClientServices.exe",
    "Riot Client.exe",
    "RiotClientUx.exe",
    "RiotClientUxRender.exe",
    "RiotClientCrashHandler.exe",
];

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}
fn local() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
}
fn rc_data() -> PathBuf {
    local().join("Riot Games").join("Riot Client").join("Data")
}
pub fn rc_dir() -> PathBuf {
    local().join("Riot Games").join("Riot Client")
}

// ---------- installs ----------

fn installs() -> Value {
    static C: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
    let mut c = C.lock().unwrap();
    if let Some((at, v)) = &*c {
        if at.elapsed() < Duration::from_secs(60) {
            return v.clone();
        }
    }
    let v = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json")
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(json!({}));
    *c = Some((Instant::now(), v.clone()));
    v
}
/// For the diagnostics file: where the Riot Client and League are and whether they exist.
pub fn install_report() -> Vec<(String, String, bool)> {
    let exe = riot_client_exe();
    let (live, pbe) = league_dirs();
    let mut v = vec![(
        "Riot Client".to_string(),
        exe.clone(),
        Path::new(&exe).exists(),
    )];
    v.push(("League".into(), live.clone(), Path::new(&live).exists()));
    if let Some(p) = pbe {
        v.push(("League PBE".into(), p.clone(), Path::new(&p).exists()));
    }
    v
}
fn riot_client_exe() -> String {
    let j = installs();
    let exe = j
        .get("rc_live")
        .or(j.get("rc_default"))
        .and_then(Value::as_str)
        .unwrap_or("C:/Riot Games/Riot Client/RiotClientServices.exe");
    exe.replace('/', "\\")
}
/// League install folders: live and (if installed) PBE.
fn league_dirs() -> (String, Option<String>) {
    let j = installs();
    let keys: Vec<String> = j
        .get("associated_client")
        .and_then(Value::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let ends = |d: &str, s: &str| d.trim_end_matches('/').to_lowercase().ends_with(s);
    let live = keys
        .iter()
        .find(|d| ends(d, "league of legends"))
        .cloned()
        .unwrap_or_else(|| "C:/Riot Games/League of Legends/".into());
    let pbe = keys
        .iter()
        .find(|d| ends(d, "league of legends (pbe)"))
        .cloned();
    (live.replace('/', "\\"), pbe.map(|d| d.replace('/', "\\")))
}

// ---------- local Riot APIs ----------

#[derive(Clone, Debug, PartialEq)]
pub struct Lock {
    pub port: String,
    pub password: String,
}
fn read_lock(file: &Path) -> Option<Lock> {
    let t = std::fs::read_to_string(file).ok()?;
    let p: Vec<&str> = t.split(':').collect();
    (p.len() >= 4 && !p[2].is_empty() && !p[3].is_empty()).then(|| Lock {
        port: p[2].into(),
        password: p[3].trim().into(),
    })
}

/// Test copies with RS_NO_RIOT set never talk to the Riot Client or League (safe while you play).
pub fn offline_test() -> bool {
    std::env::var_os("RS_DATA").is_some() && std::env::var_os("RS_NO_RIOT").is_some()
}

static PATCHLINE: Mutex<&str> = Mutex::new("live");
/// The running League client: live or PBE. A lockfile can be left behind by a crash, so the newer one wins.
pub fn lockfile() -> Option<Lock> {
    if offline_test() {
        return None;
    }
    let (live, pbe) = league_dirs();
    let mut best: Option<(std::time::SystemTime, Lock, &str)> = None;
    for (dir, pl) in [(Some(live), "live"), (pbe, "pbe")] {
        let Some(dir) = dir else { continue };
        let f = Path::new(&dir).join("lockfile");
        let Ok(t) = std::fs::metadata(&f).and_then(|m| m.modified()) else {
            continue;
        };
        if let Some(lf) = read_lock(&f) {
            if best.as_ref().is_none_or(|b| t > b.0) {
                best = Some((t, lf, pl));
            }
        }
    }
    let (_, lf, pl) = best?;
    *PATCHLINE.lock().unwrap() = pl;
    Some(lf)
}
pub fn patchline() -> &'static str {
    *PATCHLINE.lock().unwrap()
}
fn rc_lock() -> Option<Lock> {
    if offline_test() {
        return None;
    }
    read_lock(&rc_dir().join("Config").join("lockfile"))
}

fn local_client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true) // the clients use their own self-signed certificate
            .pool_max_idle_per_host(4)
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .expect("http client")
    })
}
pub fn web_client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) RiftSwitch")
            .pool_idle_timeout(Duration::from_secs(20))
            .build()
            .expect("http client")
    })
}

pub struct Raw {
    pub up: bool,
    pub status: u16,
    pub body: Option<Value>,
}

async fn api_raw(lf: &Lock, path: &str, timeout_ms: u64, method: &str) -> Raw {
    let url = format!("https://127.0.0.1:{}{}", lf.port, path);
    let m = reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
    let req = local_client()
        .request(m, url)
        .basic_auth("riot", Some(&lf.password))
        .timeout(Duration::from_millis(timeout_ms));
    match req.send().await {
        Err(_) => Raw {
            up: false,
            status: 0,
            body: None,
        },
        Ok(res) => {
            let status = res.status().as_u16();
            match res.bytes().await {
                Ok(b) => Raw {
                    up: true,
                    status,
                    body: if b.is_empty() {
                        None
                    } else {
                        Some(serde_json::from_slice(&b).unwrap_or(Value::Bool(true)))
                    },
                },
                Err(_) => Raw {
                    up: true,
                    status: 0,
                    body: None,
                },
            }
        }
    }
}
/// One request; None on any error or non-2xx; Some(true) for an empty answer.
async fn api(lf: &Lock, path: &str, timeout_ms: u64, method: &str) -> Option<Value> {
    let r = api_raw(lf, path, timeout_ms, method).await;
    (r.up && (200..300).contains(&r.status)).then(|| r.body.unwrap_or(Value::Bool(true)))
}

/// League Client API (LCU)
pub async fn lcu(path: &str, timeout_ms: u64, method: &str) -> Option<Value> {
    let lf = lockfile()?;
    api(&lf, path, timeout_ms, method).await
}
pub async fn get(path: &str) -> Option<Value> {
    lcu(path, 4000, "GET").await
}
fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

// ---------- ranks ----------

const KNOWN_TIERS: [&str; 10] = [
    "IRON",
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    "EMERALD",
    "DIAMOND",
    "MASTER",
    "GRANDMASTER",
    "CHALLENGER",
];

/// own: data of the signed-in account. For other accounts the client only reports wins
/// (losses come back as 0), so win/loss is marked unknown there.
pub fn pick_queue(stats: &Value, q: &str, own: bool) -> Value {
    let x = &stats["queueMap"][q];
    let tier = x.get("tier").and_then(Value::as_str).unwrap_or("");
    if tier.is_empty() || tier == "NONE" || tier == "NA" {
        return Value::Null;
    }
    let (wins, losses) = (num_of(x.get("wins")), num_of(x.get("losses")));
    // tiers Riot uses as a placeholder before placements (e.g. 'SALT' in Classic 5v5) count as unranked
    if !KNOWN_TIERS.contains(&tier) && wins + losses == 0.0 {
        return Value::Null;
    }
    let wl = own || !(losses == 0.0 && wins > 0.0);
    let mut o = json!({ "tier": tier, "division": x.get("division"), "lp": x.get("leaguePoints"), "wins": x.get("wins"), "losses": x.get("losses"), "wl": wl });
    // the highest rank this season, and where the last season ended (the client's own numbers)
    let rank_of = |t: &str, d: &str| {
        let tier = x.get(t).and_then(Value::as_str).unwrap_or("");
        KNOWN_TIERS.contains(&tier).then(
            || json!({ "tier": tier, "division": x.get(d).and_then(Value::as_str).unwrap_or("") }),
        )
    };
    if let Some(p) = rank_of("highestTier", "highestDivision") {
        o["peak"] = p;
    }
    if let Some(p) = rank_of("previousSeasonEndTier", "previousSeasonEndDivision") {
        o["lastSeason"] = p;
    }
    o
}

/// Riot's own decay counter (signed-in account only, Solo/Duo and Flex).
pub fn decay_of(stats: &Value, now: i64) -> Value {
    let mut q = Obj::new();
    for (k, key) in [("solo", "RANKED_SOLO_5x5"), ("flex", "RANKED_FLEX_SR")] {
        let d = &stats["queueMap"][key]["warnings"]["daysUntilDecay"];
        let n = d
            .as_f64()
            .or_else(|| d.as_str().and_then(|s| s.parse().ok()));
        if let Some(n) = n.filter(|n| *n >= 0.0) {
            q.insert(k.into(), json!(n));
        }
    }
    if q.is_empty() {
        Value::Null
    } else {
        json!({ "q": q, "at": now })
    }
}

pub async fn ranked_for(puuid: &str, own: bool) -> Option<Obj> {
    let s = get(&format!("/lol-ranked/v1/ranked-stats/{}", enc(puuid))).await?;
    let mut o = Obj::new();
    if own {
        o.insert("decay".into(), decay_of(&s, now_ms()));
    }
    o.insert("solo".into(), pick_queue(&s, "RANKED_SOLO_5x5", own));
    o.insert("flex".into(), pick_queue(&s, "RANKED_FLEX_SR", own));
    o.insert("r5".into(), pick_queue(&s, "RANKED_PREMADE_5x5", own));
    o.insert(
        "classic".into(),
        pick_queue(&s, "JADE_RANKED_SOLO_5x5", own),
    );
    Some(o)
}

async fn region() -> String {
    get("/riotclient/region-locale")
        .await
        .and_then(|r| r["region"].as_str().map(String::from))
        .unwrap_or_default()
}

pub async fn current_account() -> Option<Obj> {
    let me = get("/lol-summoner/v1/current-summoner").await?;
    let puuid = me.get("puuid")?.as_str()?.to_string();
    let region = region().await;
    let ranked = ranked_for(&puuid, true).await;
    let name = me
        .get("gameName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or(me.get("displayName").and_then(Value::as_str))
        .unwrap_or("");
    let mut o = json!({
        "puuid": puuid, "summonerId": me.get("summonerId"), "gameName": name,
        "tagLine": me.get("tagLine").and_then(Value::as_str).unwrap_or(""),
        "iconId": me.get("profileIconId"), "level": me.get("summonerLevel"), "region": region,
    })
    .as_object()
    .unwrap()
    .clone();
    o.extend(ranked.unwrap_or_default());
    Some(o)
}

pub async fn summoner_by_puuid(puuid: &str) -> Option<Value> {
    get(&format!("/lol-summoner/v2/summoners/puuid/{}", enc(puuid)))
        .await
        .filter(Value::is_object)
}

/// Name#Tag -> account data without logging in (needs League open on an account of the same region).
pub async fn lookup_riot_id(game_name: &str, tag: &str) -> Option<Obj> {
    let hit = get(&format!(
        "/lol-summoner/v1/alias/lookup?gameName={}&tagLine={}",
        enc(game_name),
        enc(tag)
    ))
    .await?;
    let puuid = hit.get("puuid")?.as_str()?.to_string();
    let s = summoner_by_puuid(&puuid).await;
    let r = ranked_for(&puuid, false).await;
    let region = region().await;
    let sv = |k: &str| {
        s.as_ref()
            .and_then(|s| s.get(k))
            .and_then(Value::as_str)
            .filter(|x| !x.is_empty())
            .map(String::from)
    };
    let mut o = json!({ "puuid": puuid, "gameName": sv("gameName").unwrap_or(game_name.into()), "tagLine": sv("tagLine").unwrap_or(tag.into()) })
        .as_object().unwrap().clone();
    if let Some(s) = &s {
        o.insert("iconId".into(), s["profileIconId"].clone());
        o.insert("level".into(), s["summonerLevel"].clone());
    }
    o.insert("region".into(), json!(region));
    o.extend(r.unwrap_or_default());
    Some(o)
}

/// Owned champions (ids), owned skins ([id, name, picture]) and the shards / permanents in the loot
/// ([kind, id, count, name, picture]: "c" champion shard, "C" champion permanent, "s" skin shard,
/// "S" skin permanent). The picture is the client's tilePath (shown via CommunityDragon).
///
/// Only the parts the client really answered are in the result: right after a login the
/// inventory often isn't loaded yet – an empty or failed part must not replace a good one
/// (main.rs merges the parts into the stored collection).
pub fn collection_of(champs: &Value, skins: &Value, loot: &Value) -> Value {
    let owned = |x: &&Value| x["ownership"]["owned"] == true;
    let mut out = json!({ "at": now_ms() });
    let champs: Vec<Value> = champs
        .as_array()
        .map(|c| {
            c.iter()
                .filter(owned)
                .filter(|x| real_champ(x))
                .map(|x| x["id"].clone())
                .collect()
        })
        .unwrap_or_default();
    // nobody owns no champion at all: an empty list means "not loaded yet"
    if !champs.is_empty() {
        out["champs"] = json!(champs);
    }
    if let Some(s) = skins.as_array().filter(|s| !s.is_empty()) {
        let list: Vec<Value> = s
            .iter()
            .filter(owned)
            .filter(|x| real_skin(x))
            .map(|x| json!([x["id"], x["name"], x["tilePath"].as_str().unwrap_or("")]))
            .collect();
        out["skins"] = json!(list);
    }
    let Some(loot) = loot.as_array() else {
        return out;
    };
    let shards: Vec<Value> = Some(loot)
        .map(|l| {
            l.iter()
                .filter_map(|x| {
                    let kind = match x["type"].as_str()? {
                        "CHAMPION_RENTAL" => "c",
                        "CHAMPION" => "C",
                        "SKIN_RENTAL" => "s",
                        "SKIN" => "S",
                        _ => return None,
                    };
                    let n = x["count"].as_i64().unwrap_or(0);
                    if n <= 0 {
                        return None;
                    }
                    let name = [&x["itemDesc"], &x["localizedName"]]
                        .into_iter()
                        .find_map(|v| v.as_str().filter(|s| !s.is_empty()))
                        .unwrap_or("");
                    let tile = x["tilePath"].as_str().unwrap_or("");
                    Some(json!([kind, x["storeItemId"], n, name, tile]))
                })
                .collect()
        })
        .unwrap_or_default();
    out["shards"] = json!(shards);
    out
}
/// Real champions only: the client also lists copies for special modes (ids from 60000 on).
fn real_champ(x: &Value) -> bool {
    let id = num_of(x.get("id"));
    id > 0.0 && id < 10_000.0
}
/// Real skins only (not the base skin, not the copies of special-mode champions: id = champion * 1000 + n).
fn real_skin(x: &Value) -> bool {
    x["isBase"] != true && num_of(x.get("id")) < 10_000_000.0
}

/// Everything only the signed-in account can see about itself ("_coll": the collection, which
/// main.rs keeps outside the profile).
pub async fn profile_data(me: &Obj) -> Obj {
    let mut p_coll: Option<Value> = None;
    let sid = me
        .get("summonerId")
        .map(|v| v.to_string())
        .unwrap_or_default();
    let (u_champs, u_skins) = (
        format!("/lol-champions/v1/inventories/{sid}/champions-minimal"),
        format!("/lol-champions/v1/inventories/{sid}/skins-minimal"),
    );
    let (wallet, honor, mastery, score, champs, skins, loot) = tokio::join!(
        get("/lol-inventory/v1/wallet?currencyTypes=%5B%22RP%22,%22lol_blue_essence%22%5D"),
        get("/lol-honor-v2/v1/profile"),
        lcu(
            "/lol-champion-mastery/v1/local-player/champion-mastery",
            6000,
            "GET"
        ),
        get("/lol-champion-mastery/v1/local-player/champion-mastery-score"),
        lcu(&u_champs, 6000, "GET"),
        lcu(&u_skins, 6000, "GET"),
        lcu("/lol-loot/v1/player-loot", 6000, "GET"),
    );
    // what the account owns, for the collection page (kept apart from the profile: it's long)
    if champs.is_some() || skins.is_some() || loot.is_some() {
        p_coll = Some(collection_of(
            champs.as_ref().unwrap_or(&Value::Null),
            skins.as_ref().unwrap_or(&Value::Null),
            loot.as_ref().unwrap_or(&Value::Null),
        ));
    }
    let mut p = Obj::new();
    p.insert("at".into(), json!(now_ms()));
    if let Some(w) = wallet.filter(Value::is_object) {
        p.insert("be".into(), w["lol_blue_essence"].clone());
        p.insert("rp".into(), w["RP"].clone());
    }
    if let Some(h) = honor.filter(Value::is_object) {
        p.insert("honor".into(), h["honorLevel"].clone());
    }
    if let Some(s) = score.filter(Value::is_number) {
        p.insert("masteryScore".into(), s);
    }
    if let Some(Value::Array(m)) = mastery {
        p.insert("masteryChamps".into(), json!(m.len()));
        let mut m = m;
        m.sort_by(|a, b| {
            num_of(b.get("championPoints")).total_cmp(&num_of(a.get("championPoints")))
        });
        p.insert("topMastery".into(), Value::Array(m.iter().take(3).map(|x| json!({ "id": x["championId"], "level": x["championLevel"], "points": x["championPoints"] })).collect()));
    }
    if let Some(Value::Array(c)) = champs {
        let real: Vec<&Value> = c.iter().filter(|x| real_champ(x)).collect();
        p.insert(
            "champs".into(),
            json!(real
                .iter()
                .filter(|x| x["ownership"]["owned"] == true)
                .count()),
        );
        p.insert("champsTotal".into(), json!(real.len()));
    }
    if let Some(Value::Array(s)) = skins {
        p.insert(
            "skins".into(),
            json!(s
                .iter()
                .filter(|x| real_skin(x) && x["ownership"]["owned"] == true)
                .count()),
        );
    }
    if let Some(c) = p_coll {
        p.insert("_coll".into(), c);
    }
    p
}

/// Only real penalties: LeaverBuster, bans, suspensions, lockouts, dodge timers, the low
/// priority queue. Everything else Riot puts in the same list (level, champions, lobby, a game
/// running, "Unknown", "GameVersionMissing" …) is not one.
pub fn is_penalty(code: &str) -> bool {
    const WORDS: [&str; 9] = [
        "leaver",
        "ban",
        "suspension",
        "lockout",
        "dodge",
        "penalty",
        "timed",
        "lowpriority",
        "ranked_restricted",
    ];
    let c = code.to_lowercase();
    WORDS.iter().any(|w| c.contains(w))
}
/// Answers the client gives while it can't really check (a game running, client still loading):
/// such a check says nothing about the account and must not replace the last good one.
pub fn is_transient(code: &str) -> bool {
    matches!(code, "Unknown" | "PlayerInGameRestriction") || code.starts_with("GameVersion")
}
/// Every penalty in Riot's queue check, across all queues, once per kind:
/// [{ code, until (ms, 0 = no end given), args }]
pub fn penalties_of(list: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = vec![];
    for r in list
        .iter()
        .flat_map(|q| q["restrictions"].as_array().into_iter().flatten())
    {
        let code = r["restrictionCode"].as_str().unwrap_or("");
        if !is_penalty(code) {
            continue;
        }
        let until = r["expiredTimestamp"].as_i64().unwrap_or(0);
        match out.iter_mut().find(|p| p["code"] == code) {
            Some(p) => {
                if until > p["until"].as_i64().unwrap_or(0) {
                    p["until"] = json!(until);
                }
            }
            None => out.push(json!({ "code": code, "until": until, "args": if r["restrictionArgs"].is_object() { r["restrictionArgs"].clone() } else { json!({}) } })),
        }
    }
    out
}

/// LeaverBuster messages the client keeps for the signed-in account (e.g. a low priority queue for
/// the next game, already before you queue). Their exact form isn't documented: only entries whose
/// type speaks of a penalty are taken.
pub async fn leaver_notices() -> Vec<Value> {
    let Some(Value::Array(list)) = get("/lol-leaver-buster/v1/notifications").await else {
        return vec![];
    };
    leaver_notices_of(&list)
}
pub fn leaver_notices_of(list: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = vec![];
    for n in list {
        let ty = n["type"]
            .as_str()
            .or(n["notificationType"].as_str())
            .unwrap_or("");
        let low = ty.to_lowercase();
        if ![
            "prio", "queue", "leaver", "lock", "tainted", "punish", "penalty",
        ]
        .iter()
        .any(|w| low.contains(w))
        {
            continue;
        }
        let code = format!(
            "LeaverBuster{}",
            ty.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
        );
        if !out.iter().any(|p| p["code"] == code) {
            // games still under the penalty ("punishedGamesRemaining" and the like)
            let games = n.as_object().and_then(|o| {
                o.iter()
                    .find(|(k, v)| {
                        k.to_lowercase().contains("games") && v.as_i64().is_some_and(|g| g > 0)
                    })
                    .and_then(|(_, v)| v.as_i64())
            });
            out.push(match games {
                Some(g) => json!({ "code": code, "until": 0, "games": g }),
                None => json!({ "code": code, "until": 0 }),
            });
        }
    }
    out
}

/// Waiting times the client gives when you try to queue: the low priority queue (LeaverBuster,
/// "wait N minutes before you can queue") and lockouts such as the dodge timer.
/// -> [{ code, until }] (until = now + the seconds left)
pub fn queue_waits(search: &Value, now: i64) -> Vec<Value> {
    let mut out = vec![];
    let lp = &search["lowPriorityData"];
    let secs = lp["penaltyTimeRemaining"].as_f64().unwrap_or(0.0);
    if secs > 0.0 {
        out.push(json!({ "code": "LowPriorityQueue", "until": now + (secs * 1000.0) as i64, "total": lp["penaltyTime"].as_f64().unwrap_or(0.0) as i64 }));
    }
    for e in search["errors"].as_array().into_iter().flatten() {
        let secs = e["penaltyTimeRemaining"].as_f64().unwrap_or(0.0);
        if secs > 0.0 {
            out.push(json!({ "code": e["errorType"].as_str().unwrap_or("QueueLockout"), "until": now + (secs * 1000.0) as i64 }));
        }
    }
    out
}
/// The wait per game of a low priority queue (seconds), 0 = none. It stays in the search for the
/// whole queue, also after this game's wait has run out.
pub fn low_prio_secs(search: &Value) -> i64 {
    search["lowPriorityData"]["penaltyTime"]
        .as_f64()
        .unwrap_or(0.0) as i64
}
/// -> (waits, low priority seconds per game; None = no search running)
pub async fn queue_wait_now() -> (Vec<Value>, Option<i64>) {
    match lcu("/lol-matchmaking/v1/search", 2000, "GET").await {
        Some(s) if s.is_object() => (queue_waits(&s, now_ms()), Some(low_prio_secs(&s))),
        _ => (vec![], None),
    }
}

/// Riot's own answer whether the signed-in account may queue ranked, plus every penalty in it.
pub async fn ranked_eligibility() -> Option<(Value, Vec<Value>)> {
    let list = lcu("/lol-lobby/v2/eligibility/self", 5000, "POST").await?;
    let list = list.as_array()?;
    let codes = list
        .iter()
        .flat_map(|q| q["restrictions"].as_array().into_iter().flatten())
        .filter_map(|r| r["restrictionCode"].as_str());
    if codes.clone().any(is_transient) {
        return None;
    }
    let one = |id: i64| -> Value {
        let Some(q) = list.iter().find(|x| x["queueId"].as_i64() == Some(id)) else {
            return Value::Null;
        };
        // "Team…" reasons are about the current lobby, not the account
        let reasons: Vec<Value> = q["restrictions"].as_array().into_iter().flatten()
            .filter(|r| !r["restrictionCode"].as_str().unwrap_or("").starts_with("Team"))
            .map(|r| json!({ "code": r["restrictionCode"], "args": if r["restrictionArgs"].is_null() { json!({}) } else { r["restrictionArgs"].clone() },
                "until": if r["expiredTimestamp"].is_null() { json!(0) } else { r["expiredTimestamp"].clone() } }))
            .collect();
        json!({ "ok": q["eligible"] == true || reasons.is_empty(), "reasons": reasons })
    };
    Some((
        json!({ "at": now_ms(), "solo": one(420), "flex": one(440), "r5": one(710), "classic": one(4310) }),
        penalties_of(list),
    ))
}

pub async fn accept_ready_check() -> bool {
    let Some(rc) = lcu("/lol-matchmaking/v1/ready-check", 2000, "GET").await else {
        return false;
    };
    if rc["state"] != "InProgress" || rc["playerResponse"] != "None" {
        return false;
    }
    lcu("/lol-matchmaking/v1/ready-check/accept", 3000, "POST")
        .await
        .is_some()
}

pub async fn gameflow_phase() -> Option<String> {
    lcu("/lol-gameflow/v1/gameflow-phase", 2000, "GET")
        .await
        .and_then(|v| v.as_str().map(String::from))
}

/// Leave lobby / queue before switching: otherwise the old lobby often "sticks".
pub async fn leave_lobby() -> bool {
    let phase = gameflow_phase().await.unwrap_or_default();
    if !["Lobby", "Matchmaking", "ReadyCheck"].contains(&phase.as_str()) {
        return false;
    }
    if phase != "Lobby" {
        lcu("/lol-lobby/v2/lobby/matchmaking/search", 3000, "DELETE").await;
    }
    lcu("/lol-lobby/v2/lobby", 3000, "DELETE").await;
    true
}

// ---------- match history ----------

const NORMAL_SR_QUEUES: [i64; 4] = [400, 430, 480, 490];
const RANKED_QUEUE_IDS: [i64; 4] = [420, 440, 710, 4310];

pub struct HistorySummary {
    pub last_played: Option<i64>,
    pub list: Vec<Value>,
    pub ranked: Vec<Value>,
    pub normals: Value,
}

/// The match list -> last played, ranked games, normal-games count.
pub fn summarize_games(games: &[Value], now: i64) -> HistorySummary {
    let q = |g: &Value| g["queueId"].as_i64().unwrap_or(0);
    let key = |id: i64| match id {
        420 => Some("solo"),
        440 => Some("flex"),
        710 => Some("r5"),
        4310 => Some("classic"),
        _ => None,
    };
    let ranked = games
        .iter()
        .filter(|g| key(q(g)).is_some())
        .map(|g| {
            let p = &g["participants"][0];
            json!({ "id": g["gameId"], "t": g["gameCreation"], "q": key(q(g)),
                "win": p["stats"]["win"] == true, "champ": p["championId"] })
        })
        .collect();
    HistorySummary {
        last_played: games
            .iter()
            .map(|g| g["gameCreation"].as_i64().unwrap_or(0))
            .max(),
        list: games
            .iter()
            .map(|g| json!({ "id": g["gameId"], "t": g["gameCreation"], "q": g["queueId"] }))
            .collect(),
        ranked,
        normals: json!({
            "count": games.iter().filter(|g| NORMAL_SR_QUEUES.contains(&q(g))).count(),
            "hasRanked": games.iter().any(|g| RANKED_QUEUE_IDS.contains(&q(g))),
            "sample": games.len(), "at": now,
        }),
    }
}
async fn match_page(puuid: &str, beg: usize, end: usize, timeout: u64) -> Option<Vec<Value>> {
    let mh = lcu(
        &format!(
            "/lol-match-history/v1/products/lol/{}/matches?begIndex={beg}&endIndex={end}",
            enc(puuid)
        ),
        timeout,
        "GET",
    )
    .await?;
    mh["games"]["games"].as_array().cloned()
}
pub async fn history_summary(puuid: &str) -> Option<HistorySummary> {
    Some(summarize_games(
        &match_page(puuid, 0, 50, 6000).await?,
        now_ms(),
    ))
}
/// One page of an account's match list (older games: higher beg) -> [{ id, t, q }].
pub async fn match_list(puuid: &str, beg: usize, end: usize) -> Option<Vec<Value>> {
    let g = match_page(puuid, beg, end, 8000).await?;
    Some(
        g.iter()
            .map(|g| json!({ "id": g["gameId"], "t": g["gameCreation"], "q": g["queueId"] }))
            .collect(),
    )
}

// ---------- session files ----------

fn read_dir(dir: &Path, base: &Path, out: &mut BTreeMap<String, String>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            read_dir(&p, base, out);
        } else if let Ok(b) = std::fs::read(&p) {
            let rel = p
                .strip_prefix(base)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('/', "\\");
            out.insert(rel, B64.encode(b));
        }
    }
}
pub fn capture_session() -> Option<String> {
    let mut files = BTreeMap::new();
    read_dir(&rc_data(), &rc_data(), &mut files);
    (!files.is_empty()).then(|| json!({ "v": 1, "files": files }).to_string())
}

/// Does a captured session hold a remembered ("Stay signed in") login?
pub fn session_persisted(json: &str) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return false;
    };
    let Some(b) = v["files"]["RiotGamesPrivateSettings.yaml"]
        .as_str()
        .and_then(|s| B64.decode(s).ok())
    else {
        return false;
    };
    let y = String::from_utf8_lossy(&b);
    let Some(i) = y.find("riot-login:") else {
        return false;
    };
    let rest = &y[i + "riot-login:".len()..];
    let ws_len = rest.len() - rest.trim_start().len();
    let ws = &rest[..ws_len];
    // a line break followed by indentation, then "persist:"
    if !ws.trim_end_matches([' ', '\t']).contains('\n') || ws.ends_with('\n') {
        return false;
    }
    let Some(after) = rest[ws_len..].strip_prefix("persist:") else {
        return false;
    };
    let val = after.split_whitespace().next().unwrap_or("");
    !val.is_empty() && val != "null"
}

pub fn clear_session() {
    let d = rc_data();
    let _ = std::fs::remove_dir_all(&d);
    let _ = std::fs::create_dir_all(&d);
}
pub fn restore_session(json: &str) {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return;
    };
    clear_session();
    for (rel, b64) in v["files"].as_object().into_iter().flatten() {
        // only plain relative paths inside the Data folder (no "..", no drive or root)
        let rel_path = PathBuf::from(rel.replace('/', "\\"));
        if rel_path.as_os_str().is_empty()
            || !rel_path
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_)))
        {
            continue;
        }
        let full = rc_data().join(rel_path);
        if let (Some(dir), Some(b)) = (full.parent(), b64.as_str().and_then(|s| B64.decode(s).ok()))
        {
            let _ = std::fs::create_dir_all(dir);
            let _ = std::fs::write(&full, b);
        }
    }
}

// ---------- processes ----------

/// Names of running Riot/League processes (one cheap system snapshot, no tasklist.exe).
pub fn running_riot_processes() -> Vec<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut out = vec![];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(e.szExeFile.len());
            let name = String::from_utf16_lossy(&e.szExeFile[..len]);
            if PROCESSES.iter().any(|p| p.eq_ignore_ascii_case(&name)) {
                out.push(name);
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}
pub fn league_running() -> bool {
    running_riot_processes().iter().any(|n| {
        n.eq_ignore_ascii_case("LeagueClient.exe") || n.eq_ignore_ascii_case("LeagueClientUx.exe")
    })
}

async fn taskkill(names: &[String]) {
    let mut cmd = tokio::process::Command::new("taskkill");
    cmd.args(["/F", "/T"]);
    for n in names {
        cmd.args(["/IM", n]);
    }
    cmd.creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let _ = cmd.status().await;
}
/// Ends the Riot Client and League (only ever on the user's switch / tool click).
pub async fn close_clients() -> bool {
    for _ in 0..20 {
        let mut running = running_riot_processes();
        if running.is_empty() {
            return true;
        }
        running.sort();
        running.dedup();
        taskkill(&running).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}
/// Ends only League (LeagueClient*); the Riot Client and its sign-in stay.
pub async fn close_league_only() {
    taskkill(&["LeagueClient.exe".into(), "LeagueClientUx.exe".into()]).await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
}
/// Brings up the Riot Client window (started without arguments it just shows itself).
pub fn show_riot_client() {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new(riot_client_exe())
        .creation_flags(0x0000_0008 | 0x0000_0200)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}
pub fn launch_league(pl: &str) {
    use std::os::windows::process::CommandExt;
    let pl = if pl == "pbe" { "pbe" } else { "live" };
    let _ = std::process::Command::new(riot_client_exe())
        .args([
            "--launch-product=league_of_legends",
            &format!("--launch-patchline={pl}"),
        ])
        .creation_flags(0x0000_0008 | 0x0000_0200) // detached, own process group
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

// ---------- Riot Client API ----------

/// Platform id of the Riot Client's account ("EUW1", "PBE1" …) -> short region.
pub fn platform_region(p: &str) -> String {
    p.trim_end_matches(|c: char| c.is_ascii_digit())
        .to_uppercase()
}
pub struct RcAccount {
    pub region: String,
}
pub async fn rc_account() -> Option<RcAccount> {
    let lf = rc_lock()?;
    let u = api(&lf, "/riot-client-auth/v1/userinfo", 3000, "GET").await?;
    let lol = u.get("lol").filter(|l| l.is_object())?;
    let pid = lol["cpid"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or(lol["pid"].as_str())
        .unwrap_or("");
    Some(RcAccount {
        region: platform_region(pid),
    })
}
async fn rc_api(path: &str, method: &str) -> Raw {
    match rc_lock() {
        Some(lf) => api_raw(&lf, path, 3000, method).await,
        None => Raw {
            up: false,
            status: 0,
            body: None,
        },
    }
}
/// The "Play" button of the Riot Client (live or PBE).
pub async fn press_play(pl: &str) -> bool {
    let r = rc_api(
        &format!(
            "/product-launcher/v1/products/league_of_legends/patchlines/{}",
            if pl == "pbe" { "pbe" } else { "live" }
        ),
        "POST",
    )
    .await;
    r.up && (200..300).contains(&r.status)
}
pub struct LoginState {
    pub up: bool,
    pub subject: Option<String>,
}
pub async fn rc_login_state() -> LoginState {
    let r = rc_api("/rso-auth/v1/authorization", "GET").await;
    let subject = if r.status == 200 {
        r.body.and_then(|b| b["subject"].as_str().map(String::from))
    } else {
        None
    };
    LoginState { up: r.up, subject }
}

// ---------- PowerShell helpers (login typing, PBE dialog) ----------

static SCRIPTS: OnceLock<PathBuf> = OnceLock::new();
pub fn set_scripts_dir(p: PathBuf) {
    let _ = SCRIPTS.set(p);
}
async fn run_script(name: &str, stdin: Option<String>, timeout: Duration) -> String {
    use tokio::io::AsyncWriteExt;
    let Some(dir) = SCRIPTS.get() else {
        return "error".into();
    };
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ])
    .arg(dir.join(name))
    .creation_flags(CREATE_NO_WINDOW)
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::null())
    .kill_on_drop(true);
    let Ok(mut child) = cmd.spawn() else {
        return "error".into();
    };
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(stdin.unwrap_or_default().as_bytes()).await;
    }
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(o)) => String::from_utf8_lossy(&o.stdout)
            .trim()
            .lines()
            .last()
            .unwrap_or("error")
            .trim()
            .to_string(),
        _ => "error".into(),
    }
}
/// Types username + password into the Riot Client login window (the password goes in via stdin,
/// never on the command line). since: only type into a Riot Client started after this moment.
pub async fn autofill(u: &str, p: &str, since: Option<i64>) -> String {
    run_script(
        "autofill.ps1",
        Some(ascii_json(&json!({ "u": u, "p": p, "since": since }))),
        Duration::from_secs(90),
    )
    .await
}
/// JSON with every non-ASCII character as \uXXXX: PowerShell 5 reads stdin in the console's
/// code page, so "ü" or "€" in a password would otherwise arrive garbled.
pub fn ascii_json(v: &Value) -> String {
    let mut out = String::new();
    for c in v.to_string().chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut b = [0u16; 2];
            for u in c.encode_utf16(&mut b) {
                out.push_str(&format!("\\u{:04x}", u));
            }
        }
    }
    out
}
/// Closes the Riot Client's "can't play with your PBE account" dialog.
pub async fn dismiss_pbe_dialog() -> String {
    run_script("rcmodal.ps1", None, Duration::from_secs(15)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn other_accounts_losses_unknown() {
        let s = json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "GOLD", "division": "I", "leaguePoints": 50, "wins": 10, "losses": 0 } } });
        assert_eq!(pick_queue(&s, "RANKED_SOLO_5x5", false)["wl"], false);
        assert_eq!(pick_queue(&s, "RANKED_SOLO_5x5", true)["wl"], true);
        let peak = json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "GOLD", "division": "II", "leaguePoints": 5, "wins": 1, "losses": 1,
            "highestTier": "PLATINUM", "highestDivision": "IV", "previousSeasonEndTier": "SILVER", "previousSeasonEndDivision": "I" } } });
        let p = pick_queue(&peak, "RANKED_SOLO_5x5", true);
        assert_eq!(p["peak"], json!({ "tier": "PLATINUM", "division": "IV" }));
        assert_eq!(
            p["lastSeason"],
            json!({ "tier": "SILVER", "division": "I" })
        );
        assert!(pick_queue(&s, "RANKED_FLEX_SR", false).is_null());
        let salt = json!({ "queueMap": { "JADE_RANKED_SOLO_5x5": { "tier": "SALT", "division": "IV", "wins": 0, "losses": 0 } } });
        assert!(pick_queue(&salt, "JADE_RANKED_SOLO_5x5", true).is_null());
    }
    #[test]
    fn decay_both_queues() {
        let s = json!({ "queueMap": { "RANKED_SOLO_5x5": { "warnings": { "daysUntilDecay": 12, "displayDecayWarning": false } },
                                       "RANKED_FLEX_SR": { "warnings": { "daysUntilDecay": 28 } } } });
        assert_eq!(
            decay_of(&s, 5),
            json!({ "q": { "solo": 12.0, "flex": 28.0 }, "at": 5 })
        );
        assert!(decay_of(&json!({}), 5).is_null());
    }
    #[test]
    fn summary() {
        let games = vec![
            json!({ "gameId": 1, "gameCreation": 100, "queueId": 420, "participants": [{ "championId": 7, "stats": { "win": true } }] }),
            json!({ "gameId": 2, "gameCreation": 200, "queueId": 400 }),
        ];
        let s = summarize_games(&games, 9);
        assert_eq!(s.last_played, Some(200));
        assert_eq!(s.ranked[0]["q"], "solo");
        assert_eq!(s.normals["count"], 1);
        assert_eq!(s.normals["hasRanked"], true);
    }
    #[test]
    fn stay_signed_in() {
        let mk = |y: &str| {
            json!({ "files": { "RiotGamesPrivateSettings.yaml": B64.encode(y) } }).to_string()
        };
        assert!(session_persisted(&mk(
            "riot-login:\r\n    persist:\r\n        region: \"EUW\""
        )));
        assert!(!session_persisted(&mk("riot-login:\n    persist: null\n")));
        assert!(!session_persisted(&mk("other: 1")));
        assert!(session_persisted(&mk("riot-login:\n  persist: abc\n")));
    }
    #[test]
    fn passwords_with_umlauts_reach_powershell() {
        let s = ascii_json(&json!({ "p": "Müller€😀" }));
        assert!(s.is_ascii());
        assert_eq!(serde_json::from_str::<Value>(&s).unwrap()["p"], "Müller€😀");
    }
    #[test]
    fn penalties() {
        let elig = vec![
            json!({ "queueId": 420, "restrictions": [{ "restrictionCode": "PlayerMinLevelRestriction" }, { "restrictionCode": "PlayerTimedRestriction", "expiredTimestamp": 500 }] }),
            json!({ "queueId": 400, "restrictions": [{ "restrictionCode": "PlayerTimedRestriction", "expiredTimestamp": 900 }, { "restrictionCode": "TeamSizeRestriction" }] }),
        ];
        let p = penalties_of(&elig);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0]["code"], "PlayerTimedRestriction");
        assert_eq!(p[0]["until"], 900);
        let s = json!({ "lowPriorityData": { "penaltyTime": 300.0, "penaltyTimeRemaining": 120.5 }, "errors": [{ "errorType": "QUEUE_DODGER", "penaltyTimeRemaining": 60 }] });
        let w = queue_waits(&s, 1000);
        assert_eq!(
            w[0],
            json!({ "code": "LowPriorityQueue", "until": 121_500, "total": 300 })
        );
        assert_eq!(w[1], json!({ "code": "QUEUE_DODGER", "until": 61_000 }));
        assert!(queue_waits(
            &json!({ "lowPriorityData": { "penaltyTimeRemaining": 0 } }),
            1
        )
        .is_empty());
        assert_eq!(low_prio_secs(&s), 300);
        assert_eq!(low_prio_secs(&json!({ "searchState": "Searching" })), 0);
        let n = leaver_notices_of(&[
            json!({ "type": "PunishedGamesRemaining", "punishedGamesRemaining": 2 }),
            json!({ "type": "Reminder" }),
        ]);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0]["games"], 2);
        // not penalties: what the client says while a game runs or it can't check
        for c in [
            "Unknown",
            "GameVersionMissing",
            "PlayerInGameRestriction",
            "PlayerMinLevelRestriction",
            "TeamSizeRestriction",
            "QueueDisabled",
        ] {
            assert!(!is_penalty(c), "{c}");
        }
        for c in [
            "PlayerTimedRestriction",
            "PlayerLeaverBustedRestriction",
            "PlayerBannedRestriction",
            "PlayerRankedSuspensionRestriction",
            "QUEUE_DODGER",
            "LowPriorityQueue",
        ] {
            assert!(is_penalty(c), "{c}");
        }
        assert!(
            is_transient("GameVersionMissing")
                && is_transient("Unknown")
                && !is_transient("PlayerTimedRestriction")
        );
    }
    #[test]
    fn regions() {
        assert_eq!(platform_region("PBE1"), "PBE");
        assert_eq!(platform_region("euw1"), "EUW");
        assert_eq!(platform_region(""), "");
    }

    #[test]
    fn collection_owned_and_loot() {
        let c = collection_of(
            &json!([{ "id": 103, "ownership": { "owned": true } }, { "id": 1, "ownership": { "owned": false } }, { "id": -1, "ownership": { "owned": true } }]),
            &json!([{ "id": 103000, "isBase": true, "name": "Ahri", "ownership": { "owned": true } },
                    { "id": 103001, "isBase": false, "name": "Dynasty Ahri", "tilePath": "/t/1.jpg", "ownership": { "owned": true } },
                    { "id": 103002, "isBase": false, "name": "Midnight Ahri", "ownership": { "owned": false } }]),
            &json!([{ "type": "CHAMPION_RENTAL", "storeItemId": 22, "count": 2, "itemDesc": "Ashe" },
                    { "type": "SKIN_RENTAL", "storeItemId": 103015, "count": 1, "itemDesc": "Arcade Ahri" },
                    { "type": "CURRENCY", "storeItemId": 0, "count": 500 },
                    { "type": "CHAMPION", "storeItemId": 1, "count": 0, "itemDesc": "Annie" }]),
        );
        assert_eq!(c["champs"], json!([103]));
        let empty = collection_of(
            &json!({ "errorCode": "RPC_ERROR" }),
            &json!([]),
            &Value::Null,
        );
        assert!(
            empty.get("champs").is_none()
                && empty.get("skins").is_none()
                && empty.get("shards").is_none()
        );
        let modes = collection_of(
            &json!([{ "id": 60083, "ownership": { "owned": true } }, { "id": 83, "ownership": { "owned": true } }]),
            &json!([{ "id": 60083001, "name": "Undertaker Yorick", "ownership": { "owned": true } },
                    { "id": 83001, "name": "Undertaker Yorick", "ownership": { "owned": true } }]),
            &json!([]),
        );
        assert_eq!(modes["champs"], json!([83]));
        assert_eq!(modes["skins"].as_array().unwrap().len(), 1);
        assert_eq!(c["skins"], json!([[103001, "Dynasty Ahri", "/t/1.jpg"]]));
        assert_eq!(
            c["shards"],
            json!([
                ["c", 22, 2, "Ashe", ""],
                ["s", 103015, 1, "Arcade Ahri", ""]
            ])
        );
    }
}
