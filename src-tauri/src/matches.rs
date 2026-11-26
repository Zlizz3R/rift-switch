//! Match history across all saved accounts, like a small op.gg: every game with all ten players
//! and the rough numbers. Read from the local League client while it runs and kept by the app
//! itself, without a limit:
//!   matches/games.jsonl  one game per line, appended (about 15 KB per game since format 6); written
//!                        again – byte for byte – only to drop games (removed account, upgraded
//!                        lines, other players' 30 days / 1 GB)
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

pub const QUEUE_GROUPS: [(&str, &[i64]); 9] = [
    ("solo", &[420]),
    ("flex", &[440]),
    ("r5", &[710]),
    ("classic", &[4310]),
    ("normal", &[400, 430, 490, 480]),
    ("aram", &[450, 2400]),
    ("arena", &[1700, 1710]),
    // Clash on the Rift and ARAM Clash (the client calls their mode "CLASSIC" / "ARAM")
    ("clash", &[700, 720]),
    // custom games: the client gives custom games on the ARAM map their own queues (3220 ARAM,
    // 3270 ARAM: Mayhem), older ones queue 0; any other is marked "custom" when stored
    ("custom", CUSTOM_QUEUES),
];
pub const CUSTOM_QUEUES: &[i64] = &[0, 3220, 3270];
/// A custom game (Riot's game type; Clash is one too, but it stays Clash).
pub fn is_custom(g: &Value) -> bool {
    let q = g["queueId"].as_i64().unwrap_or(-1);
    (g["gameType"] == "CUSTOM_GAME" && q != 700 && q != 720) || CUSTOM_QUEUES.contains(&q)
}
const RANK_TTL: i64 = 12 * 3600 * 1000;
const RANK_KEEP: i64 = 14 * 24 * 3600 * 1000;

#[derive(Clone, Copy)]
pub struct Entry {
    /// the game id as a number: a read checks it (a rewrite may have moved the lines meanwhile)
    id: i64,
    t: i64,
    q: i64,
    off: u64,
    len: u32,
    /// format of the stored game (2 = with positions)
    v: u8,
}

/// Format of games stored now: 2 = players carry their position ("pos"); 3 = every stat for the
/// details view ("x"), team objectives ("teams") and the gold of each player per minute ("gold");
/// 4 = from the timeline also CS per minute ("csm"), every champion kill ("kills"), each player's
/// first ward ("w1") and who took the first dragon ("drake1") – for the timeline tags;
/// 5 = every big objective with the players of the taking team who were in on it ("obj");
/// 6 = per minute also XP ("xp"), jungle CS ("jcs") and where everyone stood ("at"), the place
/// of every kill, the killer of an objective and how many enemies hit it (steals);
/// 7 = the augments of Arena and ARAM: Mayhem ("aug") and Arena's placing ("place") – only games
/// of those queues are fetched again for it (AUG_QUEUES).
pub const GAME_VERSION: u8 = 7;
/// Queues with augments: Arena (1700, 1710), ARAM: Mayhem (2400; 3270 as a custom game)
pub const AUG_QUEUES: [i64; 4] = [1700, 1710, 2400, 3270];
/// A stored game that needs its details again: an older format – format 6 only in a queue with augments
fn needs_update(e: &Entry) -> bool {
    e.v < 6 || (e.v < GAME_VERSION && AUG_QUEUES.contains(&e.q))
}
/// The raw archive of the own games: about 20 KB a game, a new file from this size on (two kept).
const RAW_MAX: u64 = 100_000_000;
/// Other players' games are kept 30 days (Live); own games stay until deleted.
pub const OTHERS_MAX_AGE: i64 = 30 * 24 * 3600 * 1000;
/// Other players' games from their match list alone ("lite": that player's own numbers, about
/// 1 KB a game) are kept a year – the season's tags (pool, win rates, KDA …) come from them.
pub const OTHERS_LITE_AGE: i64 = 365 * 24 * 3600 * 1000;
/// Full details (all ten players, the timeline) are read for a player's newest ranked games only.
pub const OTHERS_DETAILS: usize = 50;
const RANKED: [i64; 2] = [420, 440];
/// Summoner's Rift queues (only there positions mean something)
const SR_QUEUES: [i64; 7] = [400, 420, 430, 440, 480, 490, 700];

pub struct Matches {
    dir: PathBuf,
    index: HashMap<String, Entry>,
    by: Vec<(String, Vec<String>)>,
    ranks: Obj,
    /// the own accounts' store (it may have the old matches.json next to it); false = other players
    own: bool,
    /// other players' store: games older than this (ms) are neither noted nor kept
    max_age: Option<i64>,
}

