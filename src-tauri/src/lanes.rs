//! The lane table: how often each champion is played on each position, counted per month from every
//! stored game – the own match history and the other players' games (Live and the player pages, full
//! games and the short ones from match lists). Each player of a game counts once, however often the
//! game is stored. The champ select helper guesses the enemies' positions from it (Riot hides them in
//! ranked). Built in the background, kept as `lanes.json` (a few KB); nothing leaves the PC.
//! The same run counts the lane matchups of every game with all ten players (who met whom on which
//! position, and who won) – the champ select helper's win rates, from the own PC instead of a
//! website (Riot's policies: no data from sources outside Riot's services).
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// top, jungle, mid, bot, support – the order of every count
pub const POSITIONS: [&str; 5] = ["top", "jungle", "mid", "bot", "support"];
/// Months counted (positions change with the patches); older games are left out.
pub const MONTHS: i64 = 6;
/// A table older than this is built again when it is asked for.
pub const STALE_MS: i64 = 6 * 3600 * 1000;
/// The support items (stats.js SUPPORT_ITEMS): whoever has one is the support.
const SUPPORT_ITEMS: [i64; 20] = [
    3850, 3851, 3853, 3854, 3855, 3857, 3858, 3859, 3860, 3862, 3863, 3864, 3865, 3866, 3867, 3869,
    3870, 3871, 3876, 3877,
];
const DAY_MS: i64 = 86_400_000;

#[derive(Deserialize)]
struct Player {
    #[serde(default)]
    puuid: String,
    #[serde(default)]
    champ: i64,
    #[serde(default)]
    pos: String,
    #[serde(default)]
    spells: Vec<i64>,
    #[serde(default)]
    items: Vec<i64>,
    #[serde(default)]
    team: i64,
    #[serde(default)]
    win: bool,
}
#[derive(Deserialize)]
struct Game {
    #[serde(default)]
    id: Value,
    #[serde(default)]
    t: i64,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    remake: bool,
    #[serde(default)]
    players: Vec<Player>,
}

/// A player's position: Smite = jungle, a support item = support, else the client's own (0..5).
fn role(p: &Player) -> Option<usize> {
    if p.spells.contains(&11) {
        return Some(1);
    }
    if p.items.iter().any(|i| SUPPORT_ITEMS.contains(i)) {
        return Some(4);
    }
    POSITIONS.iter().position(|r| *r == p.pos)
}

/// "2026-11" of a time in ms (UTC; the civil date from the days since 1970).
pub fn month(ms: i64) -> String {
    let z = ms.div_euclid(DAY_MS) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}")
}

/// Counts every Summoner's Rift game of the last MONTHS months in the stores (each `games.jsonl`):
/// { "v": 1, "at": now, "n": samples, "months": { "2026-11": { "103": [top, jungle, mid, bot, support] } } }
pub fn build(dirs: &[PathBuf], now: i64) -> Value {
    let from = now - MONTHS * 31 * DAY_MS;
    let mut seen: HashSet<u64> = HashSet::new();
    let mut months: BTreeMap<String, HashMap<i64, [u32; 5]>> = BTreeMap::new();
    let mut n = 0u64;
    // matchups: position → "a-b" (a < b) → [games, wins of a]; each game once
    let mut mu: [BTreeMap<String, [u32; 2]>; 5] = Default::default();
    let mut mu_seen: HashSet<String> = HashSet::new();
    let mut mu_n = 0u64;
    for dir in dirs {
        let Ok(f) = std::fs::File::open(dir.join("games.jsonl")) else {
            continue;
        };
        for line in BufReader::new(f).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(g) = serde_json::from_str::<Game>(&line) else {
                continue;
            };
            if g.mode != "CLASSIC" || g.remake || g.t < from || g.t > now + DAY_MS {
                continue;
            }
            let id = match &g.id {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let key = month(g.t);
            if g.players.len() == 10 && !mu_seen.contains(&id) {
                // the lane opponents: per position one player of each team, both known
                let mut at: [[Option<&Player>; 2]; 5] = Default::default();
                let mut clash = [false; 5];
                for p in &g.players {
                    let (Some(r), side) = (role(p), usize::from(p.team == 200)) else {
                        continue;
                    };
                    if at[r][side].is_some() {
                        clash[r] = true;
                    }
                    at[r][side] = Some(p);
                }
                let mut any = false;
                for r in 0..5 {
                    let (Some(a), Some(b)) = (at[r][0], at[r][1]) else {
                        continue;
                    };
                    if clash[r]
                        || a.champ <= 0
                        || b.champ <= 0
                        || a.champ == b.champ
                        || a.win == b.win
                    {
                        continue;
                    }
                    let (lo, hi) = if a.champ < b.champ { (a, b) } else { (b, a) };
                    let e = mu[r]
                        .entry(format!("{}-{}", lo.champ, hi.champ))
                        .or_insert([0; 2]);
                    e[0] += 1;
                    e[1] += u32::from(lo.win);
                    mu_n += 1;
                    any = true;
                }
                if any {
                    mu_seen.insert(id.clone());
                }
            }
            for p in &g.players {
                if p.champ <= 0 || p.puuid.is_empty() {
                    continue;
                }
                let Some(r) = role(p) else { continue };
                // one game, one player: counted once (a game can be stored more than once)
                let mut h = DefaultHasher::new();
                (&id, &p.puuid).hash(&mut h);
                if !seen.insert(h.finish()) {
                    continue;
                }
                months
                    .entry(key.clone())
                    .or_default()
                    .entry(p.champ)
                    .or_insert([0; 5])[r] += 1;
                n += 1;
            }
        }
    }
    let months: Map<String, Value> = months
        .into_iter()
        .map(|(m, champs)| {
            let o: Map<String, Value> = champs
                .into_iter()
                .map(|(c, v)| (c.to_string(), json!(v)))
                .collect();
            (m, Value::Object(o))
        })
        .collect();
    let mu: Map<String, Value> = POSITIONS
        .iter()
        .zip(mu)
        .map(|(r, m)| {
            (
                r.to_string(),
                Value::Object(m.into_iter().map(|(k, v)| (k, json!(v))).collect()),
            )
        })
        .collect();
    json!({ "v": 1, "at": now, "n": n, "months": months, "muN": mu_n, "mu": mu })
}

