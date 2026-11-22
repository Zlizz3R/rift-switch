//! Match history across all saved accounts, like a small op.gg: every game with all ten players
//! and the rough numbers. Read from the local League client while it runs and kept by the app
//! itself, without a limit:
//!   matches/games.jsonl  one game per line, only ever appended (about 2 KB per game)
//!   matches/by.json      game ids per account (newest first)
//!   matches/ranks.json   current Solo/Duo + Flex of players seen in games (12 h cache)
//! Only a small index (id, time, queue, place in the file) stays in memory; the games themselves
//! are read from disk when the page asks for them.

use crate::accounts::{num_of, Obj};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub const QUEUE_GROUPS: [(&str, &[i64]); 5] = [
    ("solo", &[420]),
    ("flex", &[440]),
    ("normal", &[400, 430, 490, 480]),
    ("aram", &[450, 2400]),
    ("arena", &[1700, 1710]),
];
const RANK_TTL: i64 = 12 * 3600 * 1000;
const RANK_KEEP: i64 = 14 * 24 * 3600 * 1000;

#[derive(Clone, Copy)]
pub struct Entry {
    t: i64,
    q: i64,
    off: u64,
    len: u32,
}

pub struct Matches {
    dir: PathBuf,
    index: HashMap<String, Entry>,
    by: Vec<(String, Vec<String>)>,
    ranks: Obj,
}

fn id_num(s: &str) -> i64 {
    s.parse().unwrap_or(0)
}
fn id_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

impl Matches {
    pub fn load(data_dir: &Path) -> Self {
        let dir = data_dir.join("matches");
        let mut m = Matches {
            dir,
            index: HashMap::new(),
            by: vec![],
            ranks: Obj::new(),
        };
        if !m.dir.join("games.jsonl").exists() {
            m.migrate_old(&data_dir.join("matches.json"));
        }
        m.read_index();
        if let Ok(t) = fs::read_to_string(m.dir.join("by.json")) {
            if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(&t) {
                m.by = o
                    .into_iter()
                    .map(|(k, v)| {
                        (
                            k,
                            v.as_array()
                                .map(|a| a.iter().map(id_str).collect())
                                .unwrap_or_default(),
                        )
                    })
                    .collect();
            }
        }
        if let Ok(t) = fs::read_to_string(m.dir.join("ranks.json")) {
            m.ranks = serde_json::from_str(&t).unwrap_or_default();
        }
        m
    }

    /// The old version kept everything in one matches.json (at most 1500 games): carried over once.
    fn migrate_old(&mut self, old: &Path) {
        let Ok(t) = fs::read_to_string(old) else {
            return;
        };
        let Ok(d) = serde_json::from_str::<Value>(&t) else {
            return;
        };
        if fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let mut games: Vec<&Value> = d["games"]
            .as_object()
            .map(|o| o.values().collect())
            .unwrap_or_default();
        games.sort_by_key(|g| num_of(g.get("t")) as i64);
        let mut out = String::new();
        for g in games {
            out.push_str(&g.to_string());
            out.push('\n');
        }
        // games last: only a complete games.jsonl marks the move as done (else it runs again next start)
        if let Some(by) = d["by"].as_object() {
            let _ = crate::store::write_atomic(
                &self.dir.join("by.json"),
                Value::Object(by.clone()).to_string().as_bytes(),
            );
        }
        if let Some(r) = d["ranks"].as_object() {
            let _ = crate::store::write_atomic(
                &self.dir.join("ranks.json"),
                Value::Object(r.clone()).to_string().as_bytes(),
            );
        }
        if crate::store::write_atomic(&self.dir.join("games.jsonl"), out.as_bytes()).is_ok() {
            let _ = fs::rename(old, old.with_extension("json.migrated"));
        }
    }

    fn read_index(&mut self) {
        let Ok(f) = File::open(self.dir.join("games.jsonl")) else {
            return;
        };
        let mut r = BufReader::new(f);
        let (mut off, mut line) = (0u64, String::new());
        #[derive(serde::Deserialize)]
        struct Head {
            id: Value,
            #[serde(default)]
            t: f64,
            #[serde(default)]
            q: f64,
        }
        loop {
            line.clear();
            let Ok(n) = r.read_line(&mut line) else { break };
            if n == 0 {
                break;
            }
            if let Ok(h) = serde_json::from_str::<Head>(line.trim_end()) {
                self.index.insert(
                    id_str(&h.id),
                    Entry {
                        t: h.t as i64,
                        q: h.q as i64,
                        off,
                        len: line.trim_end().len() as u32,
                    },
                );
            }
            off += n as u64;
        }
    }