fn id_num(s: &str) -> i64 {
    s.parse().unwrap_or(0)
}
pub fn id_str(v: &Value) -> String {
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
            own: true,
            max_age: None,
        };
        if !m.dir.join("games.jsonl").exists() {
            m.migrate_old(&data_dir.join("matches.json"));
        }
        m.open();
        m
    }
    /// The store of other players' games (Live): same format, its own folder, nothing to migrate.
    pub fn load_others(dir: PathBuf) -> Self {
        let mut m = Matches {
            dir,
            index: HashMap::new(),
            by: vec![],
            ranks: Obj::new(),
            own: false,
            max_age: Some(OTHERS_MAX_AGE),
        };
        m.open();
        m
    }
    fn open(&mut self) {
        let m = self;
        m.read_index();
        m.shrink_if_worth();
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
            #[serde(default)]
            v: u8,
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
                        id: id_num(&id_str(&h.id)),
                        t: h.t as i64,
                        q: h.q as i64,
                        off,
                        len: line.trim_end().len() as u32,
                        v: h.v,
                    },
                );
            }
            off += n as u64;
        }
    }

    /// Other players without a game left go from the lists (the own accounts always stay).
    fn drop_empty_players(&mut self) {
        if !self.own {
            self.by.retain(|(_, ids)| !ids.is_empty());
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
        // other players: games past the age limit of their lite form aren't wanted at all
        let cutoff = self
            .max_age
            .map(|_| crate::riot::now_ms() - OTHERS_LITE_AGE);
        let list: Vec<Value> = list
            .iter()
            .filter(|g| cutoff.is_none_or(|c| num_of(g.get("t")) as i64 >= c))
            .cloned()
            .collect();
        let list = &list[..];
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
    /// A newer format of a game already stored replaces it (the old line stays unused in the file).
    pub fn insert(&mut self, g: &Value) -> bool {
        let id = id_str(&g["id"]);
        let v = g["v"].as_u64().unwrap_or(0) as u8;
        if id.is_empty() || self.index.get(&id).is_some_and(|e| e.v >= v) {
            return false;
        }
        self.append(id, g, v)
    }
    /// A game from a player's match list (see `lite`): stored when there is nothing better; a lite
    /// game already stored for another player of it gets this player added (a new line).
    pub fn insert_lite(&mut self, g: &Value) -> bool {
        let id = id_str(&g["id"]);
        let Some(p) = g["players"].get(0) else {
            return false;
        };
        match self.index.get(&id).copied() {
            None if !id.is_empty() => self.append(id, g, 0),
            Some(e) if e.v == 0 => {
                let Some(mut had) = read_entries(&self.games_file(), &[e]).pop() else {
                    return false;
                };
                let list = had["players"].as_array_mut();
                match list {
                    Some(l) if !l.iter().any(|x| x["puuid"] == p["puuid"]) => l.push(p.clone()),
                    _ => return false,
                }
                self.append(id, &had, 0)
            }
            _ => false,
        }
    }
    fn append(&mut self, id: String, g: &Value, v: u8) -> bool {
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
            id.clone(),
            Entry {
                id: id_num(&id),
                t: num_of(g.get("t")) as i64,
                q: num_of(g.get("q")) as i64,
                off,
                len: line.len() as u32,
                v,
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
        self.rewrite(&keep);
    }
    /// Bytes of games.jsonl no game points to any more (older formats of upgraded games).
    fn dead_bytes(&self) -> (u64, u64) {
        let file = fs::metadata(self.dir.join("games.jsonl")).map_or(0, |m| m.len());
        let live: u64 = self.index.values().map(|e| e.len as u64 + 1).sum();
        (file.saturating_sub(live), file)
    }
    /// Upgraded games leave their old line behind: once that is over a megabyte and a third of
    /// the file, the file is written again with only the current lines (at start-up).
    fn shrink_if_worth(&mut self) {
        let (dead, file) = self.dead_bytes();
        if dead > 1_000_000 && dead * 3 > file {
            let keep: Vec<String> = self.index.keys().cloned().collect();
            self.rewrite(&keep);
        }
    }
    /// games.jsonl again with only these games: line by line, byte for byte – nothing is parsed and
    /// only one game is in memory at a time (the store of other players can be a gigabyte). The new
    /// places come straight from the copy. Any read error: the old file stays (better a few unused
    /// games than lost ones).
    fn rewrite(&mut self, keep: &[String]) {
        let src = self.games_file();
        let mut list: Vec<(String, Entry)> = keep
            .iter()
            .filter_map(|id| self.index.get(id).map(|e| (id.clone(), *e)))
            .collect();
        list.sort_by_key(|(_, e)| e.off);
        let tmp = crate::store::tmp_path(&src);
        let copied = (|| -> std::io::Result<HashMap<String, Entry>> {
            let mut f = BufReader::new(File::open(&src)?);
            let mut w = std::io::BufWriter::new(File::create(&tmp)?);
            let (mut buf, mut off) = (vec![], 0u64);
            let mut index = HashMap::with_capacity(list.len());
            for (id, e) in list {
                buf.resize(e.len as usize, 0);
                f.seek(SeekFrom::Start(e.off))?;
                f.read_exact(&mut buf)?;
                w.write_all(&buf)?;
                w.write_all(b"\n")?;
                index.insert(id, Entry { off, ..e });
                off += e.len as u64 + 1;
            }
            w.into_inner().map_err(|e| e.into_error())?.sync_all()?;
            Ok(index)
        })();
        match copied {
            Ok(index) if crate::store::replace(&tmp, &src).is_ok() => self.index = index,
            _ => {
                let _ = fs::remove_file(&tmp);
            }
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
        // one group or several, comma separated ("solo,flex,r5")
        let group: Option<Vec<i64>> = queue.map(|q| {
            q.split(',')
                .filter_map(|k| QUEUE_GROUPS.iter().find(|(g, _)| *g == k))
                .flat_map(|(_, v)| v.iter().copied())
                .collect()
        });
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
                if group.as_ref().is_some_and(|g| !g.contains(&e.q)) {
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

    /// Games stored in an older format (no positions / details yet), newest first –
    /// Summoner's Rift first, where positions matter most.
    pub fn outdated(&self, max: usize) -> Vec<String> {
        let mut out: Vec<(&String, &Entry)> =
            self.index.iter().filter(|(_, e)| needs_update(e)).collect();
        out.sort_by_key(|(_, e)| (!SR_QUEUES.contains(&e.q), std::cmp::Reverse(e.t)));
        out.into_iter()
            .take(max)
            .map(|(id, _)| id.clone())
            .collect()
    }

    #[cfg(test)]
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
            + if self.own {
                ["matches.json", "matches.json.migrated"]
                    .iter()
                    .map(|f| fs::metadata(self.dir.with_file_name(f)).map_or(0, |m| m.len()))
                    .sum::<u64>()
            } else {
                0
            }
    }
    /// Is this game stored?
    pub fn has(&self, id: &str) -> bool {
        self.index.contains_key(id)
    }
    /// The noted games of these players that aren't stored yet, newest first.
    /// A player's games that get full details: the newest OTHERS_DETAILS ranked ones of the list
    /// (the queue is known from the lite game; a game not stored at all counts too, newest first).
    fn detail_ids(&self, puuid: &str) -> Vec<&String> {
        let Some((_, ids)) = self.by.iter().find(|(p, _)| p == puuid) else {
            return vec![];
        };
        ids.iter()
            .filter(|id| self.index.get(*id).is_none_or(|e| RANKED.contains(&e.q)))
            .take(OTHERS_DETAILS)
            .collect()
    }
    /// Game ids of these players whose details are still to read, newest first.
    pub fn missing_for(&self, puuids: &[String]) -> Vec<String> {
        let mut out: Vec<String> = puuids
            .iter()
            .flat_map(|p| self.detail_ids(p))
            .filter(|id| self.index.get(*id).is_none_or(|e| e.v == 0))
            .cloned()
            .collect();
        out.sort_by_key(|id| std::cmp::Reverse(id_num(id)));
        out.dedup();
        out
    }
    /// The player page: every game of the player's list gets its details (all queues, up to 200),
    /// newest first.
    pub fn missing_all(&self, puuid: &str) -> Vec<String> {
        let Some((_, ids)) = self.by.iter().find(|(p, _)| p == puuid) else {
            return vec![];
        };
        let mut out: Vec<String> = ids
            .iter()
            .filter(|id| self.index.get(*id).is_none_or(|e| e.v == 0))
            .cloned()
            .collect();
        out.sort_by_key(|id| std::cmp::Reverse(id_num(id)));
        out
    }
    /// (games with details, games in the list) of a player – the player page's progress.
    pub fn progress_all(&self, puuid: &str) -> (usize, usize) {
        let Some((_, ids)) = self.by.iter().find(|(p, _)| p == puuid) else {
            return (0, 0);
        };
        let done = ids
            .iter()
            .filter(|id| self.index.get(*id).is_some_and(|e| e.v > 0))
            .count();
        (done, ids.len())
    }
    /// (games with details, games that get details) of a player.
    pub fn progress(&self, puuid: &str) -> (usize, usize) {
        let ids = self.detail_ids(puuid);
        let done = ids
            .iter()
            .filter(|id| self.index.get(**id).is_some_and(|e| e.v > 0))
            .count();
        (done, ids.len())
    }
    /// What the window echoes back for a game it holds: id and format, for a lite game also the
    /// line's length (another player added to it makes a longer line – it has to come again).
    pub fn game_key(&self, id: &str) -> String {
        match self.index.get(id) {
            Some(e) if e.v == 0 => format!("{id}:0.{}", e.len),
            Some(e) => format!("{id}:{}", e.v),
            None => String::new(),
        }
    }
    /// A player's stored games: every id, and the games the window doesn't have yet (`have`: the
    /// `game_key`s it holds – a lite game that got its details or another player comes again).
    /// Each game sent carries its key as "k".
    pub fn games_of(&self, puuid: &str, have: &HashSet<String>) -> (Vec<String>, Vec<Value>) {
        let ids: Vec<String> = self
            .by
            .iter()
            .find(|(p, _)| p == puuid)
            .map(|(_, ids)| {
                ids.iter()
                    .filter(|id| self.index.contains_key(*id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let new: Vec<String> = ids
            .iter()
            .filter(|id| !have.contains(&self.game_key(id)))
            .cloned()
            .collect();
        let mut games = self.read_games(&new);
        for g in games.iter_mut() {
            let k = self.game_key(&id_str(&g["id"]));
            if let Some(o) = g.as_object_mut() {
                o.insert("k".into(), json!(k));
            }
        }
        (ids, games)
    }
    /// Other players' games older than the age limit go (and leave the lists). Returns how many.
    pub fn prune_old(&mut self, now: i64) -> usize {
        let Some(age) = self.max_age else { return 0 };
        let drop: HashSet<String> = self
            .index
            .iter()
            .filter(|(_, e)| e.t < now - if e.v == 0 { OTHERS_LITE_AGE } else { age })
            .map(|(id, _)| id.clone())
            .collect();
        if drop.is_empty() {
            return 0;
        }
        for (_, ids) in self.by.iter_mut() {
            ids.retain(|id| !drop.contains(id));
        }
        self.drop_empty_players();
        self.save_by();
        let keep: Vec<String> = self
            .index
            .keys()
            .filter(|id| !drop.contains(*id))
            .cloned()
            .collect();
        self.rewrite(&keep);
        drop.len()
    }
    /// The client's raw answers of an own game (details + timeline), gzip, appended to
    /// raw.jsonl.gz – an archive with every field, for figures nobody has thought of yet.
    pub fn append_raw(&self, id: &str, game: &Value, timeline: Option<&Value>) {
        use flate2::{write::GzEncoder, Compression};
        let _ = fs::create_dir_all(&self.dir);
        // at most RAW_MAX: the full file becomes raw-old.jsonl.gz (the one before goes), a new one starts
        let raw = self.dir.join("raw.jsonl.gz");
        if fs::metadata(&raw).map_or(0, |m| m.len()) > RAW_MAX {
            let _ = fs::rename(&raw, self.dir.join("raw-old.jsonl.gz"));
        }
        let Ok(f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("raw.jsonl.gz"))
        else {
            return;
        };
        let line = json!({ "id": id, "game": game, "timeline": timeline }).to_string() + "\n";
        let mut z = GzEncoder::new(f, Compression::default());
        if z.write_all(line.as_bytes()).is_ok() {
            let _ = z.finish();
        }
    }

    /// Over `max` bytes: the oldest games go (and leave the players' lists), down to 90 % of it.
    /// Returns how many went. Only ever used on the other players' store.
    pub fn prune_to(&mut self, max: u64) -> usize {
        if max == 0 || self.size() <= max {
            return 0;
        }
        let mut all: Vec<(&String, &Entry)> = self.index.iter().collect();
        all.sort_by_key(|(_, e)| e.t);
        let mut live: u64 = all.iter().map(|(_, e)| e.len as u64 + 1).sum();
        let target = max / 10 * 9;
        let mut drop: HashSet<String> = HashSet::new();
        for (id, e) in all {
            if live <= target {
                break;
            }
            live -= e.len as u64 + 1;
            drop.insert(id.clone());
        }
        for (_, ids) in self.by.iter_mut() {
            ids.retain(|id| !drop.contains(id));
        }
        self.drop_empty_players();
        self.save_by();
        let keep: Vec<String> = self
            .index
            .keys()
            .filter(|id| !drop.contains(*id))
            .cloned()
            .collect();
        self.rewrite(&keep);
        drop.len()
    }
    /// Deletes the whole stored history (the user confirmed it). Games still in the client's
    /// recent list come back on their own the next time League runs.
    pub fn clear(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
        if self.own {
            let _ = fs::remove_file(self.dir.with_file_name("matches.json"));
            let _ = fs::remove_file(self.dir.with_file_name("matches.json.migrated"));
        }
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

/// Reads games from games.jsonl by their place in the file, outside any lock. A rewrite (removed
/// account, pruning, shrinking) may move the lines meanwhile: a line that isn't the game asked for
/// is left out, and the caller asks again with fresh places.
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
                if id_num(&id_str(&v["id"])) == e.id {
                    out.push(v);
                }
            }
        }
    }
    out
}

/// Every number of a player the details view shows (kept short: about 0.3 KB per player).
fn extra(s: &Value) -> Value {
    const KEYS: [(&str, &str); 22] = [
        ("totalDamageTaken", "taken"),
        ("physicalDamageDealtToChampions", "phys"),
        ("magicDamageDealtToChampions", "magic"),
        ("trueDamageDealtToChampions", "true"),
        ("totalHeal", "heal"),
        ("damageSelfMitigated", "mitig"),
        ("timeCCingOthers", "cc"),
        ("wardsPlaced", "wards"),
        ("wardsKilled", "wardsKilled"),
        ("visionWardsBoughtInGame", "pinks"),
        ("turretKills", "towers"),
        ("inhibitorKills", "inhibs"),
        ("damageDealtToObjectives", "obj"),
        ("damageDealtToTurrets", "turretDmg"),
        ("largestKillingSpree", "spree"),
        ("largestCriticalStrike", "crit"),
        ("goldSpent", "spent"),
        ("totalMinionsKilled", "minions"),
        ("neutralMinionsKilled", "jungle"),
        ("doubleKills", "doubles"),
        ("tripleKills", "triples"),
        ("quadraKills", "quadras"),
    ];
    let mut o = crate::accounts::Obj::new();
    for (from, to) in KEYS {
        let n = num_of(s.get(from)) as i64;
        if n != 0 {
            o.insert(to.into(), json!(n));
        }
    }
    for (from, to) in [("pentaKills", "pentas"), ("killingSprees", "sprees")] {
        let n = num_of(s.get(from)) as i64;
        if n != 0 {
            o.insert(to.into(), json!(n));
        }
    }
    if s["firstBloodKill"] == true {
        o.insert("fb".into(), json!(true));
    }
    Value::Object(o)
}
/// A team's objectives.
fn team(t: &Value) -> Value {
    json!({ "id": t["teamId"], "towers": num(&t["towerKills"]), "inhibs": num(&t["inhibitorKills"]), "drakes": num(&t["dragonKills"]),
        "barons": num(&t["baronKills"]), "heralds": num(&t["riftHeraldKills"]), "grubs": num(&t["hordeKills"]),
        "bans": t["bans"].as_array().map(|b| b.iter().map(|x| num(&x["championId"])).filter(|c| c.as_i64().unwrap_or(0) > 0).collect::<Vec<_>>()).unwrap_or_default() })
}
/// The client's game timeline -> per minute every player's total gold ("gold") and CS ("csm"),
/// in the order of "players"; every champion kill as [second, killer, victim, [assists]] with
/// player indexes (-1 = no champion, e.g. a tower); each player's first ward in seconds ("w1",
/// null = none) and the team of the first dragon ("drake1"); every big objective as
/// [second, kind, team, [player indexes of that team in on it: killer + assists], killer, enemies
/// who hit it] ("obj"; kind: D dragon, E elder, B baron, H herald, A Atakhan, G voidgrub).
/// Per minute also XP ("xp"), jungle CS ("jcs") and each player's place in hundreds of map units
/// ("at": [x, y]); a kill gets its place too ([second, killer, victim, [assists], x, y]).
/// About 6–8 KB per game.
pub fn add_timeline(game: &mut Value, tl: &Value, participant_ids: &[i64]) {
    let Some(frames) = tl["frames"].as_array() else {
        return;
    };
    let per_minute = |f: &dyn Fn(&Value) -> Value| -> Vec<Value> {
        frames
            .iter()
            .map(|fr| {
                let pf = &fr["participantFrames"];
                Value::Array(
                    participant_ids
                        .iter()
                        .map(|id| f(&pf[id.to_string().as_str()]))
                        .collect(),
                )
            })
            .collect()
    };
    let gold = per_minute(&|p| num(&p["totalGold"]));
    if gold.len() > 1 {
        game["gold"] = Value::Array(gold);
        game["csm"] = Value::Array(per_minute(&|p| {
            json!(
                num_of(p.get("minionsKilled")) as i64 + num_of(p.get("jungleMinionsKilled")) as i64
            )
        }));
        game["xp"] = Value::Array(per_minute(&|p| num(&p["xp"])));
        game["jcs"] = Value::Array(per_minute(&|p| num(&p["jungleMinionsKilled"])));
        game["at"] = Value::Array(per_minute(&|p| {
            place(&p["position"]).map_or(Value::Null, |(x, y)| json!([x, y]))
        }));
    }
    // participant id -> index in "players"
    let idx = |v: &Value| -> i64 {
        let id = v.as_i64().unwrap_or(0);
        participant_ids
            .iter()
            .position(|p| *p == id && id > 0)
            .map_or(-1, |i| i as i64)
    };
    let sec = |e: &Value| num_of(e.get("timestamp")) as i64 / 1000;
    let events = frames
        .iter()
        .filter_map(|f| f["events"].as_array())
        .flatten();
    let (mut kills, mut w1, mut drake1, mut obj) = (
        vec![],
        vec![Value::Null; participant_ids.len()],
        Value::Null,
        vec![],
    );
    for e in events {
        match e["type"].as_str().unwrap_or("") {
            "CHAMPION_KILL" => {
                let assists: Vec<i64> = e["assistingParticipantIds"]
                    .as_array()
                    .map(|a| a.iter().map(idx).filter(|i| *i >= 0).collect())
                    .unwrap_or_default();
                let mut k = vec![
                    json!(sec(e)),
                    json!(idx(&e["killerId"])),
                    json!(idx(&e["victimId"])),
                    json!(assists),
                ];
                if let Some((x, y)) = place(&e["position"]) {
                    k.extend([json!(x), json!(y)]);
                }
                kills.push(Value::Array(k));
            }
            "WARD_PLACED" if e["wardType"] != "UNDEFINED" => {
                let i = idx(&e["creatorId"]);
                if i >= 0 && w1[i as usize].is_null() {
                    w1[i as usize] = json!(sec(e));
                }
            }
            "ELITE_MONSTER_KILL" => {
                let team_of = |i: i64| {
                    game["players"]
                        .get(i.max(0) as usize)
                        .filter(|_| i >= 0)
                        .map(|p| p["team"].clone())
                };
                let i = idx(&e["killerId"]);
                // no champion as killer (rare): the event's own team, when it names one
                let own = Some(e["teamId"].clone()).filter(|t| t == 100 || t == 200);
                let team = team_of(i).or(own).unwrap_or(Value::Null);
                if drake1.is_null() && e["monsterType"] == "DRAGON" {
                    drake1 = team.clone();
                }
                let kind = match (e["monsterType"].as_str(), e["monsterSubType"].as_str()) {
                    (Some("DRAGON"), Some("ELDER_DRAGON")) => "E",
                    (Some("DRAGON"), _) => "D",
                    (Some("BARON_NASHOR"), _) => "B",
                    (Some("RIFTHERALD"), _) => "H",
                    (Some("ATAKHAN"), _) => "A",
                    (Some("HORDE"), _) => "G",
                    _ => "",
                };
                if !kind.is_empty() && !team.is_null() {
                    // the killer and the assists of the taking team; the enemies only hit it (many
                    // of them and the killer alone: a steal)
                    let all: Vec<i64> = std::iter::once(i)
                        .chain(
                            e["assistingParticipantIds"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .map(idx),
                        )
                        .filter(|j| *j >= 0)
                        .collect();
                    let mut ins: Vec<i64> = all
                        .iter()
                        .copied()
                        .filter(|j| team_of(*j).as_ref() == Some(&team))
                        .collect();
                    ins.sort_unstable();
                    ins.dedup();
                    let mut foes: Vec<i64> = all
                        .iter()
                        .copied()
                        .filter(|j| team_of(*j).as_ref() != Some(&team))
                        .collect();
                    foes.sort_unstable();
                    foes.dedup();
                    obj.push(json!([sec(e), kind, team, ins, i, foes.len()]));
                }
            }
            _ => {}
        }
    }
    if frames.len() > 1 {
        game["kills"] = Value::Array(kills);
        game["drake1"] = drake1;
        game["obj"] = Value::Array(obj);
        // the League client's timelines carry no ward events (checked 24.11.2026): only when some
        // are there – no list at all is "unknown", a list of nulls would read as "never warded"
        if w1.iter().any(|w| !w.is_null()) {
            game["w1"] = Value::Array(w1);
        }
    }
}
/// The participant ids of a game detail, in the order compact() lists the players.
pub fn participant_ids(g: &Value) -> Vec<i64> {
    g["participants"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| p["participantId"].as_i64().unwrap_or(0))
        .collect()
}

/// The client's lane + role of a player -> top | jungle | mid | bot | support | "" (unknown).
/// Riot guesses these from the game; the page only uses them when each team has all five.
pub fn position(tl: &Value) -> &'static str {
    match (
        tl["lane"].as_str().unwrap_or(""),
        tl["role"].as_str().unwrap_or(""),
    ) {
        ("TOP", _) => "top",
        ("JUNGLE", _) => "jungle",
        ("MIDDLE" | "MID", _) => "mid",
        ("BOTTOM" | "BOT", "DUO_SUPPORT" | "SUPPORT") => "support",
        ("BOTTOM" | "BOT", _) => "bot",
        _ => "",
    }
}

/// a place on the map in hundreds of units (enough for "where", a third of the size)
fn place(p: &Value) -> Option<(i64, i64)> {
    let (x, y) = (p.get("x")?.as_f64()?, p.get("y")?.as_f64()?);
    Some(((x / 100.0).round() as i64, (y / 100.0).round() as i64))
}

fn num(v: &Value) -> Value {
    json!(v.as_f64().map_or(0, |f| f as i64))
}

/// The client's game detail -> what the page needs (about 2 KB per game).
/// A game from a match list: the list carries only that player (participants[0]) – kept as a
/// "lite" game (format 0) with that one player, until (if ever) its details replace it.
pub fn lite(g: &Value) -> Option<Value> {
    let players = players_of(g)?;
    if players.is_empty() {
        return None;
    }
    let dur = num_of(g.get("gameDuration")) as i64;
    Some(
        json!({ "id": id_str(&g["gameId"]), "t": num(&g["gameCreation"]), "dur": dur, "q": num(&g["queueId"]),
        "mode": g["gameMode"].as_str().unwrap_or(""), "remake": dur < 300, "players": players, "v": 0, "lite": true }),
    )
    .map(|o| mark_custom(o, g))
}
/// A custom game gets "custom": true, and a queue the "custom" group knows (0) when Riot gave it
/// another one – so the Custom filter finds every game that says Custom.
fn mark_custom(mut o: Value, g: &Value) -> Value {
    if is_custom(g) {
        o["custom"] = json!(true);
        if !CUSTOM_QUEUES.contains(&o["q"].as_i64().unwrap_or(-1)) {
            o["q"] = json!(0);
        }
    }
    o
}
pub fn compact(g: &Value) -> Option<Value> {
    let players = players_of(g)?;
    if players.len() < 2 {
        return None;
    }
    let dur = num_of(g.get("gameDuration")) as i64;
    Some(
        json!({ "id": id_str(&g["gameId"]), "t": num(&g["gameCreation"]), "dur": dur, "q": num(&g["queueId"]),
        "mode": g["gameMode"].as_str().unwrap_or(""), "remake": dur < 300, "players": players, "v": GAME_VERSION,
        "teams": g["teams"].as_array().map(|t| t.iter().map(team).collect::<Vec<_>>()).unwrap_or_default() }),
    )
    .map(|o| mark_custom(o, g))
}
fn players_of(g: &Value) -> Option<Vec<Value>> {
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
            let mut o = json!({
                "puuid": sv("puuid").unwrap_or(""), "name": sv("gameName").or(sv("summonerName")).unwrap_or(""), "tag": sv("tagLine").unwrap_or(""),
                "team": p["teamId"], "champ": p["championId"], "lvl": num(&s["champLevel"]),
                "k": num(&s["kills"]), "d": num(&s["deaths"]), "a": num(&s["assists"]),
                "cs": num_of(s.get("totalMinionsKilled")) as i64 + num_of(s.get("neutralMinionsKilled")) as i64,
                "gold": num(&s["goldEarned"]), "dmg": num(&s["totalDamageDealtToChampions"]), "vis": num(&s["visionScore"]),
                "items": (0..7).map(|i| num(&s[format!("item{i}").as_str()])).collect::<Vec<_>>(),
                "spells": [num(&p["spell1Id"]), num(&p["spell2Id"])], "keystone": num(&s["perk0"]), "sub": num(&s["perkSubStyle"]),
                "win": s["win"] == true, "multi": num(&s["largestMultiKill"]), "pos": position(&p["timeline"]),
                "x": extra(s),
            });
            // Arena / ARAM: Mayhem: the augments taken, Arena's placing
            let aug: Vec<i64> = (1..=6)
                .map(|i| num_of(s.get(format!("playerAugment{i}").as_str())) as i64)
                .filter(|n| *n > 0)
                .collect();
            if !aug.is_empty() {
                o["aug"] = json!(aug);
            }
            let place = num_of(s.get("subteamPlacement")) as i64;
            if place > 0 {
                o["place"] = json!(place);
            }
            o
        })
        .collect();
    Some(players)
}

/// Each own account's games in short: { puuid: [[time, seconds, queue, champion, win, remake]] }
/// (for the play time estimate and the mastery calibration). A game two own accounts played
/// together is in both lists.
pub fn own_rows(games: &[Value], owners: &HashSet<String>) -> Obj {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    for g in games {
        let Some(players) = g["players"].as_array() else {
            continue;
        };
        for p in players {
            let Some(id) = p["puuid"].as_str().filter(|x| owners.contains(*x)) else {
                continue;
            };
            out.entry(id.to_string()).or_default().push(json!([
                g["t"],
                g["dur"],
                g["q"],
                p["champ"],
                p["win"] == true,
                g["remake"] == true
            ]));
        }
    }
    out.into_iter().map(|(k, v)| (k, Value::Array(v))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_games_are_their_own_queue() {
        let g = |q: i64, ty: &str| json!({ "queueId": q, "gameType": ty });
        // Riot's custom queues on the ARAM map (3270 ARAM: Mayhem, 3220 ARAM), and any custom game
        assert!(is_custom(&g(3270, "CUSTOM_GAME")) && is_custom(&g(3220, "CUSTOM_GAME")));
        assert!(is_custom(&g(3100, "CUSTOM_GAME")) && is_custom(&g(0, "")));
        // Clash is a custom game for Riot, but stays Clash; real ARAM stays ARAM
        assert!(!is_custom(&g(700, "CUSTOM_GAME")) && !is_custom(&g(720, "CUSTOM_GAME")));
        assert!(!is_custom(&g(2400, "MATCHED_GAME")) && !is_custom(&g(450, "MATCHED_GAME")));
        let aram = QUEUE_GROUPS.iter().find(|(k, _)| *k == "aram").unwrap().1;
        assert!(!aram.contains(&3270) && !aram.contains(&3220));
        // stored games say so
        let mut d = detail(5);
        d["queueId"] = json!(3270);
        d["gameType"] = json!("CUSTOM_GAME");
        assert_eq!(compact(&d).unwrap()["custom"], true);
        assert_eq!(compact(&d).unwrap()["q"], 3270);
        // a custom game on a queue the group doesn't list: stored as queue 0, so the filter finds it
        d["queueId"] = json!(3100);
        assert_eq!(compact(&d).unwrap()["q"], 0);
        assert!(compact(&detail(6)).unwrap().get("custom").is_none());
    }

    fn detail(id: i64) -> Value {
        json!({ "gameId": id, "gameCreation": id * 1000, "gameDuration": 1800, "queueId": 420, "gameMode": "CLASSIC",
            "participantIdentities": (0..10).map(|i| json!({ "participantId": i + 1, "player": { "puuid": format!("p{i}"), "gameName": format!("N{i}"), "tagLine": "EUW" } })).collect::<Vec<_>>(),
            "participants": (0..10).map(|i| json!({ "participantId": i + 1, "teamId": if i < 5 { 100 } else { 200 }, "championId": i + 1, "spell1Id": 4, "spell2Id": 14,
                "stats": { "kills": i, "deaths": 1, "assists": 2, "totalMinionsKilled": 100, "neutralMinionsKilled": 5, "item0": 3031, "win": i < 5, "perk0": 8112, "perkSubStyle": 8300 } })).collect::<Vec<_>>() })
    }

    #[test]
    fn augments_and_arena_placing() {
        let mut d = detail(3);
        d["queueId"] = json!(2400);
        d["participants"][0]["stats"]["playerAugment1"] = json!(1390);
        d["participants"][0]["stats"]["playerAugment3"] = json!(2132);
        d["participants"][0]["stats"]["playerAugment2"] = json!(0);
        d["participants"][1]["stats"]["subteamPlacement"] = json!(2);
        let g = compact(&d).unwrap();
        assert_eq!(g["players"][0]["aug"], json!([1390, 2132]));
        assert_eq!(g["players"][1]["place"], 2);
        assert!(g["players"][2].get("aug").is_none() && g["players"][2].get("place").is_none());
        // format 6: only games with augments are fetched again
        let e = |v: u8, q: i64| Entry {
            id: 1,
            t: 1,
            q,
            off: 0,
            len: 0,
            v,
        };
        assert!(needs_update(&e(6, 2400)) && needs_update(&e(6, 1700)) && needs_update(&e(5, 420)));
        assert!(!needs_update(&e(6, 420)) && !needs_update(&e(7, 2400)));
    }

    /// a game as a match list carries it: only player i
    fn list_game(id: i64, i: usize) -> Value {
        let mut g = detail(id);
        for k in ["participantIdentities", "participants"] {
            let one = g[k][i].clone();
            g[k] = json!([one]);
        }
        g
    }

    #[test]
    fn lite_games_merge_players_and_give_way_to_details() {
        let dir = std::env::temp_dir().join(format!("rs-lite-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut o = Matches::load_others(dir.clone());
        let now = crate::riot::now_ms();
        let at = |mut g: Value| {
            g["t"] = json!(now);
            g
        };
        let a = at(lite(&list_game(9, 0)).unwrap());
        assert_eq!(a["v"], 0);
        assert_eq!(a["lite"], true);
        assert_eq!(a["players"].as_array().unwrap().len(), 1);
        assert!(o.insert_lite(&a));
        // the same player again: nothing new
        assert!(!o.insert_lite(&a));
        let k1 = o.game_key("9");
        assert!(k1.starts_with("9:0."));
        // another player of the same game: one game with both, and a new key for the window
        assert!(o.insert_lite(&at(lite(&list_game(9, 6)).unwrap())));
        let k2 = o.game_key("9");
        assert_ne!(k1, k2);
        o.note("p0", &[json!({ "id": 9, "t": now, "q": 420 })]);
        o.note("p6", &[json!({ "id": 9, "t": now, "q": 420 })]);
        let (ids, games) = o.games_of("p6", &HashSet::new());
        assert_eq!(ids, vec!["9"]);
        assert_eq!(games[0]["players"].as_array().unwrap().len(), 2);
        assert_eq!(games[0]["k"], json!(k2));
        // the window holds it: not sent again – an old key brings it again
        assert!(o.games_of("p6", &[k2.clone()].into()).1.is_empty());
        assert_eq!(o.games_of("p6", &[k1].into()).1.len(), 1);
        // a lite game still needs its details; once there, they win and a lite one can't replace them
        assert_eq!(o.missing_for(&["p0".into()]), vec!["9"]);
        assert_eq!(o.progress("p0"), (0, 1));
        assert!(o.insert(&at(compact(&detail(9)).unwrap())));
        assert!(!o.insert_lite(&a));
        assert!(o.missing_for(&["p0".into()]).is_empty());
        assert_eq!(o.progress("p0"), (1, 1));
        assert_eq!(o.game_key("9"), format!("9:{GAME_VERSION}"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_player_page_reads_every_game() {
        let dir = std::env::temp_dir().join(format!("rs-all-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut o = Matches::load_others(dir.clone());
        let now = crate::riot::now_ms();
        let list: Vec<Value> = (0..6).map(|i| json!({ "id": 100 - i, "t": now - i * 1000, "q": if i % 2 == 0 { 400 } else { 420 } })).collect();
        o.note("p0", &list);
        // every game, normal ones too, newest first
        assert_eq!(
            o.missing_all("p0"),
            vec!["100", "99", "98", "97", "96", "95"]
        );
        assert_eq!(o.progress_all("p0"), (0, 6));
        let mut g = compact(&detail(100)).unwrap();
        g["t"] = json!(now);
        o.insert(&g);
        assert_eq!(o.progress_all("p0"), (1, 6));
        assert!(!o.missing_all("p0").contains(&"100".to_string()));
        assert!(o.missing_all("nobody").is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn details_only_for_the_newest_ranked_games() {
        let dir = std::env::temp_dir().join(format!("rs-detail-ids-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut o = Matches::load_others(dir.clone());
        let now = crate::riot::now_ms();
        // 60 games, newest first: every third one a normal game (queue 400) – known from its lite form
        let list: Vec<Value> = (0..60).map(|i| json!({ "id": 1000 - i, "t": now - i * 1000, "q": if i % 3 == 0 { 400 } else { 420 } })).collect();
        o.note("p0", &list);
        for (i, x) in list.iter().enumerate() {
            let mut g = lite(&list_game(x["id"].as_i64().unwrap(), 0)).unwrap();
            g["t"] = x["t"].clone();
            g["q"] = x["q"].clone();
            if i < 60 {
                o.insert_lite(&g);
            }
        }
        let want = o.missing_for(&["p0".into()]);
        assert_eq!(want.len(), 40);
        assert_eq!(want[0], "999");
        assert!(!want.contains(&"1000".to_string()));
        assert_eq!(o.progress("p0"), (0, 40));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn own_rows_per_account() {
        let g = compact(&detail(7)).unwrap();
        let owners: HashSet<String> = ["p1".to_string(), "p6".to_string()].into();
        let r = own_rows(&[g], &owners);
        assert_eq!(r["p1"], json!([[7000, 1800, 420, 2, true, false]]));
        assert_eq!(r["p6"][0][3], 7);
        assert_eq!(r["p6"][0][4], false);
        assert!(!r.contains_key("p0"));
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
        assert_eq!(g["v"], GAME_VERSION);
        assert_eq!(g["players"][3]["x"]["minions"], 100);
        assert_eq!(g["players"][3]["x"]["jungle"], 5);
        let mut g2 = g.clone();
        let tl = json!({ "frames": [
            { "participantFrames": (1..=10).map(|i| (i.to_string(), json!({ "totalGold": 500 }))).collect::<serde_json::Map<_, _>>() },
            { "participantFrames": (1..=10).map(|i| (i.to_string(), json!({ "totalGold": 500 + i * 100 }))).collect::<serde_json::Map<_, _>>() } ] });
        add_timeline(&mut g2, &tl, &participant_ids(&detail(5)));
        assert_eq!(g2["gold"][1][0], 600);
        assert_eq!(g2["gold"][1][9], 1500);
        assert_eq!(
            position(&json!({ "lane": "BOTTOM", "role": "DUO_SUPPORT" })),
            "support"
        );
        assert_eq!(
            position(&json!({ "lane": "BOTTOM", "role": "DUO_CARRY" })),
            "bot"
        );
        assert_eq!(position(&json!({ "lane": "NONE" })), "");
        // an old game (no positions) is replaced by its newer format once, not twice
        let mut old = g.clone();
        old["v"] = json!(0);
        let mut m0 = Matches::load(&dir.join("v"));
        assert!(m0.insert(&old));
        assert_eq!(m0.outdated(5), vec!["5"]);
        assert!(m0.insert(&g));
        assert!(!m0.insert(&g));
        assert!(m0.outdated(5).is_empty());

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
    fn team_keeps_its_bans() {
        let t = team(
            &json!({ "teamId": 100, "towerKills": 3, "bans": [{ "championId": 157 }, { "championId": -1 }, { "championId": 64 }] }),
        );
        assert_eq!(t["bans"], json!([157, 64]));
        assert_eq!(team(&json!({ "teamId": 200 }))["bans"], json!([]));
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
        assert_eq!(
            m.index_list(&["p0".to_string()], None, Some("flex,r5"))
                .len(),
            0
        );
        assert_eq!(
            m.index_list(&["p0".to_string()], None, Some("flex,solo"))
                .len(),
            1
        );
        let games = read_entries(&m.games_file(), &m.entries(&["7".to_string()]));
        assert_eq!(games[0]["id"], "7");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn timeline_kills_wards_first_dragon_cs() {
        let mut g = compact(&detail(9)).unwrap();
        let pf = |cs: i64| {
            (1..=10).map(|i| (i.to_string(), json!({ "totalGold": 500, "minionsKilled": cs * i, "jungleMinionsKilled": 1, "xp": 300 * i,
                "position": { "x": 1000 * i, "y": 12500 } }))).collect::<serde_json::Map<_, _>>()
        };
        let tl = json!({ "frames": [
            { "participantFrames": pf(0), "events": [
                { "type": "WARD_PLACED", "creatorId": 3, "wardType": "YELLOW_TRINKET", "timestamp": 95000 },
                { "type": "WARD_PLACED", "creatorId": 3, "wardType": "SIGHT_WARD", "timestamp": 200000 },
                { "type": "WARD_PLACED", "creatorId": 4, "wardType": "UNDEFINED", "timestamp": 50000 } ] },
            { "participantFrames": pf(5), "events": [
                { "type": "CHAMPION_KILL", "killerId": 1, "victimId": 7, "assistingParticipantIds": [2, 3], "timestamp": 130500 },
                { "type": "CHAMPION_KILL", "killerId": 0, "victimId": 2, "timestamp": 150000 },
                { "type": "ELITE_MONSTER_KILL", "monsterType": "DRAGON", "killerId": 8, "timestamp": 400000 },
                { "type": "ELITE_MONSTER_KILL", "monsterType": "DRAGON", "killerId": 2, "timestamp": 900000 },
                { "type": "ELITE_MONSTER_KILL", "monsterType": "BARON_NASHOR", "killerId": 4, "assistingParticipantIds": [8, 1, 5], "timestamp": 1500000 },
                { "type": "CHAMPION_KILL", "killerId": 6, "victimId": 1, "position": { "x": 7349, "y": 7051 }, "timestamp": 1600000 },
                { "type": "ELITE_MONSTER_KILL", "monsterType": "DRAGON", "monsterSubType": "ELDER_DRAGON", "killerId": 9, "assistingParticipantIds": [6], "timestamp": 1800000 } ] } ] });
        add_timeline(&mut g, &tl, &participant_ids(&detail(9)));
        assert_eq!(g["csm"][1][0], 6); // 5 minions + 1 monster
        assert_eq!(g["csm"][1][9], 51);
        assert_eq!(g["kills"][0], json!([130, 0, 6, [1, 2]]));
        assert_eq!(g["kills"][1], json!([150, -1, 1, []]));
        // first ward per player; "UNDEFINED" (not a real ward) doesn't count
        assert_eq!(g["w1"][2], 95);
        assert!(g["w1"][3].is_null());
        // the first dragon: the team of its killer (participant 8 = index 7)
        assert_eq!(g["drake1"], g["players"][7]["team"]);
        // every big objective: its team and who of that team was in on it (8 only hit the baron)
        let t = |i: usize| g["players"][i]["team"].clone();
        assert_eq!(g["obj"][0], json!([400, "D", t(7), [7], 7, 0]));
        assert_eq!(g["obj"][2], json!([1500, "B", t(3), [0, 3, 4], 3, 1]));
        assert_eq!(g["obj"][3], json!([1800, "E", t(8), [5, 8], 8, 0]));
        // a kill's place in hundreds of map units; per minute XP, jungle CS and places
        assert_eq!(g["kills"][2], json!([1600, 5, 0, [], 73, 71]));
        assert_eq!(g["xp"][1][0], 300);
        assert_eq!(g["jcs"][1][0], 1);
        assert_eq!(g["at"][1][2], json!([30, 125]));
        assert_eq!(g["v"], GAME_VERSION);
        // a timeline without ward events (the client's): no "w1" at all, not "never warded"
        let mut g2 = compact(&detail(9)).unwrap();
        let mut tl2 = tl.clone();
        tl2["frames"][0]["events"] = json!([]);
        add_timeline(&mut g2, &tl2, &participant_ids(&detail(9)));
        assert!(g2.get("w1").is_none());
        assert_eq!(g2["kills"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn upgraded_games_leave_no_dead_weight() {
        let dir = std::env::temp_dir().join(format!("rs-shrink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut m = Matches::load(&dir);
        let pad = "x".repeat(20_000);
        for id in 1..=80 {
            let mut old = compact(&detail(id)).unwrap();
            old["v"] = json!(3);
            old["pad"] = json!(pad);
            assert!(m.insert(&old));
            assert!(m.insert(&compact(&detail(id)).unwrap()));
        }
        let before = fs::metadata(m.games_file()).unwrap().len();
        assert!(m.dead_bytes().0 > 1_000_000);
        // places taken before the rewrite: afterwards they point at other bytes – nothing wrong is read
        let stale = m.entries(&["40".to_string()]);
        let m2 = Matches::load(&dir);
        let after = fs::metadata(m2.games_file()).unwrap().len();
        assert!(after * 3 < before, "{after} vs {before}");
        assert_eq!(m2.count(), 80);
        assert_eq!(m2.dead_bytes().0, 0);
        assert!(m2.outdated(100).is_empty());
        assert!(read_entries(&m2.games_file(), &stale)
            .iter()
            .all(|g| g["id"] == json!(40) || g["id"] == json!("40")));
        // the new places (from the byte copy) are right
        let g = read_entries(
            &m2.games_file(),
            &m2.entries(&["40".to_string(), "1".to_string()]),
        );
        assert_eq!(g.len(), 2);
        assert_eq!(g[0]["v"], json!(GAME_VERSION));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn others_store_progress_limit_and_no_own_files() {
        let dir = std::env::temp_dir().join(format!("rs-others-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // the own store's old file next to it must survive anything the other store does
        fs::write(dir.join("matches.json"), "{}").unwrap();
        let mut o = Matches::load_others(dir.join("matches-others"));
        let list: Vec<Value> = (1..=30)
            .map(|i| json!({ "id": i, "t": crate::riot::now_ms() - (30 - i) * 1000, "q": 420 }))
            .collect();
        assert!(o.note("p1", &list));
        assert_eq!(o.progress("p1"), (0, 30));
        assert_eq!(o.missing_for(&["p1".into()])[0], "30"); // newest first
        for id in 1..=30 {
            let mut g = compact(&detail(id)).unwrap();
            g["pad"] = json!("x".repeat(30_000));
            assert!(o.insert(&g));
        }
        assert_eq!(o.progress("p1"), (30, 30));
        assert_eq!(o.games_of("p1", &HashSet::new()).1.len(), 30);
        assert!(o.has("7"));
        // a limit: the oldest go, down to 90 % of it, and leave the list
        let gone = o.prune_to(500_000);
        assert!(gone > 0);
        assert!(o.size() <= 500_000);
        assert!(!o.has("1"));
        assert!(o.has("30"));
        assert_eq!(o.progress("p1").1, 30 - gone);
        o.clear();
        assert!(dir.join("matches.json").exists());
        assert_eq!(o.count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn others_keep_30_days_own_raw_archive() {
        let dir = std::env::temp_dir().join(format!("rs-age-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let now = crate::riot::now_ms();
        let mut o = Matches::load_others(dir.join("matches-others"));
        let old = now - OTHERS_MAX_AGE - 1000;
        let ancient = now - OTHERS_LITE_AGE - 1000;
        // a game older than a year in a match list isn't even noted; one older than 30 days is
        // (its lite form stays a year)
        o.note(
            "p",
            &[
                json!({ "id": 0, "t": ancient }),
                json!({ "id": 1, "t": old }),
                json!({ "id": 2, "t": now }),
            ],
        );
        assert_eq!(o.missing_for(&["p".into()]), vec!["2", "1"]);
        let mut g = compact(&detail(3)).unwrap();
        g["t"] = json!(old);
        o.insert(&g);
        let mut g2 = compact(&detail(2)).unwrap();
        g2["t"] = json!(now);
        o.insert(&g2);
        let mut l = lite(&list_game(4, 0)).unwrap();
        l["t"] = json!(old);
        o.insert_lite(&l);
        let mut l2 = lite(&list_game(5, 0)).unwrap();
        l2["t"] = json!(ancient);
        o.insert_lite(&l2);
        // full details go after 30 days, lite games after a year
        assert_eq!(o.prune_old(now), 2);
        assert!(!o.has("3") && o.has("2") && o.has("4") && !o.has("5"));
        // own games: the raw answers, gzip, one member per game – readable as one stream
        let own = Matches::load(&dir);
        own.append_raw("7", &json!({ "gameId": 7 }), Some(&json!({ "frames": [] })));
        own.append_raw("8", &json!({ "gameId": 8 }), None);
        let f = fs::File::open(dir.join("matches").join("raw.jsonl.gz")).unwrap();
        let mut text = String::new();
        flate2::read::MultiGzDecoder::new(f)
            .read_to_string(&mut text)
            .unwrap();
        let lines: Vec<Value> = text
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1]["game"]["gameId"], 8);
        let _ = fs::remove_dir_all(&dir);
    }
}
