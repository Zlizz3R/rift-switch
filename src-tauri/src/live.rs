//! "Live" data: lobby, champion select, the running game, Clash opponents; the champion list,
//! item/rune icons (CommunityDragon, cached a day) and matchup win rates for the helper.
//! Only asked while the window shows the Live page.

use crate::riot::{self, get, lcu, now_ms, web_client};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone, Default)]
struct Ref {
    puuid: String,
    summoner_id: String,
    position: String,
    champion_id: Value,
}

static PLAYERS: Mutex<Option<HashMap<String, (i64, Value)>>> = Mutex::new(None);

/// Riot ID + Solo/Duo + Flex of a player (by puuid or summoner id), cached 5 minutes.
async fn player(r: Ref) -> Option<Value> {
    let key = if r.puuid.is_empty() {
        format!("s{}", r.summoner_id)
    } else {
        r.puuid.clone()
    };
    let cached = PLAYERS
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .get(&key)
        .cloned();
    let mut p = match cached {
        Some((at, p)) if now_ms() - at < 300_000 => p,
        _ => {
            let s = if !r.puuid.is_empty() {
                riot::summoner_by_puuid(&r.puuid).await
            } else {
                get(&format!("/lol-summoner/v1/summoners/{}", r.summoner_id)).await
            }?;
            let puuid = s["puuid"].as_str().filter(|x| !x.is_empty())?.to_string();
            let rk = riot::ranked_for(&puuid, false).await.unwrap_or_default();
            let name = s["gameName"]
                .as_str()
                .filter(|x| !x.is_empty())
                .or(s["displayName"].as_str())
                .unwrap_or("");
            let p = json!({ "puuid": puuid, "gameName": name, "tagLine": s["tagLine"].as_str().unwrap_or(""),
                "iconId": s["profileIconId"], "level": s["summonerLevel"], "solo": rk.get("solo"), "flex": rk.get("flex") });
            let mut cache = PLAYERS.lock().unwrap();
            let c = cache.get_or_insert_with(HashMap::new);
            if c.len() > 300 {
                c.retain(|_, (at, _)| now_ms() - *at < 300_000); // bounded: expired players go
            }
            c.insert(key, (now_ms(), p.clone()));
            p
        }
    };
    p["position"] = json!(r.position);
    p["summonerId"] = json!(r.summoner_id);
    p["championId"] = if r.champion_id.is_null() {
        json!(0)
    } else {
        r.champion_id
    };
    Some(p)
}
/// One player by puuid (the player page): Riot ID, icon, level, Solo/Duo and Flex (cached 5 minutes).
pub async fn player_info(puuid: &str) -> Option<Value> {
    player(Ref {
        puuid: puuid.to_string(),
        ..Default::default()
    })
    .await
}
async fn players(refs: Vec<Ref>) -> Vec<Value> {
    futures_util::future::join_all(refs.into_iter().map(player))
        .await
        .into_iter()
        .flatten()
        .collect()
}
fn sv(v: &Value, k: &str) -> String {
    match &v[k] {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
/// A champion select cell of a player who can be looked up. Riot's policies: no product may
/// identify or analyse players the game deliberately hides – a hidden cell (nameVisibilityType
/// HIDDEN, or no id: its obfuscated ids are never used) shows only its champion and position.
fn has_id(v: &Value) -> bool {
    if sv(v, "nameVisibilityType").eq_ignore_ascii_case("hidden") {
        return false;
    }
    let sid = sv(v, "summonerId");
    !sv(v, "puuid").is_empty() || (!sid.is_empty() && sid != "0")
}
fn or_zero(a: &Value, b: &Value) -> Value {
    if a.as_f64().is_some_and(|x| x != 0.0) {
        a.clone()
    } else if b.as_f64().is_some_and(|x| x != 0.0) {
        b.clone()
    } else {
        json!(0)
    }
}

/// The members of the own lobby when it was last seen (when, puuids): they are a party in the game
/// that follows – the client shows no parties once the game has started.
static PARTY: Mutex<(i64, Vec<String>)> = Mutex::new((0, Vec::new()));
/// A lobby is a party for this long after it was last seen (queue, champion select, a long game).
const PARTY_AGE: i64 = 3 * 3600 * 1000;
fn note_party(lb: &Value) {
    let ids: Vec<String> = lb["members"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            m["puuid"]
                .as_str()
                .filter(|p| !p.is_empty())
                .map(String::from)
        })
        .collect();
    *PARTY.lock().unwrap_or_else(|e| e.into_inner()) = (now_ms(), ids);
}
/// Read the own lobby (called while in the lobby or the queue, also without the window).
pub async fn watch_party() {
    if let Some(lb) = lcu("/lol-lobby/v2/lobby", 3000, "GET").await {
        note_party(&lb);
    }
}
/// The own party of the game being played: the last lobby's members, if more than one and recent.
pub fn party() -> Vec<String> {
    let p = PARTY.lock().unwrap_or_else(|e| e.into_inner());
    party_of(&p, now_ms())
}
fn party_of(p: &(i64, Vec<String>), now: i64) -> Vec<String> {
    if p.1.len() > 1 && now - p.0 < PARTY_AGE {
        p.1.clone()
    } else {
        vec![]
    }
}

async fn lobby() -> Option<Value> {
    let lb = lcu("/lol-lobby/v2/lobby", 3000, "GET").await?;
    note_party(&lb);
    let members = lb["members"].as_array()?;
    let refs = members
        .iter()
        .map(|m| Ref {
            puuid: sv(m, "puuid"),
            summoner_id: sv(m, "summonerId"),
            position: sv(m, "firstPositionPreference"),
            ..Default::default()
        })
        .collect();
    let queue = lb["gameConfig"]["queueId"].as_i64().unwrap_or(0);
    let (mut members, elig, search) = tokio::join!(
        players(refs),
        lcu("/lol-lobby/v2/eligibility/party", 3000, "POST"),
        lcu("/lol-matchmaking/v1/search", 2000, "GET"),
    );
    // whose penalty it is: the client names the summoner of each restriction of the party
    let pens = member_penalties(elig.as_ref(), search.as_ref(), queue, now_ms());
    for m in members.iter_mut() {
        if let Some(l) = pens.get(m["summonerId"].as_str().unwrap_or("")) {
            m["penalties"] = json!(l);
        }
    }
    Some(json!({ "queueId": lb["gameConfig"]["queueId"], "members": members }))
}

/// The penalties of the lobby's members by summoner id: the party's eligibility for this queue
/// (each restriction names its summoners) and a running queue's waits (low priority, lockouts).
fn member_penalties(
    elig: Option<&Value>,
    search: Option<&Value>,
    queue: i64,
    now: i64,
) -> HashMap<String, Vec<Value>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    let ids = |v: &Value| -> Vec<String> {
        let mut l: Vec<String> = v["summonerIds"]
            .as_array()
            .into_iter()
            .flatten()
            .map(id_of)
            .filter(|s| !s.is_empty())
            .collect();
        if let Some(s) = v["summonerIdsString"].as_str() {
            l.extend(
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty()),
            );
        }
        l.sort();
        l.dedup();
        l
    };
    let mut add = |id: String, p: Value| {
        let l = out.entry(id).or_default();
        if !l.iter().any(|x| x["code"] == p["code"]) {
            l.push(p);
        }
    };
    let q = elig
        .and_then(Value::as_array)
        .and_then(|l| l.iter().find(|x| x["queueId"].as_i64() == Some(queue)));
    for r in q
        .map(|q| &q["restrictions"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let code = r["restrictionCode"].as_str().unwrap_or("");
        if !riot::is_penalty(code) {
            continue;
        }
        let until = r["expiredTimestamp"].as_i64().unwrap_or(0);
        for id in ids(r) {
            add(
                id,
                json!({ "code": code, "args": if r["restrictionArgs"].is_null() { json!({}) } else { r["restrictionArgs"].clone() }, "until": until }),
            );
        }
    }
    if let Some(s) = search {
        let lp = &s["lowPriorityData"];
        let secs = lp["penaltyTimeRemaining"].as_f64().unwrap_or(0.0);
        for id in lp["penalizedSummonerIds"]
            .as_array()
            .into_iter()
            .flatten()
            .map(id_of)
        {
            add(
                id,
                json!({ "code": "LowPriorityQueue", "until": if secs > 0.0 { now + (secs * 1000.0) as i64 } else { 0 }, "low": lp["penaltyTime"].as_f64().unwrap_or(0.0) as i64 }),
            );
        }
        for e in s["errors"].as_array().into_iter().flatten() {
            let secs = e["penaltyTimeRemaining"].as_f64().unwrap_or(0.0);
            let id = id_of(&e["penalizedSummonerId"]);
            if secs > 0.0 && !id.is_empty() {
                add(
                    id,
                    json!({ "code": e["errorType"].as_str().unwrap_or("QueueLockout"), "until": now + (secs * 1000.0) as i64 }),
                );
            }
        }
    }
    out
}
fn id_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