    fn save_by(&self) {
        let o: Obj = self.by.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let _ = fs::create_dir_all(&self.dir);
        let _ = crate::store::write_atomic(
            &self.dir.join("by.json"),
            Value::Object(o).to_string().as_bytes(),
        );
    }
    fn save_ranks(&self) {
        let _ = fs::create_dir_all(&self.dir);
        let _ = crate::store::write_atomic(
            &self.dir.join("ranks.json"),
            Value::Object(self.ranks.clone()).to_string().as_bytes(),
        );
    }

    /// list = [{ id, t, q }] from an account's match list. Returns true if something new was noted.
    pub fn note(&mut self, puuid: &str, list: &[Value]) -> bool {
        if puuid.is_empty() {
            return false;
        }
        let pos = match self.by.iter().position(|(p, _)| p == puuid) {
            Some(i) => i,
            None => {
                self.by.push((puuid.to_string(), vec![]));
                self.by.len() - 1
            }
        };
        let ids = &mut self.by[pos].1;
        let have: HashSet<String> = ids.iter().cloned().collect();
        let new: Vec<String> = list
            .iter()
            .map(|g| id_str(&g["id"]))
            .filter(|id| !id.is_empty() && id != "null" && !have.contains(id))
            .collect();
        if new.is_empty() {
            return false;
        }
        ids.extend(new);
        ids.sort_by_key(|id| std::cmp::Reverse(id_num(id)));
        ids.dedup();
        self.save_by();
        true
    }

    /// Ids noted for some account whose details aren't stored yet, newest first.
    pub fn missing(&self) -> Vec<String> {
        let mut out: Vec<String> = self
            .by
            .iter()
            .flat_map(|(_, ids)| ids.iter())
            .filter(|id| !self.index.contains_key(*id))
            .cloned()
            .collect();
        out.sort_by_key(|id| std::cmp::Reverse(id_num(id)));
        out.dedup();
        out
    }

