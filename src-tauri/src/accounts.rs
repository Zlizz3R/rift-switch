//! Pure account logic: ids, logins, merging fresh rank data, LP history. No files, no network.

use serde_json::{json, Map, Value};

pub type Obj = Map<String, Value>;

pub const RANK_QUEUES: [&str; 4] = ["solo", "flex", "r5", "classic"];

/// JavaScript-like truthiness of a JSON value (null, false, 0 and "" are false).
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}
pub fn str_of<'a>(o: &'a Obj, k: &str) -> &'a str {
    o.get(k).and_then(Value::as_str).unwrap_or("")
}
pub fn num_of(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(0.0)
}

/// Riot IDs copied from the client can carry invisible direction marks (U+2066 …): remove them.
pub fn clean_text(s: &str) -> String {
    s.chars()
        .filter(
            |c| !matches!(*c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2066..=0x2069 | 0xFEFF),
        )
        .collect::<String>()
        .trim()
        .to_string()
}

/// "Name#Tag" -> (gameName, tagLine): name 2-16 characters, tag 2-5 without spaces.
pub fn parse_riot_id(s: &str) -> Option<(String, String)> {
    let s = clean_text(s);
    let (name, tag) = s.rsplit_once('#')?;
    let (nl, tl) = (name.chars().count(), tag.chars().count());
    if !(2..=16).contains(&nl)
        || !(2..=5).contains(&tl)
        || tag.chars().any(char::is_whitespace)
        || name.contains('\n')
    {
        return None;
    }
    Some((name.trim().to_string(), tag.to_string()))
}

/// Account ids from the window: a puuid or a "new-<uuid>" placeholder, nothing else.
pub fn is_id(id: &str) -> bool {
    let rest = id.strip_prefix("new-").unwrap_or(id);
    rest.len() == 36 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}
pub fn is_puuid(id: &str) -> bool {
    !id.starts_with("new-") && is_id(id)
}
pub fn is_placeholder(id: &str) -> bool {
    id.starts_with("new-")
}

/// { u, p } from the window -> trimmed user + password, or None.
pub fn valid_cred(c: &Value) -> Option<(String, String)> {
    let u = c.get("u")?.as_str()?.trim();
    let p = c.get("p")?.as_str()?;
    (!u.is_empty() && !p.is_empty()).then(|| (u.to_string(), p.to_string()))
}

/// Login name shown on a placeholder tile: "ab•••z".
pub fn mask_login(u: &str) -> String {
    let c: Vec<char> = u.chars().collect();
    match c.len() {
        0 => "•••".into(),
        1..=3 => format!("{}•••", c[0]),
        n => format!("{}{}•••{}", c[0], c[1], c[n - 1]),
    }
}

/// The match history sometimes returns only a few games: never let a short answer lower a count.
pub fn best_normals(prev: Option<&Value>, n: &Value) -> Value {
    let has_ranked = truthy(n.get("hasRanked")) || prev.is_some_and(|p| truthy(p.get("hasRanked")));
    let count = |v: &Value| num_of(v.get("count"));
    let sample = |v: &Value| num_of(v.get("sample"));
    let mut out = match prev {
        Some(p) if p.is_object() && count(n) < count(p) && sample(n) < sample(p) => {
            let mut x = p.clone();
            x["at"] = n.get("at").cloned().unwrap_or(Value::Null);
            x
        }
        _ => n.clone(),
    };
    out["hasRanked"] = json!(has_ranked);
    out
}

/// Ranked games seen in match histories, kept per account (newest first, max 300).
pub fn merge_ranked_games(a: &mut Obj, games: &[Value]) {
    if games.is_empty() {
        return;
    }
    let mut list: Vec<Value> = a
        .get("rankedGames")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for g in games {
        match list.iter_mut().find(|x| x.get("id") == g.get("id")) {
            Some(x) => *x = g.clone(),
            None => list.push(g.clone()),
        }
    }
    list.sort_by(|x, y| num_of(y.get("t")).total_cmp(&num_of(x.get("t"))));
    list.truncate(300);
    a.insert("rankedGames".into(), Value::Array(list));
}