async fn champ_select() -> Option<Value> {
    let cs = lcu("/lol-champ-select/v1/session", 3000, "GET").await?;
    let my = cs["myTeam"].as_array()?;
    let me = my
        .iter()
        .find(|c| c["cellId"] == cs["localPlayerCellId"])
        .cloned()
        .unwrap_or(json!({}));
    let refs: Vec<Ref> = my
        .iter()
        .filter(|c| has_id(c))
        .map(|c| Ref {
            puuid: sv(c, "puuid"),
            summoner_id: sv(c, "summonerId"),
            position: sv(c, "assignedPosition"),
            champion_id: or_zero(&c["championId"], &c["championPickIntent"]),
        })
        .collect();
    let allies = players(refs).await;
    let enemies: Vec<Value> = cs["theirTeam"].as_array().into_iter().flatten()
        .map(|c| json!({ "championId": or_zero(&c["championId"], &c["championPickIntent"]), "position": sv(c, "assignedPosition") })).collect();
    let hidden = my.len() > allies.len();
    // every cell of the own team, also the ones whose names are hidden: champion and position
    let team: Vec<Value> = my.iter()
        .map(|c| json!({ "championId": or_zero(&c["championId"], &c["championPickIntent"]), "position": sv(c, "assignedPosition"), "me": c["cellId"] == cs["localPlayerCellId"] })).collect();
    Some(
        json!({ "myPosition": sv(&me, "assignedPosition"), "myChampion": or_zero(&me["championId"], &me["championPickIntent"]),
        "allies": allies, "team": team, "enemies": enemies, "hiddenNames": hidden }),
    )
}

