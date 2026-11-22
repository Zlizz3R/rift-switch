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

/// Everything for the Live view in one go.
pub async fn snapshot() -> Value {
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

// ---------- counters (counterstats.net champion page; empty if its layout changes) ----------
//
// One page per enemy: in each lane it lists every champion with enough games against him,
// with that champion's win rate and counterstats' counter rating (how easy the lane is).
// So one request answers "which of my champions is best against X" for the whole pool.

/// counterstats' address of a champion: "Dr. Mundo" -> "dr-mundo", "Kai'Sa" -> "kaisa",
/// "Nunu & Willump" -> "nunu-willump"
pub fn slug(n: &str) -> String {
    let mut out = String::new();
    for c in n.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if (c == ' ' || c == '&' || c == '-') && !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}
fn unescape(s: &str) -> String {
    s.replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}
/// The "Best picks against …" box of one lane: [{name, wr, rating}], best first.
pub fn parse_counters(page: &str, lane: &str) -> Vec<Value> {
    let Some(start) = page.find(&format!("class=\"collapse\" id=\"{lane}\"")) else {
        return vec![];
    };
    let rest = &page[start..];
    // the lane ends where its "Worst picks" box starts (same champions, reversed)
    let end = rest.find("Worst Picks").unwrap_or(rest.len());
    let sec = &rest[..end];
    let mut out = vec![];
    for row in sec.split("champ-box__row").skip(1) {
        let take = |from: &str, to: &str| -> Option<String> {
            let i = row.find(from)? + from.len();
            let j = row[i..].find(to)? + i;
            Some(row[i..j].to_string())
        };
        let rating = take("<label>", " ")
            .or_else(|| take("<label>", "<"))
            .and_then(|v| v.trim().parse::<f64>().ok());
        let name = take("<span class=\"champion\">", "</span>").map(|v| unescape(&v));
        let wr = take("<span class=\"b\">", "%").and_then(|v| v.trim().parse::<f64>().ok());
        if let (Some(name), Some(wr)) = (name, wr) {
            if (20.0..=80.0).contains(&wr) {
                out.push(json!({ "name": name, "wr": wr, "rating": rating }));
            }
        }
    }
    out
}

/// How many of the champion's games are on this lane (counterstats: "92% Pick Rate" in the lane head).
pub fn lane_share(page: &str, lane: &str) -> Option<f64> {
    let start = page.find(&format!("class=\"collapse\" id=\"{lane}\""))?;
    let head = &page[start..(start + 1500).min(page.len())];
    let end = head.find("% Pick Rate")?;
    let num: String = head[..end]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    num.parse().ok()
}

/// Counters found are kept a day (counters.json in the data folder): a pre-load while queueing
/// lasts all day. Failures are asked again next time.
const COUNTERS_TTL: i64 = 86_400_000;
static COUNTERS: Mutex<Option<HashMap<String, Value>>> = Mutex::new(None);
fn counters_cache(
    data_dir: &Path,
) -> std::sync::MutexGuard<'static, Option<HashMap<String, Value>>> {
    let mut m = COUNTERS.lock().unwrap();
    if m.is_none() {
        // the old per-matchup cache of earlier builds
        let _ = std::fs::remove_file(data_dir.join("matchups.json"));
        let now = now_ms();
        let saved: HashMap<String, Value> = std::fs::read_to_string(data_dir.join("counters.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        *m = Some(
            saved
                .into_iter()
                .filter(|(_, v)| now - v["at"].as_i64().unwrap_or(0) < COUNTERS_TTL)
                .collect(),
        );
    }
    m
}
/// Who does well against `enemy` on `lane`: {list: [{name, wr, rating}], ok}
pub async fn counters(data_dir: &Path, enemy: &str, lane: &str) -> Value {
    let lane = if ["top", "jungle", "mid", "adc", "support"].contains(&lane) {
        lane
    } else {
        "top"
    };
    let key = format!("{}|{lane}", slug(enemy));
    if let Some(v) = counters_cache(data_dir)
        .as_ref()
        .and_then(|c| c.get(&key).cloned())
    {
        return json!({ "list": v["list"], "share": v["share"], "ok": true });
    }
    if crate::riot::offline_test() {
        return json!({ "list": [], "ok": false });
    }
    let url = format!(
        "https://www.counterstats.net/league-of-legends/{}",
        slug(enemy)
    );
    let page = match web_text(&url, 8).await {
        Some((200, t)) => t,
        _ => return json!({ "list": [], "ok": false }),
    };
    // a page without this champion (unknown address) has no lane boxes at all
    let known = page.contains("class=\"collapse\" id=");
    let list = parse_counters(&page, lane);
    let share = lane_share(&page, lane).unwrap_or(0.0);
    if known {
        let text = {
            let mut m = counters_cache(data_dir);
            let c = m.get_or_insert_with(HashMap::new);
            let now = now_ms();
            c.retain(|_, v| now - v["at"].as_i64().unwrap_or(0) < COUNTERS_TTL);
            c.insert(key, json!({ "list": list, "share": share, "at": now }));
            serde_json::to_string(&c).unwrap_or_default()
        };
        let _ = crate::store::write_atomic(&data_dir.join("counters.json"), text.as_bytes());
    }
    json!({ "list": list, "share": share, "ok": known })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counterstats_pages() {
        assert_eq!(slug("Nunu & Willump"), "nunu-willump");
        assert_eq!(slug("Kai'Sa"), "kaisa");
        assert_eq!(slug("Dr. Mundo"), "dr-mundo");
        assert_eq!(slug("Jarvan IV"), "jarvan-iv");
        assert_eq!(slug("Cho'Gath"), "chogath");
        let row = |name: &str, r: &str, wr: u32| {
            format!("<a class=\"champ-box__row\" href=\"x\"><span class=\"rating-bar\" style=\"width: 114px\"><label>{r} <i class=\"icon\"></i></label></span> <div class=\"win-wrap\"> <span class=\"champion\">{name}</span> <span class=\"win\">Win <span class=\"b\">{wr}%</span></span></div></a>")
        };
        let page = format!(
            "<span class=\"collapse\" id=\"mid\"></span>{}<span class=\"collapse\" id=\"top\"></span><h3>Best Picks</h3>{}{}<h3>Worst Picks</h3>{}",
            row("Ahri", "5.0", 51),
            row("Kayle", "6.2", 56),
            row("Cho&#039;Gath", "5.6", 53),
            row("Riven", "3.4", 42)
        );
        let top = parse_counters(&page, "top");
        assert_eq!(top.len(), 2);
        assert_eq!(top[0]["name"], "Kayle");
        assert_eq!(top[0]["wr"], 56.0);
        assert_eq!(top[0]["rating"], 6.2);
        assert_eq!(top[1]["name"], "Cho'Gath");
        assert!(parse_counters(&page, "support").is_empty());
        let head = "<span class=\"collapse\" id=\"top\"><label>Top Lane</label></span><span class=\"tag\">51.32% Win Rate</span><span class=\"tag\">92% Pick Rate</span>";
        assert_eq!(lane_share(head, "top"), Some(92.0));
        assert_eq!(lane_share(head, "mid"), None);
    }
}