    /// Stores one compacted game (appended to games.jsonl).
    pub fn insert(&mut self, g: &Value) -> bool {
        let id = id_str(&g["id"]);
        if id.is_empty() || self.index.contains_key(&id) {
            return false;
        }
        let _ = fs::create_dir_all(&self.dir);
        let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("games.jsonl"))
        else {
            return false;
        };
        let off = f.metadata().map(|m| m.len()).unwrap_or(0);
        let line = g.to_string();
        if f.write_all(format!("{line}\n").as_bytes()).is_err() {
            return false;
        }
        self.index.insert(
            id,
            Entry {
                t: num_of(g.get("t")) as i64,
                q: num_of(g.get("q")) as i64,
                off,
                len: line.len() as u32,
            },
        );
        true
    }

    /// Forget an account that was removed from the app (its games stay only if another account has them).
    pub fn forget(&mut self, puuid: &str) {
        let before = self.by.len();
        self.by.retain(|(p, _)| p != puuid);
        if self.by.len() != before {
            self.save_by();
            self.rewrite_without_orphans();
        }
    }
    fn rewrite_without_orphans(&mut self) {
        let used: HashSet<&String> = self.by.iter().flat_map(|(_, ids)| ids.iter()).collect();
        let keep: Vec<String> = self
            .index
            .keys()
            .filter(|id| used.contains(id))
            .cloned()
            .collect();
        if keep.len() == self.index.len() {
            return;
        }
        let games = self.read_games(&keep);
        if games.len() < keep.len() {
            return; // couldn't read them all: better keep a few unused games than lose some
        }
        let mut out = String::new();
        for g in &games {
            out.push_str(&g.to_string());
            out.push('\n');
        }
        if crate::store::write_atomic(&self.dir.join("games.jsonl"), out.as_bytes()).is_ok() {
            self.index.clear();
            self.read_index();
        }
    }

    fn read_games(&self, ids: &[String]) -> Vec<Value> {
        read_entries(
            &self.games_file(),
            &ids.iter()
                .filter_map(|id| self.index.get(id).copied())
                .collect::<Vec<_>>(),
        )
    }
    pub fn games_file(&self) -> PathBuf {
        self.dir.join("games.jsonl")
    }

    /// The page's list: [id, time, queue, owners…] of every game (newest first) – small, so the
    /// page only asks for the games it doesn't have yet (see entries + read_entries).
    pub fn index_list(
        &self,
        accounts: &[String],
        puuid: Option<&str>,
        queue: Option<&str>,
    ) -> Vec<Value> {
        self.rows(accounts, puuid, queue)
            .into_iter()
            .map(|(id, t, q, owners)| {
                let mut v = vec![json!(id), json!(t), json!(q)];
                v.extend(owners.into_iter().map(Value::String));
                Value::Array(v)
            })
            .collect()
    }
    /// Where these games are in games.jsonl (read with read_entries, outside any lock).
    pub fn entries(&self, ids: &[String]) -> Vec<Entry> {
        ids.iter()
            .filter_map(|id| self.index.get(id).copied())
            .collect()
    }

    fn rows(
        &self,
        accounts: &[String],
        puuid: Option<&str>,
        queue: Option<&str>,
    ) -> Vec<(String, i64, i64, Vec<String>)> {
        let group: Option<&[i64]> =
            queue.and_then(|q| QUEUE_GROUPS.iter().find(|(k, _)| *k == q).map(|(_, v)| *v));
        let mut rows: Vec<(String, i64, i64, Vec<String>)> = vec![];
        let mut pos: HashMap<String, usize> = HashMap::new();
        for (owner, ids) in &self.by {
            if !accounts.contains(owner) || puuid.is_some_and(|p| p != owner) {
                continue;
            }
            for id in ids {
                let Some(e) = self.index.get(id) else {
                    continue;
                };
                if group.is_some_and(|g| !g.contains(&e.q)) {
                    continue;
                }
                match pos.get(id) {
                    Some(&i) => rows[i].3.push(owner.clone()),
                    None => {
                        pos.insert(id.clone(), rows.len());
                        rows.push((id.clone(), e.t, e.q, vec![owner.clone()]));
                    }
                }
            }
        }
        rows.sort_by_key(|r| std::cmp::Reverse(r.1));
        rows
    }

    /// Newest first; a game played together by two own accounts shows once, with both as owners.
    #[cfg(test)]
    pub fn list(
        &self,
        accounts: &[String],
        puuid: Option<&str>,
        queue: Option<&str>,
        limit: usize,
    ) -> Vec<Value> {
        let mut rows = self.rows(accounts, puuid, queue);
        rows.truncate(limit);
        let ids: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
        let games = self.read_games(&ids);
        let owners: HashMap<&String, &Vec<String>> = rows.iter().map(|r| (&r.0, &r.3)).collect();
        games
            .into_iter()
            .map(|mut g| {
                let id = id_str(&g["id"]);
                g["owners"] = json!(owners.get(&id).map(|o| (*o).clone()).unwrap_or_default());
                g
            })
            .collect()
    }

    pub fn known(&self, puuid: &str) -> usize {
        self.by
            .iter()
            .find(|(p, _)| p == puuid)
            .map_or(0, |(_, ids)| ids.len())
    }
    pub fn count(&self) -> usize {
        self.index.len()
    }
    /// Bytes on disk of the stored history.
    pub fn size(&self) -> u64 {
        fs::read_dir(&self.dir)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| e.metadata().ok())
                    .map(|m| m.len())
                    .sum()
            })
            .unwrap_or(0)
            + ["matches.json", "matches.json.migrated"]
                .iter()
                .map(|f| fs::metadata(self.dir.with_file_name(f)).map_or(0, |m| m.len()))
                .sum::<u64>()
    }
    /// Deletes the whole stored history (the user confirmed it). Games still in the client's
    /// recent list come back on their own the next time League runs.
    pub fn clear(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
        let _ = fs::remove_file(self.dir.with_file_name("matches.json"));
        let _ = fs::remove_file(self.dir.with_file_name("matches.json.migrated"));
        self.index.clear();
        self.by.clear();
        self.ranks.clear();
    }

    // ---------- ranks of the players ----------

    /// Cached ranks; only ones that know their server (older entries could come from the wrong one).
    pub fn ranks_for(&self, puuids: &[String]) -> Obj {
        puuids
            .iter()
            .filter_map(|p| {
                self.ranks
                    .get(p)
                    .filter(|r| r.get("reg").is_some())
                    .map(|r| (p.clone(), r.clone()))
            })
            .collect()
    }
    /// Players whose rank is missing, too old or from another server than `reg`.
    pub fn stale_ranks(&self, puuids: &[String], now: i64, reg: &str) -> Vec<String> {
        let mut seen = HashSet::new();
        puuids
            .iter()
            .filter(|p| !p.is_empty() && seen.insert(p.as_str()))
            .filter(|p| {
                self.ranks.get(*p).is_none_or(|r| {
                    now - num_of(r.get("at")) as i64 > RANK_TTL
                        || r.get("reg").and_then(Value::as_str) != Some(reg)
                })
            })
            .cloned()
            .collect()
    }
    /// r = { solo, flex } of one player, as the client of server `reg` reported it
    pub fn set_rank(&mut self, puuid: &str, r: &Obj, now: i64, reg: &str) {
        let pack = |q: Option<&Value>| match q {
            Some(q) if q.is_object() => json!([
                q["tier"],
                q.get("division")
                    .filter(|d| !d.is_null())
                    .cloned()
                    .unwrap_or(json!("")),
                q.get("lp")
                    .filter(|d| !d.is_null())
                    .cloned()
                    .unwrap_or(json!(0))
            ]),
            _ => Value::Null,
        };
        self.ranks.insert(
            puuid.into(),
            json!({ "s": pack(r.get("solo")), "f": pack(r.get("flex")), "at": now, "reg": reg }),
        );
    }
    pub fn ranks_done(&mut self, now: i64) {
        self.ranks
            .retain(|_, r| now - num_of(r.get("at")) as i64 <= RANK_KEEP);
        self.save_ranks();
    }
}