/// Both teams of the running game (names are visible once the game has started).
async fn in_game() -> Option<Value> {
    let s = lcu("/lol-gameflow/v1/session", 3000, "GET").await?;
    let gd = &s["gameData"];
    let team = |t: &Value| -> Vec<Ref> {
        t.as_array()
            .into_iter()
            .flatten()
            .filter(|p| has_id(p))
            .map(|p| Ref {
                puuid: sv(p, "puuid"),
                summoner_id: sv(p, "summonerId"),
                position: sv(p, "selectedPosition"),
                champion_id: p["championId"].clone(),
            })
            .collect()
    };
    if !gd["teamOne"].is_array() || !gd["teamTwo"].is_array() {
        return None;
    }
    let (one, two) = tokio::join!(players(team(&gd["teamOne"])), players(team(&gd["teamTwo"])));
    Some(json!({ "queueId": gd["queue"]["id"], "teamOne": one, "teamTwo": two, "party": party() }))
}

static CLASH: Mutex<Option<(i64, Value)>> = Mutex::new(None);
static CLASH_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Clash never holds the page up: the last answer right away (nothing the first time), a fresh
/// one is fetched in the background once a minute – the next poll shows it.
async fn clash() -> Value {
    use std::sync::atomic::Ordering;
    let last = CLASH.lock().unwrap().clone();
    let fresh = last.as_ref().is_some_and(|(at, _)| now_ms() - at < 60_000);
    if !fresh && !CLASH_BUSY.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(async {
            let v = clash_fresh().await.unwrap_or(Value::Null);
            *CLASH.lock().unwrap() = Some((now_ms(), v));
            CLASH_BUSY.store(false, Ordering::SeqCst);
        });
    }
    last.map(|(_, v)| v).unwrap_or(Value::Null)
}
async fn clash_fresh() -> Option<Value> {
    let sum = lcu("/lol-clash/v1/tournament-summary", 3000, "GET").await?;
    let t = sum.as_array()?.first()?.clone();
    let (bracket, roster) = (sv(&t, "bracketId"), sv(&t, "rosterId"));
    if bracket.is_empty() || roster.is_empty() {
        return None;
    }
    let state = t["state"].clone();
    let Some(br) = lcu(&format!("/lol-clash/v1/bracket/{bracket}"), 4000, "GET")
        .await
        .filter(|b| b["matches"].is_array())
    else {
        return Some(json!({ "state": state, "opponents": [] }));
    };
    let mine = br["matches"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| sv(m, "rosterId1") == roster || sv(m, "rosterId2") == roster)
        .find(|m| m["status"] != "COMPLETE")
        .cloned();
    let Some(mine) = mine else {
        return Some(json!({ "state": state, "opponents": [] }));
    };
    let opp = if sv(&mine, "rosterId1") == roster {
        sv(&mine, "rosterId2")
    } else {
        sv(&mine, "rosterId1")
    };
    if opp.is_empty() {
        return Some(json!({ "state": state, "round": mine["round"], "opponents": [] }));
    }
    let ro = lcu(&format!("/lol-clash/v1/roster/{opp}"), 4000, "GET")
        .await
        .unwrap_or(json!({}));
    let refs = ro["members"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|m| Ref {
            summoner_id: sv(m, "summonerId"),
            position: sv(m, "position"),
            ..Default::default()
        })
        .collect();
    Some(
        json!({ "state": state, "round": mine["round"], "teamName": ro["name"].as_str().unwrap_or(""), "teamTag": ro["shortName"].as_str().unwrap_or(""),
        "opponents": players(refs).await }),
    )
}