/// Unknown win/loss (another account's view) -> keep the last real numbers from its own login.
pub fn keep_wl(q: Value, prev: Option<&Value>) -> Value {
    let Some(prev) = prev else { return q };
    if q.get("wl") != Some(&json!(false)) || prev.get("wl") != Some(&json!(true)) {
        return q;
    }
    let mut q = q;
    q["wins"] = prev.get("wins").cloned().unwrap_or(Value::Null);
    q["losses"] = prev.get("losses").cloned().unwrap_or(Value::Null);
    q["wl"] = json!(true);
    q["wlStale"] = json!(true);
    q
}

fn rank_key(q: Option<&Value>) -> String {
    match q {
        Some(q) if !q.is_null() => format!(
            "{}|{}|{}",
            q.get("tier").unwrap_or(&Value::Null),
            q.get("division").unwrap_or(&Value::Null),
            q.get("lp").unwrap_or(&Value::Null)
        ),
        _ => "-".into(),
    }
}

/// LP history: one entry whenever Solo/Duo or Flex changes (max 300).
pub fn record_history(a: &mut Obj, now: i64) {
    if !truthy(a.get("solo")) && !truthy(a.get("flex")) {
        return;
    }
    let pick = |q: Option<&Value>| match q {
        Some(q) if q.is_object() => {
            json!({ "tier": q.get("tier"), "division": q.get("division"), "lp": q.get("lp") })
        }
        _ => Value::Null,
    };
    let e = json!({ "t": now, "solo": pick(a.get("solo")), "flex": pick(a.get("flex")) });
    let h = a.entry("history").or_insert_with(|| json!([]));
    if !h.is_array() {
        *h = json!([]);
    }
    let h = h.as_array_mut().unwrap();
    if let Some(last) = h.last() {
        if rank_key(last.get("solo")) == rank_key(e.get("solo"))
            && rank_key(last.get("flex")) == rank_key(e.get("flex"))
        {
            return;
        }
    }
    h.push(e);
    if h.len() > 300 {
        let cut = h.len() - 300;
        h.drain(..cut);
    }
}