/// Reads games from games.jsonl by their place in the file (no lock needed: lines never move
/// while the app runs, a rewrite only happens when an account is removed).
pub fn read_entries(file: &Path, entries: &[Entry]) -> Vec<Value> {
    let Ok(mut f) = File::open(file) else {
        return vec![];
    };
    let mut out = Vec::with_capacity(entries.len());
    let mut buf = vec![];
    for e in entries {
        buf.resize(e.len as usize, 0);
        if f.seek(SeekFrom::Start(e.off)).is_ok() && f.read_exact(&mut buf).is_ok() {
            if let Ok(v) = serde_json::from_slice::<Value>(&buf) {
                out.push(v);
            }
        }
    }
    out
}

fn num(v: &Value) -> Value {
    json!(v.as_f64().map_or(0, |f| f as i64))
}

/// The client's game detail -> what the page needs (about 2 KB per game).
pub fn compact(g: &Value) -> Option<Value> {
    let parts = g.get("participants")?.as_array()?;
    let ids = g.get("participantIdentities")?.as_array()?;
    let who: HashMap<i64, &Value> = ids
        .iter()
        .map(|x| (x["participantId"].as_i64().unwrap_or(-1), &x["player"]))
        .collect();
    let players: Vec<Value> = parts
        .iter()
        .map(|p| {
            let s = &p["stats"];
            let id = who.get(&p["participantId"].as_i64().unwrap_or(-2)).copied().unwrap_or(&Value::Null);
            let sv = |k: &str| id.get(k).and_then(Value::as_str).filter(|x| !x.is_empty());
            json!({
                "puuid": sv("puuid").unwrap_or(""), "name": sv("gameName").or(sv("summonerName")).unwrap_or(""), "tag": sv("tagLine").unwrap_or(""),
                "team": p["teamId"], "champ": p["championId"], "lvl": num(&s["champLevel"]),
                "k": num(&s["kills"]), "d": num(&s["deaths"]), "a": num(&s["assists"]),
                "cs": num_of(s.get("totalMinionsKilled")) as i64 + num_of(s.get("neutralMinionsKilled")) as i64,
                "gold": num(&s["goldEarned"]), "dmg": num(&s["totalDamageDealtToChampions"]), "vis": num(&s["visionScore"]),
                "items": (0..7).map(|i| num(&s[format!("item{i}").as_str()])).collect::<Vec<_>>(),
                "spells": [num(&p["spell1Id"]), num(&p["spell2Id"])], "keystone": num(&s["perk0"]), "sub": num(&s["perkSubStyle"]),
                "win": s["win"] == true, "multi": num(&s["largestMultiKill"]),
            })
        })
        .collect();
    if players.len() < 2 {
        return None;
    }
    let dur = num_of(g.get("gameDuration")) as i64;
    Some(
        json!({ "id": id_str(&g["gameId"]), "t": num(&g["gameCreation"]), "dur": dur, "q": num(&g["queueId"]),
        "mode": g["gameMode"].as_str().unwrap_or(""), "remake": dur < 300, "players": players }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(id: i64) -> Value {
        json!({ "gameId": id, "gameCreation": id * 1000, "gameDuration": 1800, "queueId": 420, "gameMode": "CLASSIC",
            "participantIdentities": (0..10).map(|i| json!({ "participantId": i + 1, "player": { "puuid": format!("p{i}"), "gameName": format!("N{i}"), "tagLine": "EUW" } })).collect::<Vec<_>>(),
            "participants": (0..10).map(|i| json!({ "participantId": i + 1, "teamId": if i < 5 { 100 } else { 200 }, "championId": i + 1, "spell1Id": 4, "spell2Id": 14,
                "stats": { "kills": i, "deaths": 1, "assists": 2, "totalMinionsKilled": 100, "neutralMinionsKilled": 5, "item0": 3031, "win": i < 5, "perk0": 8112, "perkSubStyle": 8300 } })).collect::<Vec<_>>() })
    }

    #[test]
    fn endless_history_one_row_per_game() {
        let dir = std::env::temp_dir().join(format!("rs-mh-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut m = Matches::load(&dir);
        let g = compact(&detail(5)).unwrap();
        assert_eq!(g["players"].as_array().unwrap().len(), 10);
        assert_eq!(g["players"][3]["cs"], 105);
        assert_eq!(g["players"][3]["name"], "N3");
        assert!(compact(&json!({})).is_none());

        m.note("p0", &[json!({ "id": 5 }), json!({ "id": 4 })]);
        m.note("p1", &[json!({ "id": 5 })]);
        assert_eq!(m.missing(), vec!["5", "4"]);
        for id in m.missing() {
            assert!(m.insert(&compact(&detail(id.parse().unwrap())).unwrap()));
        }
        let accs = vec!["p0".to_string(), "p1".to_string()];
        let rows = m.list(&accs, None, None, 100);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["owners"], json!(["p0", "p1"]));
        assert_eq!(m.list(&accs, None, Some("aram"), 100).len(), 0);

        // no limit: thousands of games stay, and survive a restart
        let many: Vec<Value> = (100..3100).map(|i| json!({ "id": i })).collect();
        m.note("p0", &many);
        for i in 100..3100 {
            m.insert(&compact(&detail(i)).unwrap());
        }
        let m2 = Matches::load(&dir);
        assert_eq!(m2.count(), 3002);
        assert_eq!(m2.known("p0"), 3002);
        assert_eq!(m2.list(&accs, None, None, 5000).len(), 3002);
        assert!(m2.size() > 0);

        let mut m3 = m2;
        m3.forget("p0");
        assert_eq!(m3.list(&accs, None, None, 5000).len(), 1);
        assert_eq!(Matches::load(&dir).count(), 1);
        m3.clear();
        assert_eq!(Matches::load(&dir).count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ranks_know_their_server() {
        let dir = std::env::temp_dir().join(format!("rs-mh-ranks-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut m = Matches::load(&dir);
        let ids = vec!["p1".to_string()];
        let r = json!({ "solo": { "tier": "GOLD", "division": "II", "lp": 5 }, "flex": null })
            .as_object()
            .unwrap()
            .clone();
        m.set_rank("p1", &r, 1, "PBE"); // asked from the PBE client: worthless for EUW games
        assert_eq!(m.stale_ranks(&ids, 2, "EUW"), ids);
        m.set_rank("p1", &r, 2, "EUW");
        assert!(m.stale_ranks(&ids, 3, "EUW").is_empty());
        assert_eq!(m.ranks_for(&ids)["p1"]["s"], json!(["GOLD", "II", 5]));
        m.ranks
            .insert("p2".into(), json!({ "s": null, "f": null, "at": 3 })); // old entry without server
        assert!(m.ranks_for(&["p2".to_string()]).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_file_carried_over() {
        let dir = std::env::temp_dir().join(format!("rs-mh-old-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let g = compact(&detail(7)).unwrap();
        fs::write(
            dir.join("matches.json"),
            json!({ "games": { "7": g }, "by": { "p0": ["7"] }, "ranks": {} }).to_string(),
        )
        .unwrap();
        let m = Matches::load(&dir);
        assert_eq!(m.list(&["p0".to_string()], None, None, 10).len(), 1);
        assert!(!dir.join("matches.json").exists() && dir.join("matches.json.migrated").exists());
        let idx = m.index_list(&["p0".to_string()], None, None);
        assert_eq!(idx[0], json!(["7", 7000, 420, "p0"]));
        let games = read_entries(&m.games_file(), &m.entries(&["7".to_string()]));
        assert_eq!(games[0]["id"], "7");
        let _ = fs::remove_dir_all(&dir);
    }
}