// ---------- the game that just ended: the end-of-game numbers ----------
// The client has the end-of-game block (/lol-end-of-game/v1/eog-stats-block) as soon as its end
// screen opens – while the players still honor each other, long before the match history lists the
// game. Live shows the game from it at once (a short form of the stored game: the ten players, K/D/A,
// CS, gold, damage, vision, items); the stored game replaces it when it comes.
const POST_PHASES: [&str; 3] = ["WaitingForStats", "PreEndOfGame", "EndOfGame"];
/// (when read, the game) of the last end-of-game block
static EOG: Mutex<Option<(i64, Value)>> = Mutex::new(None);
/// A number of the block's stats: Riot's old stat names (CHAMPIONS_KILLED …), any of the given keys
fn eog_stat(s: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|k| s.get(*k).filter(|v| !v.is_null()))
        .map(|v| crate::accounts::num_of(Some(v)) as i64)
        .unwrap_or(0)
}
/// The queue of a block: its own id, else its name (the common ones), else the game session's
fn eog_queue(b: &Value, session_q: i64) -> i64 {
    if let Some(q) = b["queueId"].as_i64().filter(|q| *q > 0) {
        return q;
    }
    match b["queueType"].as_str().unwrap_or("") {
        "RANKED_SOLO_5x5" => 420,
        "RANKED_FLEX_SR" => 440,
        "ARAM_UNRANKED_5x5" => 450,
        _ => session_q,
    }
}
/// The end-of-game block → a game in the stored games' form (with "eog": true), or None
pub fn eog_game(b: &Value, session_q: i64, now: i64) -> Option<Value> {
    let id = b["gameId"].as_i64().filter(|x| *x > 0)?;
    let dur = crate::accounts::num_of(b.get("gameLength")) as i64;
    let mut players = vec![];
    for tm in b["teams"].as_array()? {
        let team = tm["teamId"].as_i64().unwrap_or(0);
        let win = tm["isWinningTeam"] == true;
        for p in tm["players"].as_array().into_iter().flatten() {
            let s = &p["stats"];
            let st = |k: &[&str]| eog_stat(s, k);
            let mut items: Vec<i64> = p["items"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|x| x.as_i64().unwrap_or(0))
                .take(7)
                .collect();
            items.resize(7, 0);
            let aug: Vec<i64> = (1..=6)
                .map(|i| st(&[&format!("PLAYER_AUGMENT_{i}"), &format!("playerAugment{i}")]))
                .filter(|n| *n > 0)
                .collect();
            let name = p["riotIdGameName"]
                .as_str()
                .filter(|x| !x.is_empty())
                .or(p["gameName"].as_str())
                .or(p["summonerName"].as_str())
                .unwrap_or("");
            let mut o = json!({
                "puuid": p["puuid"].as_str().unwrap_or(""), "name": name,
                "tag": p["riotIdTagLine"].as_str().or(p["tagLine"].as_str()).unwrap_or(""),
                "team": p["teamId"].as_i64().unwrap_or(team), "champ": p["championId"].as_i64().unwrap_or(0),
                "lvl": st(&["LEVEL", "level"]).max(p["championLevel"].as_i64().unwrap_or(0)),
                "k": st(&["CHAMPIONS_KILLED", "kills"]), "d": st(&["NUM_DEATHS", "deaths"]), "a": st(&["ASSISTS", "assists"]),
                "cs": st(&["MINIONS_KILLED", "totalMinionsKilled"]) + st(&["NEUTRAL_MINIONS_KILLED", "neutralMinionsKilled"]),
                "gold": st(&["GOLD_EARNED", "goldEarned"]), "dmg": st(&["TOTAL_DAMAGE_DEALT_TO_CHAMPIONS", "totalDamageDealtToChampions"]),
                "vis": st(&["VISION_SCORE", "visionScore"]), "items": items,
                "spells": [p["spell1Id"].as_i64().unwrap_or(0), p["spell2Id"].as_i64().unwrap_or(0)],
                "keystone": st(&["PERK0", "perk0"]), "sub": st(&["PERK_SUB_STYLE", "perkSubStyle"]),
                "win": win, "multi": st(&["LARGEST_MULTI_KILL", "largestMultiKill"]),
            });
            let taken = st(&["TOTAL_DAMAGE_TAKEN", "totalDamageTaken"]);
            if taken > 0 {
                o["x"] = json!({ "taken": taken });
            }
            if !aug.is_empty() {
                o["aug"] = json!(aug);
            }
            players.push(o);
        }
    }
    if players.len() < 2 {
        return None;
    }
    Some(
        json!({ "id": id.to_string(), "t": now - dur * 1000, "dur": dur, "q": eog_queue(b, session_q),
        "mode": b["gameMode"].as_str().unwrap_or(""), "remake": dur > 0 && dur < 300, "players": players, "eog": true }),
    )
}
/// A new end-of-game block (the client's event, or read in an end phase): kept as the game; the raw
/// block also goes to eog-last.json in the data folder (to check the conversion against it).
pub fn set_eog(b: &Value, session_q: i64, data_dir: &Path) {
    let Some(g) = eog_game(b, session_q, now_ms()) else {
        return;
    };
    let mut last = EOG.lock().unwrap();
    if last.as_ref().is_some_and(|(_, x)| x["id"] == g["id"]) {
        return;
    }
    *last = Some((now_ms(), g));
    let _ = std::fs::write(data_dir.join("eog-last.json"), b.to_string());
}
/// The last game from its end-of-game block (12 hours at most)
pub fn last_eog() -> Value {
    EOG.lock()
        .unwrap()
        .as_ref()
        .filter(|(at, _)| now_ms() - at < 12 * 3600 * 1000)
        .map(|(_, g)| g.clone())
        .unwrap_or(Value::Null)
}
/// The queue of the game session (it stays through the end screens)
async fn session_queue() -> i64 {
    lcu("/lol-gameflow/v1/session", 2000, "GET")
        .await
        .and_then(|s| s["gameData"]["queue"]["id"].as_i64())
        .unwrap_or(0)
}
/// In an end phase without the block yet: read it (the event may have come before the window)
pub async fn read_eog(data_dir: &Path) {
    if let Some(b) = lcu("/lol-end-of-game/v1/eog-stats-block", 2500, "GET").await {
        if b["gameId"].as_i64().is_some_and(|x| x > 0) {
            set_eog(&b, session_queue().await, data_dir);
        }
    }
}
pub async fn eog_event(b: Value, data_dir: std::path::PathBuf) {
    if b["gameId"].as_i64().is_some_and(|x| x > 0) {
        set_eog(&b, session_queue().await, &data_dir);
    }
}

