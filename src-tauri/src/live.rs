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
    p["championId"] = if r.champion_id.is_null() {
        json!(0)
    } else {
        r.champion_id
    };
    Some(p)
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
fn has_id(v: &Value) -> bool {
    !sv(v, "puuid").is_empty() || !sv(v, "summonerId").is_empty()
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

async fn lobby() -> Option<Value> {
    let lb = lcu("/lol-lobby/v2/lobby", 3000, "GET").await?;
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
    Some(json!({ "queueId": lb["gameConfig"]["queueId"], "members": players(refs).await }))
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
    Some(
        json!({ "myPosition": sv(&me, "assignedPosition"), "myChampion": or_zero(&me["championId"], &me["championPickIntent"]),
        "allies": allies, "enemies": enemies, "hiddenNames": hidden }),
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
    Some(json!({ "queueId": gd["queue"]["id"], "teamOne": one, "teamTwo": two }))
}

static CLASH: Mutex<Option<(i64, Value)>> = Mutex::new(None);
async fn clash() -> Value {
    if let Some((at, v)) = CLASH.lock().unwrap().clone() {
        if now_ms() - at < 60_000 {
            return v;
        }
    }
    let v = clash_fresh().await.unwrap_or(Value::Null);
    *CLASH.lock().unwrap() = Some((now_ms(), v.clone()));
    v
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

/// Everything for the Live view in one go.
pub async fn snapshot() -> Value {
    let Some(phase) = riot::gameflow_phase().await else {
        return json!({ "clientUp": false });
    };
    let reg = lcu("/riotclient/region-locale", 2000, "GET").await;
    let p = phase.as_str();
    let (lb, cs, cl, ig) = tokio::join!(
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
    let me = get("/lol-summoner/v1/current-summoner")
        .await
        .map(|m| m["puuid"].clone())
        .unwrap_or(Value::Null);
    json!({ "clientUp": true, "phase": phase, "region": reg.map(|r| r["region"].clone()).unwrap_or(json!("")),
        "lobby": lb, "champSelect": cs, "clash": cl, "inGame": ig, "me": me })
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
static ASSETS: Mutex<Option<Value>> = Mutex::new(None);
static ASSETS_FAILED: Mutex<i64> = Mutex::new(0);
pub async fn game_assets(data_dir: &Path) -> Value {
    if let Some(a) = ASSETS.lock().unwrap().clone() {
        return a;
    }
    let file = data_dir.join("assets.json");
    if let Some(c) = cached(&file, |c| {
        c["items"].as_object().is_some_and(|o| !o.is_empty())
    }) {
        *ASSETS.lock().unwrap() = Some(c.clone());
        return c;
    }
    // offline: don't ask the internet again on every page refresh, only every 5 minutes
    let empty = json!({ "items": {}, "spells": {}, "perks": {}, "styles": {} });
    if now_ms() - *ASSETS_FAILED.lock().unwrap() < 300_000 {
        return empty;
    }
    let f = |n: &str| format!("{GAME_DATA}v1/{n}");
    let (u1, u2, u3, u4) = (
        f("items.json"),
        f("summoner-spells.json"),
        f("perks.json"),
        f("perkstyles.json"),
    );
    let (items, spells, perks, styles) = tokio::join!(
        web_json(&u1, 10),
        web_json(&u2, 10),
        web_json(&u3, 10),
        web_json(&u4, 10)
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
        "styles": map(styles.as_ref().map(|s| &s["styles"])) });
    if out["items"].as_object().is_none_or(|o| o.is_empty()) {
        *ASSETS_FAILED.lock().unwrap() = now_ms();
        return empty; // offline: try again later
    }
    let _ = std::fs::write(&file, out.to_string());
    *ASSETS.lock().unwrap() = Some(out.clone());
    out
}

// ---------- matchup win rate (counterstats.net page; null if its layout changes) ----------

static MATCHUPS: Mutex<Option<HashMap<String, Value>>> = Mutex::new(None);
fn slug(n: &str) -> String {
    match n.to_lowercase().as_str() {
        "nunu & willump" => "nunu".into(),
        "renata glasc" => "renata".into(),
        l => l.chars().filter(|c| c.is_ascii_alphanumeric()).collect(),
    }
}
/// First "dd.d%" between 35 and 65 on the page = the enemy's win rate in that matchup.
pub fn first_rate(text: &str) -> Option<f64> {
    let b = text.as_bytes();
    let mut i = 0;
    while let Some(p) = text[i..].find('%') {
        let end = i + p;
        // walk back over digits and one dot: dd.d or dd.dd directly before '%'
        let mut s = end;
        while s > 0 && (b[s - 1].is_ascii_digit() || b[s - 1] == b'.') {
            s -= 1;
        }
        let num = &text[s..end];
        if let Some((a, c)) = num.split_once('.') {
            let a = if a.len() > 2 { &a[a.len() - 2..] } else { a };
            if a.len() == 2 && (1..=2).contains(&c.len()) && !c.contains('.') {
                if let Ok(v) = format!("{a}.{c}").parse::<f64>() {
                    if (35.0..=65.0).contains(&v) {
                        return Some(v);
                    }
                }
            }
        }
        i = end + 1;
    }
    None
}
/// Win rates found are kept a day (matchups.json in the data folder), like the old helper's cache:
/// a pre-load while queueing lasts all day. Failures are asked again next time.
const MATCHUP_TTL: i64 = 86_400_000;
fn matchup_cache(
    data_dir: &Path,
) -> std::sync::MutexGuard<'static, Option<HashMap<String, Value>>> {
    let mut m = MATCHUPS.lock().unwrap();
    if m.is_none() {
        let now = now_ms();
        let saved: HashMap<String, Value> = std::fs::read_to_string(data_dir.join("matchups.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        *m = Some(
            saved
                .into_iter()
                .filter(|(_, v)| now - v["at"].as_i64().unwrap_or(0) < MATCHUP_TTL)
                .collect(),
        );
    }
    m
}
pub async fn matchup(data_dir: &Path, mine: &str, enemy: &str, lane: &str) -> Value {
    let lane = if ["top", "jungle", "mid", "adc", "support"].contains(&lane) {
        lane
    } else {
        "top"
    };
    let key = format!("{mine}|{enemy}|{lane}");
    if let Some(v) = matchup_cache(data_dir)
        .as_ref()
        .and_then(|c| c.get(&key).cloned())
    {
        if now_ms() - v["at"].as_i64().unwrap_or(0) < MATCHUP_TTL {
            return json!({ "wr": v["wr"], "source": "counterstats.net" });
        }
    }
    let url = format!(
        "https://www.counterstats.net/league-of-legends/{}/vs-{}/{lane}/all",
        slug(enemy),
        slug(mine)
    );
    let wr = match web_text(&url, 4).await {
        Some((200, t)) => first_rate(&t).map(|v| ((100.0 - v) * 10.0).round() / 10.0),
        _ => None,
    };
    if let Some(w) = wr {
        let text = {
            let mut m = matchup_cache(data_dir);
            let c = m.get_or_insert_with(HashMap::new);
            let now = now_ms();
            c.retain(|_, v| now - v["at"].as_i64().unwrap_or(0) < MATCHUP_TTL);
            c.insert(key, json!({ "wr": w, "at": now }));
            serde_json::to_string(&c).unwrap_or_default()
        };
        let _ = crate::store::write_atomic(&data_dir.join("matchups.json"), text.as_bytes());
    }
    json!({ "wr": wr, "source": wr.map(|_| "counterstats.net") })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matchup_rate() {
        assert_eq!(
            first_rate("pick 3.1% ban 12.50% win 47.3% games"),
            Some(47.3)
        );
        assert_eq!(first_rate("nothing"), None);
        assert_eq!(slug("Nunu & Willump"), "nunu");
        assert_eq!(slug("Kai'Sa"), "kaisa");
    }
}