/// The stored table, or null.
pub fn read(data: &Path) -> Value {
    std::fs::read_to_string(data.join("lanes.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}
/// When the stored table was built (0 = none).
pub fn built_at(data: &Path) -> i64 {
    read(data)["at"].as_i64().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_of_times() {
        assert_eq!(month(0), "1970-01");
        // 26.11.2026 12:00 UTC
        assert_eq!(month(1_795_694_400_000), "2026-11");
        // 1.3.2024 (after a leap day)
        assert_eq!(month(1_709_251_200_000), "2024-03");
        assert_eq!(month(1_709_251_200_000 - 1), "2024-02");
    }

    #[test]
    fn every_player_once_by_position_and_month() {
        let dir = std::env::temp_dir().join(format!("rs-lanes-{}", std::process::id()));
        let own = dir.join("matches");
        let others = dir.join("matches-others");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::create_dir_all(&others).unwrap();
        let now = 1_795_694_400_000i64;
        let p = |puuid: &str, champ: i64, pos: &str, spells: Vec<i64>, items: Vec<i64>| json!({ "puuid": puuid, "champ": champ, "pos": pos, "spells": spells, "items": items });
        let full = json!({ "id": "1", "t": now - DAY_MS, "mode": "CLASSIC", "remake": false, "players": [
            p("a", 103, "mid", vec![4, 14], vec![]),
            p("b", 64, "top", vec![11, 4], vec![]),        // Smite: the jungle, whatever the client said
            p("c", 412, "bot", vec![4, 3], vec![3877]),    // a support item: the support
            p("d", 222, "bot", vec![4, 7], vec![]),
            p("e", 86, "", vec![4, 12], vec![]),            // no position known: not counted
        ] });
        // a game with all ten: Ahri (103, blue, won) against Zed (238) on mid; two tops on red: no top matchup
        let mut ten: Vec<Value> = ["top", "jungle", "mid", "bot", "support"].iter().enumerate()
            .map(|(i, r)| json!({ "puuid": format!("t{i}"), "champ": 300 + i, "pos": r, "team": 100, "win": true })).collect();
        ten.extend(["top", "jungle", "mid", "bot", "top"].iter().enumerate()
            .map(|(i, r)| json!({ "puuid": format!("u{i}"), "champ": 400 + i, "pos": r, "team": 200, "win": false })));
        ten[2]["champ"] = json!(103);
        ten[7]["champ"] = json!(238);
        let ten = json!({ "id": "9", "t": now - DAY_MS, "mode": "CLASSIC", "players": ten });
        // the same game in the others' store (Live) and a lite one of player a: counted once
        let lite = json!({ "id": "1", "t": now - DAY_MS, "mode": "CLASSIC", "lite": true, "players": [p("a", 103, "mid", vec![4, 14], vec![])] });
        // an ARAM game, a remake and a game too old: left out
        let aram = json!({ "id": "2", "t": now - DAY_MS, "mode": "ARAM", "players": [p("x", 103, "mid", vec![], vec![])] });
        let remake = json!({ "id": "3", "t": now - DAY_MS, "mode": "CLASSIC", "remake": true, "players": [p("y", 103, "mid", vec![], vec![])] });
        let old = json!({ "id": "4", "t": now - 300 * DAY_MS, "mode": "CLASSIC", "players": [p("z", 103, "mid", vec![], vec![])] });
        let lines = |v: &[&Value]| {
            v.iter()
                .map(|g| g.to_string())
                .collect::<Vec<_>>()
                .join("\n")
        };
        std::fs::write(own.join("games.jsonl"), lines(&[&full, &remake, &ten])).unwrap();
        std::fs::write(
            others.join("games.jsonl"),
            lines(&[&lite, &full, &aram, &old, &ten]) + "\nnot json\n",
        )
        .unwrap();
        let t = build(&[own, others], now);
        assert_eq!(t["n"], 4 + 10);
        // matchups: mid, jungle, bot once each (the game is stored twice); the double top and the
        // support without an opponent left out
        assert_eq!(t["muN"], 3);
        assert_eq!(t["mu"]["mid"]["103-238"], json!([1, 1]));
        assert_eq!(t["mu"]["jungle"]["301-401"], json!([1, 1]));
        assert!(t["mu"]["top"].as_object().unwrap().is_empty());
        assert!(t["mu"]["support"].as_object().unwrap().is_empty());
        let m = &t["months"]["2026-11"];
        assert_eq!(m["103"], json!([0, 0, 2, 0, 0]));
        assert_eq!(m["64"], json!([0, 1, 0, 0, 0]));
        assert_eq!(m["412"], json!([0, 0, 0, 0, 1]));
        assert_eq!(m["222"], json!([0, 0, 0, 1, 0]));
        assert!(m.get("86").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