/// Everything for the Live view in one go.
pub async fn snapshot(data_dir: &Path) -> Value {
    let Some(phase) = riot::gameflow_phase().await else {
        return json!({ "clientUp": false });
    };
    let p = phase.as_str();
    let (reg, me, lb, cs, cl, ig) = tokio::join!(
        lcu("/riotclient/region-locale", 2000, "GET"),
        get("/lol-summoner/v1/current-summoner"),
        async {
            if ["Lobby", "Matchmaking", "ReadyCheck"].contains(&p) {
                lobby().await
            } else {
                None
            }
        },
        async {
            if p == "ChampSelect" {
                champ_select().await
            } else {
                None
            }
        },
        clash(),
        async {
            if ["GameStart", "InProgress", "Reconnect"].contains(&p) {
                in_game().await
            } else {
                None
            }
        },
    );
    let me = me.map(|m| m["puuid"].clone()).unwrap_or(Value::Null);
    // the end screens: the game that just ended, from its end-of-game numbers
    if POST_PHASES.contains(&p) {
        let have = EOG
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|(at, _)| now_ms() - at < 15 * 60_000);
        if !have {
            read_eog(data_dir).await;
        }
    }
    json!({ "clientUp": true, "phase": phase, "region": reg.map(|r| r["region"].clone()).unwrap_or(json!("")),
        "lobby": lb, "champSelect": cs, "clash": cl, "inGame": ig, "me": me, "eog": last_eog() })
}

// ---------- CommunityDragon (cached a day) ----------