/// Fresh data for one account merged into the list; returns the index of the merged account.
pub fn upsert_into(list: &mut Vec<Obj>, mut acc: Obj, now: i64) -> usize {
    let puuid = str_of(&acc, "puuid").to_string();
    let i = list.iter().position(|a| str_of(a, "puuid") == puuid);
    let prev: Obj = match i {
        Some(i) => list[i].clone(),
        None => {
            let mut p = Obj::new();
            p.insert("note".into(), json!(""));
            p.insert("addedAt".into(), json!(now));
            p
        }
    };
    for k in RANK_QUEUES {
        if truthy(acc.get(k)) {
            let q = acc.remove(k).unwrap();
            acc.insert(k.into(), keep_wl(q, prev.get(k)));
        }
    }
    // the same decay count as before keeps its first reading time: otherwise every poll would
    // change the account (a new file write and a redrawn window every few seconds for nothing)
    if let (Some(new), Some(old)) = (acc.get("decay"), prev.get("decay")) {
        if new.is_object() && new.get("q") == old.get("q") {
            acc.insert("decay".into(), old.clone());
        }
    }
    let mut merged = prev;
    for (k, v) in acc {
        merged.insert(k, v);
    }
    merged.remove("updatedAt");
    record_history(&mut merged, now);
    match i {
        Some(i) => {
            list[i] = merged;
            i
        }
        None => {
            list.push(merged);
            list.len() - 1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const P1: &str = "11111111-1111-1111-1111-111111111111";

    fn obj(v: Value) -> Obj {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn ids_and_logins() {
        assert!(is_id(P1));
        assert!(is_id(&format!("new-{P1}")));
        assert!(!is_id("../etc"));
        assert!(is_placeholder(&format!("new-{P1}")));
        assert_eq!(
            valid_cred(&json!({ "u": " me ", "p": "pw" })),
            Some(("me".into(), "pw".into()))
        );
        assert_eq!(valid_cred(&json!({ "u": "me", "p": "" })), None);
        assert_eq!(mask_login("zlizzer"), "zl•••r");
        assert_eq!(mask_login("ab"), "a•••");
        assert_eq!(mask_login(""), "•••");
    }

    #[test]
    fn normals_never_lowered() {
        let prev = json!({ "count": 8, "sample": 50, "hasRanked": false });
        let short = best_normals(
            Some(&prev),
            &json!({ "count": 2, "sample": 5, "hasRanked": false, "at": 9 }),
        );
        assert_eq!(short["count"], 8);
        assert_eq!(short["at"], 9);
        assert_eq!(
            best_normals(
                Some(&prev),
                &json!({ "count": 9, "sample": 50, "hasRanked": false })
            )["count"],
            9
        );
        let r = best_normals(
            Some(&json!({ "count": 1, "sample": 50, "hasRanked": true })),
            &json!({ "count": 1, "sample": 50, "hasRanked": false }),
        );
        assert_eq!(r["hasRanked"], true);
    }

    #[test]
    fn ranked_games_merged() {
        let mut a = obj(json!({ "rankedGames": [{ "id": 1, "t": 1 }] }));
        merge_ranked_games(
            &mut a,
            &[
                json!({ "id": 2, "t": 5 }),
                json!({ "id": 1, "t": 1, "win": true }),
            ],
        );
        let ids: Vec<i64> = a["rankedGames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["id"].as_i64().unwrap())
            .collect();
        assert_eq!(ids, vec![2, 1]);
        assert_eq!(a["rankedGames"][1]["win"], true);
        let many: Vec<Value> = (0..400)
            .map(|i| json!({ "id": 100 + i, "t": 100 + i }))
            .collect();
        merge_ranked_games(&mut a, &many);
        assert_eq!(a["rankedGames"].as_array().unwrap().len(), 300);
    }

    #[test]
    fn upsert_keeps_ranks_and_history() {
        let mut list = vec![];
        upsert_into(
            &mut list,
            obj(
                json!({ "puuid": P1, "solo": { "tier": "GOLD", "division": "II", "lp": 10, "wins": 5, "losses": 5, "wl": true } }),
            ),
            1,
        );
        upsert_into(
            &mut list,
            obj(
                json!({ "puuid": P1, "solo": { "tier": "GOLD", "division": "II", "lp": 30, "wins": 7, "losses": 0, "wl": false } }),
            ),
            2,
        );
        assert_eq!(list[0]["solo"]["losses"], 5);
        assert_eq!(list[0]["solo"]["wlStale"], true);
        assert_eq!(list[0]["solo"]["lp"], 30);
        upsert_into(&mut list, obj(json!({ "puuid": P1, "level": 40 })), 3);
        assert_eq!(list[0]["solo"]["lp"], 30);
        assert_eq!(list[0]["history"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn unchanged_poll_changes_nothing() {
        let mut list = vec![];
        let cur = |at: i64, days: i64| {
            obj(json!({ "puuid": P1, "level": 40, "decay": { "q": { "flex": days }, "at": at } }))
        };
        upsert_into(&mut list, cur(1, 28), 1);
        let before = Value::Object(list[0].clone()).to_string();
        upsert_into(&mut list, cur(2, 28), 2);
        assert_eq!(Value::Object(list[0].clone()).to_string(), before);
        upsert_into(&mut list, cur(3, 27), 3);
        assert_eq!(list[0]["decay"]["at"], 3);
    }

    #[test]
    fn riot_ids_cleaned() {
        assert_eq!(
            parse_riot_id("\u{2066}Zlizz3Rnotpbe\u{2069}#\u{2066}187\u{2069}"),
            Some(("Zlizz3Rnotpbe".into(), "187".into()))
        );
        assert_eq!(
            parse_riot_id(" Name With Space#EUW "),
            Some(("Name With Space".into(), "EUW".into()))
        );
        assert_eq!(parse_riot_id("NoTag"), None);
    }
}