async fn web_text(url: &str, timeout_s: u64) -> Option<(u16, String)> {
    let r = web_client()
        .get(url)
        .timeout(Duration::from_secs(timeout_s))
        .send()
        .await
        .ok()?;
    let st = r.status().as_u16();
    Some((st, r.text().await.ok()?))
}
async fn web_json(url: &str, timeout_s: u64) -> Option<Value> {
    let (st, t) = web_text(url, timeout_s).await?;
    if st != 200 {
        None
    } else {
        serde_json::from_str(&t).ok()
    }
}
fn cached(file: &Path, check: impl Fn(&Value) -> bool) -> Option<Value> {
    let c: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    (now_ms() - c["at"].as_i64().unwrap_or(0) < 86_400_000 && check(&c)).then_some(c)
}

/// Each champion's damage type from CommunityDragon ("kPhysical" / "kMagic" / "kMixed"), only for
/// the champions asked for (at most 10 new ones a call), kept on disk – it hardly ever changes.
pub async fn damage_types(data_dir: &Path, ids: &[i64]) -> Value {
    let file = data_dir.join("champion-damage.json");
    let mut known: crate::accounts::Obj = std::fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let missing: Vec<i64> = ids
        .iter()
        .copied()
        .filter(|i| *i > 0 && *i < 10_000 && !known.contains_key(&i.to_string()))
        .take(10)
        .collect();
    let got = futures_util::future::join_all(missing.iter().map(|id| async move {
        let url = format!("https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/{id}.json");
        let t = web_json(&url, 6).await.and_then(|v| v["tacticalInfo"]["damageType"].as_str().map(String::from));
        (*id, t)
    }))
    .await;
    let mut changed = false;
    for (id, t) in got {
        if let Some(t) = t {
            known.insert(id.to_string(), json!(t));
            changed = true;
        }
    }
    if changed {
        let _ = std::fs::write(&file, Value::Object(known.clone()).to_string());
    }
    Value::Object(
        ids.iter()
            .filter_map(|i| {
                known
                    .get(&i.to_string())
                    .map(|t| (i.to_string(), t.clone()))
            })
            .collect(),
    )
}

static CHAMPS: Mutex<Option<Value>> = Mutex::new(None);
pub async fn champions(data_dir: &Path) -> Value {
    if let Some(c) = CHAMPS.lock().unwrap().clone() {
        return c;
    }
    let file = data_dir.join("champions.json");
    if let Some(c) = cached(&file, |c| {
        c["list"].as_array().is_some_and(|l| !l.is_empty())
    }) {
        *CHAMPS.lock().unwrap() = Some(c["list"].clone());
        return c["list"].clone();
    }
    // older than a day: use it now, fetch the new one in the background (new champions appear
    // a few seconds later instead of the page waiting for the download)
    let old = std::fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|c| c["list"].clone())
        .filter(|l| l.as_array().is_some_and(|l| !l.is_empty()));
    if let Some(old) = old {
        *CHAMPS.lock().unwrap() = Some(old.clone());
        let dir = data_dir.to_path_buf();
        // a good download replaces the list (memory + file); a failed one keeps the old list
        tauri::async_runtime::spawn(async move {
            fetch_champions(&dir).await;
        });
        return old;
    }
    fetch_champions(data_dir).await
}
async fn fetch_champions(data_dir: &Path) -> Value {
    let file = data_dir.join("champions.json");
    let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
    let mut list: Vec<Value> = vec![];
    if let Some(Value::Array(all)) = web_json(url, 6).await {
        let mut seen = std::collections::HashSet::new();
        for c in all {
            let id = c["id"].as_i64().unwrap_or(0);
            let name = c["name"].as_str().unwrap_or("").to_string();
            if id > 0 && id < 3000 && seen.insert(name.clone()) {
                list.push(json!({ "id": id, "name": name, "alias": c["alias"] }));
            }
        }
    }
    if !list.is_empty() {
        list.sort_by(|a, b| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
        });
        let _ = std::fs::write(&file, json!({ "at": now_ms(), "list": list }).to_string());
        *CHAMPS.lock().unwrap() = Some(json!(list));
    }
    json!(list)
}

const GAME_DATA: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";
fn asset_url(p: &str) -> String {
    let lower = p.to_lowercase();
    format!(
        "{GAME_DATA}{}",
        lower
            .strip_prefix("/lol-game-data/assets/")
            .unwrap_or(&lower)
    )
}
/// cherry-augments.json (Arena and ARAM: Mayhem) → { id: [icon, name, rarity] } – rarity as the
/// game names it without the "k" (Silver, Gold, Prismatic)
pub fn augments_of(list: Option<&Value>) -> Value {
    Value::Object(
        list.and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|x| {
                let icon = x["augmentSmallIconPath"]
                    .as_str()
                    .filter(|s| !s.is_empty())?;
                let rarity = x["rarity"]
                    .as_str()
                    .unwrap_or("")
                    .trim_start_matches('k')
                    .to_lowercase();
                Some((
                    x["id"].as_i64()?.to_string(),
                    json!([asset_url(icon), x["nameTRA"], rarity]),
                ))
            })
            .collect(),
    )
}
static ASSETS: Mutex<Option<Value>> = Mutex::new(None);
static ASSETS_FAILED: Mutex<i64> = Mutex::new(0);
pub async fn game_assets(data_dir: &Path) -> Value {
    if let Some(a) = ASSETS.lock().unwrap().clone() {
        return a;
    }
    let file = data_dir.join("assets.json");
    // (a cache without the augments is from before they were shown: read again)
    if let Some(c) = cached(&file, |c| {
        c["items"].as_object().is_some_and(|o| !o.is_empty()) && c.get("augments").is_some()
    }) {
        *ASSETS.lock().unwrap() = Some(c.clone());
        return c;
    }
    // offline: don't ask the internet again on every page refresh, only every 5 minutes
    let empty = json!({ "items": {}, "spells": {}, "perks": {}, "styles": {}, "augments": {} });
    if now_ms() - *ASSETS_FAILED.lock().unwrap() < 300_000 {
        return empty;
    }
    let f = |n: &str| format!("{GAME_DATA}v1/{n}");
    let (u1, u2, u3, u4, u5) = (
        f("items.json"),
        f("summoner-spells.json"),
        f("perks.json"),
        f("perkstyles.json"),
        f("cherry-augments.json"),
    );
    let (items, spells, perks, styles, augs) = tokio::join!(
        web_json(&u1, 10),
        web_json(&u2, 10),
        web_json(&u3, 10),
        web_json(&u4, 10),
        web_json(&u5, 10)
    );
    let map = |list: Option<&Value>| -> Value {
        Value::Object(
            list.and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|x| {
                    Some((
                        x["id"].as_i64()?.to_string(),
                        json!([asset_url(x["iconPath"].as_str()?), x["name"]]),
                    ))
                })
                .collect(),
        )
    };
    let out = json!({ "at": now_ms(), "items": map(items.as_ref()), "spells": map(spells.as_ref()), "perks": map(perks.as_ref()),
        "styles": map(styles.as_ref().map(|s| &s["styles"])), "augments": augments_of(augs.as_ref()) });
    if out["items"].as_object().is_none_or(|o| o.is_empty()) {
        *ASSETS_FAILED.lock().unwrap() = now_ms();
        return empty; // offline: try again later
    }
    let _ = std::fs::write(&file, out.to_string());
    *ASSETS.lock().unwrap() = Some(out.clone());
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn end_of_game_block_becomes_a_game() {
        use serde_json::json;
        let pl = |i: i64, team: i64| {
            json!({ "puuid": format!("p{i}"), "riotIdGameName": format!("N{i}"), "riotIdTagLine": "EUW", "championId": 100 + i,
            "teamId": team, "spell1Id": 4, "spell2Id": 14, "items": [3031, 0, 0, 0, 0, 0, 3340],
            "stats": { "CHAMPIONS_KILLED": i, "NUM_DEATHS": 2, "ASSISTS": 3, "MINIONS_KILLED": 150, "NEUTRAL_MINIONS_KILLED": 10, "GOLD_EARNED": 9000 + i,
                "TOTAL_DAMAGE_DEALT_TO_CHAMPIONS": 20000 + i, "TOTAL_DAMAGE_TAKEN": 15000, "VISION_SCORE": 20, "LEVEL": 16, "PERK0": 8112, "PERK_SUB_STYLE": 8300,
                "PLAYER_AUGMENT_1": if i == 0 { 1390 } else { 0 } } })
        };
        let b = json!({ "gameId": 77, "gameLength": 1800, "gameMode": "CLASSIC", "queueType": "RANKED_SOLO_5x5",
            "teams": [{ "teamId": 100, "isWinningTeam": true, "players": (0..5).map(|i| pl(i, 100)).collect::<Vec<_>>() },
                      { "teamId": 200, "isWinningTeam": false, "players": (5..10).map(|i| pl(i, 200)).collect::<Vec<_>>() }] });
        let g = super::eog_game(&b, 0, 10_000_000).unwrap();
        assert_eq!(g["id"], "77");
        assert_eq!(g["q"], 420);
        assert_eq!(g["t"], 10_000_000 - 1_800_000);
        assert_eq!(g["eog"], true);
        let p = &g["players"][3];
        assert_eq!(
            (
                p["k"].as_i64(),
                p["d"].as_i64(),
                p["a"].as_i64(),
                p["cs"].as_i64()
            ),
            (Some(3), Some(2), Some(3), Some(160))
        );
        assert_eq!(
            (
                p["gold"].as_i64(),
                p["dmg"].as_i64(),
                p["x"]["taken"].as_i64()
            ),
            (Some(9003), Some(20003), Some(15000))
        );
        assert_eq!(p["name"], "N3");
        assert_eq!(p["items"], json!([3031, 0, 0, 0, 0, 0, 3340]));
        assert_eq!(p["win"], true);
        assert_eq!(g["players"][7]["win"], false);
        assert_eq!(g["players"][0]["aug"], json!([1390]));
        // the session's queue when the block names none the app knows
        let mut b2 = b.clone();
        b2["queueType"] = json!("SOMETHING_NEW");
        assert_eq!(super::eog_game(&b2, 1700, 0).unwrap()["q"], 1700);
        assert!(super::eog_game(&json!({ "gameId": 0 }), 0, 0).is_none());
    }
    #[test]
    fn augments_with_icon_name_and_rarity() {
        let a = super::augments_of(Some(&serde_json::json!([
            { "id": 1390, "nameTRA": "Phenomenal Evil", "rarity": "kGold", "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/ARAM_PhenomenalEvil_small.png" },
            { "id": 5, "nameTRA": "No icon", "augmentSmallIconPath": "" }
        ])));
        assert_eq!(a["1390"][1], "Phenomenal Evil");
        assert_eq!(a["1390"][2], "gold");
        assert!(a["1390"][0]
            .as_str()
            .unwrap()
            .ends_with("assets/ux/kiwi/augments/icons/aram_phenomenalevil_small.png"));
        assert!(a.get("5").is_none());
    }
    #[test]
    fn lobby_penalties_name_their_player() {
        let elig = serde_json::json!([
            { "queueId": 440, "restrictions": [{ "restrictionCode": "QueueLockout", "summonerIds": [9] }] },
            { "queueId": 420, "restrictions": [
                { "restrictionCode": "QueueDodger", "summonerIds": [7], "expiredTimestamp": 5000, "restrictionArgs": { "x": 1 } },
                { "restrictionCode": "TeamSizeRestriction", "summonerIds": [7, 8] },
                { "restrictionCode": "LeaverBusted", "summonerIdsString": "8, 7" } ] }
        ]);
        let search = serde_json::json!({ "lowPriorityData": { "penalizedSummonerIds": [8], "penaltyTime": 60, "penaltyTimeRemaining": 30 },
            "errors": [{ "errorType": "QUEUE_DODGER", "penaltyTimeRemaining": 10, "penalizedSummonerId": 7 }] });
        let p = super::member_penalties(Some(&elig), Some(&search), 420, 1000);
        let codes = |id: &str| {
            p.get(id)
                .map(|l| {
                    l.iter()
                        .map(|x| x["code"].as_str().unwrap().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        assert_eq!(
            codes("7"),
            vec!["QueueDodger", "LeaverBusted", "QUEUE_DODGER"]
        );
        assert_eq!(codes("8"), vec!["LeaverBusted", "LowPriorityQueue"]);
        // another queue's restriction and a team-size one are no penalty of anyone here
        assert!(codes("9").is_empty());
        assert_eq!(p["8"][1]["until"], 31_000);
        assert_eq!(p["8"][1]["low"], 60);
        assert_eq!(p["7"][0]["until"], 5000);
        assert!(super::member_penalties(None, None, 420, 0).is_empty());
    }

    #[test]
    fn lobby_party_only_with_others_and_recent() {
        let now = 10 * 3600 * 1000;
        let two = (now - 1000, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(super::party_of(&two, now), vec!["a", "b"]);
        // alone in the lobby: no party
        assert!(super::party_of(&(now, vec!["a".to_string()]), now).is_empty());
        // seen too long ago
        assert!(super::party_of(&(now - super::PARTY_AGE - 1, two.1.clone()), now).is_empty());
        let lb =
            serde_json::json!({ "members": [{ "puuid": "x" }, { "puuid": "" }, { "puuid": "y" }] });
        super::note_party(&lb);
        assert_eq!(super::party(), vec!["x", "y"]);
    }
}
