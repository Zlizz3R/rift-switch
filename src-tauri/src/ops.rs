//! What the window's buttons do to the account list – categories, order, penalties – and a few
//! small decisions of the background part, as plain functions (tested below; main.rs only calls them
//! and saves).

use crate::accounts::{str_of, truthy, Obj};
use crate::store::State;
use serde_json::{json, Value};

// ---------- categories ----------

/// New category at the end; an empty name becomes `default_name`. Returns its id.
pub fn cat_add(st: &mut State, name: &str, default_name: &str, id: &str) -> String {
    let name: String = name.trim().chars().take(32).collect();
    let name = if name.is_empty() {
        default_name.to_string()
    } else {
        name
    };
    st.categories.push(
        json!({ "id": id, "name": name, "collapsed": false })
            .as_object()
            .unwrap()
            .clone(),
    );
    id.to_string()
}
/// false = unknown category or empty name (nothing changed)
pub fn cat_rename(st: &mut State, id: &str, name: &str) -> bool {
    let n: String = name.trim().chars().take(32).collect();
    if n.is_empty() {
        return false;
    }
    match st.categories.iter_mut().find(|x| str_of(x, "id") == id) {
        Some(c) => {
            c.insert("name".into(), json!(n));
            true
        }
        None => false,
    }
}
pub fn cat_toggle(st: &mut State, id: &str) -> bool {
    match st.categories.iter_mut().find(|x| str_of(x, "id") == id) {
        Some(c) => {
            let v = !truthy(c.get("collapsed"));
            c.insert("collapsed".into(), json!(v));
            true
        }
        None => false,
    }
}
/// One place up (dir < 0) or down; false at either end.
pub fn cat_move(st: &mut State, id: &str, dir: f64) -> bool {
    let Some(i) = st.categories.iter().position(|x| str_of(x, "id") == id) else {
        return false;
    };
    let j = if dir < 0.0 {
        i.checked_sub(1)
    } else {
        Some(i + 1)
    };
    match j.filter(|j| *j < st.categories.len()) {
        Some(j) => {
            st.categories.swap(i, j);
            true
        }
        None => false,
    }
}
/// The category goes; its accounts stay, without a category.
pub fn cat_del(st: &mut State, id: &str) {
    st.categories.retain(|x| str_of(x, "id") != id);
    for a in &mut st.accounts {
        if str_of(a, "category") == id {
            a.remove("category");
        }
    }
}

/// New order of the tiles: `list` is [{ puuid, category }] ("arrange", drag & drop / "move to") or
/// [puuid] ("reorder"). Unknown ids and repeats are ignored, accounts missing from the list keep
/// their place at the end, a category that doesn't exist means none.
pub fn arrange(st: &mut State, list: &[Value], with_categories: bool) {
    let mut next: Vec<Obj> = vec![];
    for item in list {
        let (id, cat) = if with_categories {
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
        let Some(mut acc) = st.account(id).cloned() else {
            continue;
        };
        if with_categories {
            match cat
                .filter(|k| !k.is_empty() && st.categories.iter().any(|x| str_of(x, "id") == *k))
            {
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
    for a in &st.accounts {
        if !next
            .iter()
            .any(|x| str_of(x, "puuid") == str_of(a, "puuid"))
        {
            next.push(a.clone());
        }
    }
    st.accounts = next;
}

// ---------- penalties ----------

/// An account's known penalties (from its own last login): kept until they run out.
pub fn set_penalties(a: &mut Obj, list: Vec<Value>, now: i64) {
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

/// The low priority queue of an account, kept until it is really over (not only this game's wait):
/// lowPrio = { games?, perGame? (seconds), at }.
/// `queue`: what a running search says (Some(0) = searching without it -> over).
/// `notice_games`: games left from the LeaverBuster notices (Some(None) = notices read, none left).
pub fn set_low_prio(
    a: &mut Obj,
    queue: Option<i64>,
    notice_games: Option<Option<i64>>,
    now: i64,
) -> bool {
    let before = a.get("lowPrio").cloned();
    let mut lp = before
        .clone()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    match queue {
        Some(0) => {
            lp.clear();
        }
        Some(s) => {
            lp.insert("perGame".into(), json!(s));
        }
        None => {}
    }
    match notice_games {
        Some(Some(g)) => {
            lp.insert("games".into(), json!(g));
        }
        // the notices said nothing more: over, if they were what told us
        Some(None) if lp.contains_key("games") => {
            lp.clear();
        }
        _ => {}
    }
    if lp.is_empty() {
        a.remove("lowPrio");
    } else {
        lp.insert("at".into(), json!(now));
        a.insert("lowPrio".into(), Value::Object(lp));
    }
    let after = a.get("lowPrio");
    before.as_ref().map(|v| {
        let mut v = v.clone();
        v.as_object_mut().map(|o| o.remove("at"));
        v
    }) != after.map(|v| {
        let mut v = v.clone();
        v.as_object_mut().map(|o| o.remove("at"));
        v
    })
}

// ---------- small decisions ----------

/// How long until the next look at League (ms). Fast while the window is open or something waits
/// (a login, an add, a queue for auto-accept, a waiting time); in the tray 15 s, 60 s once the
/// client's events are connected (they wake the app up when something happens).
pub fn poll_ms(waiting: bool, queue: bool, window_open: bool, events: bool) -> u64 {
    if waiting || queue || window_open {
        if events && !waiting {
            10_000
        } else {
            4_000
        }
    } else if events {
        60_000
    } else {
        15_000
    }
}

/// op.gg multi-search for up to 5 Riot IDs; None without any.
pub fn opgg_multi_url(region: &str, ids: &[Value]) -> Option<String> {
    let list: Vec<String> = ids
        .iter()
        .take(5)
        .map(|x| {
            x.as_str()
                .unwrap_or("")
                .chars()
                .filter(|c| c.is_alphanumeric() || " #_.-".contains(*c))
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .collect();
    if list.is_empty() {
        return None;
    }
    let reg: String = region
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
    Some(format!("https://op.gg/multisearch/{reg}?summoners={q}"))
}

/// Links the window may open: the stats sites and the support page, nothing else.
pub fn allowed_url(u: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::normalize;

    fn st() -> State {
        normalize(json!({
            "accounts": [{ "puuid": "a" }, { "puuid": "b", "category": "c1" }, { "puuid": "c" }],
            "categories": [{ "id": "c1", "name": "One" }, { "id": "c2", "name": "Two" }] }))
    }
    fn order(s: &State) -> Vec<String> {
        s.accounts
            .iter()
            .map(|a| str_of(a, "puuid").to_string())
            .collect()
    }

    #[test]
    fn categories() {
        let mut s = st();
        assert_eq!(cat_add(&mut s, "   ", "New category", "c3"), "c3");
        assert_eq!(s.categories[2]["name"], "New category");
        cat_add(&mut s, &"x".repeat(50), "N", "c4");
        assert_eq!(s.categories[3]["name"].as_str().unwrap().len(), 32);
        assert!(cat_rename(&mut s, "c1", " Mains "));
        assert_eq!(s.categories[0]["name"], "Mains");
        assert!(!cat_rename(&mut s, "c1", "  "));
        assert!(!cat_rename(&mut s, "nope", "x"));
        assert!(cat_toggle(&mut s, "c2"));
        assert_eq!(s.categories[1]["collapsed"], true);
        assert!(cat_toggle(&mut s, "c2"));
        assert_eq!(s.categories[1]["collapsed"], false);
        assert!(!cat_move(&mut s, "c1", -1.0), "first can't go up");
        assert!(cat_move(&mut s, "c1", 1.0));
        assert_eq!(s.categories[1]["id"], "c1");
        assert!(!cat_move(&mut s, "c4", 1.0), "last can't go down");
        cat_del(&mut s, "c1");
        assert!(s.categories.iter().all(|c| c["id"] != "c1"));
        assert!(
            s.accounts[1].get("category").is_none(),
            "its accounts stay, without category"
        );
        assert_eq!(s.accounts.len(), 3);
    }

    #[test]
    fn drag_and_drop_order() {
        let mut s = st();
        arrange(
            &mut s,
            &[
                json!({ "puuid": "c", "category": "c2" }),
                json!({ "puuid": "a" }),
                json!({ "puuid": "c" }),
                json!({ "puuid": "zz" }),
            ],
            true,
        );
        assert_eq!(
            order(&s),
            ["c", "a", "b"],
            "repeats and unknown ids ignored, the rest keeps its place"
        );
        assert_eq!(s.accounts[0]["category"], "c2");
        assert!(s.accounts[1].get("category").is_none());
        arrange(&mut s, &[json!({ "puuid": "a", "category": "gone" })], true);
        assert!(
            s.account("a").unwrap().get("category").is_none(),
            "a category that doesn't exist = none"
        );
        arrange(&mut s, &[json!("b"), json!("a")], false);
        assert_eq!(order(&s), ["b", "a", "c"]);
        assert_eq!(
            s.account("b").unwrap()["category"],
            "c1",
            "reorder keeps categories"
        );
    }

    #[test]
    fn penalties_run_out() {
        let mut a = Obj::new();
        set_penalties(
            &mut a,
            vec![
                json!({ "code": "A", "until": 50 }),
                json!({ "code": "B", "until": 0 }),
                json!({ "code": "C", "until": 500 }),
            ],
            100,
        );
        let codes: Vec<&str> = a["penalties"]["list"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["code"].as_str().unwrap())
            .collect();
        assert_eq!(codes, ["B", "C"], "run out = gone, no end = kept");
        set_penalties(&mut a, vec![json!({ "code": "A", "until": 50 })], 100);
        assert!(a.get("penalties").is_none());
    }

    #[test]
    fn polling_pace() {
        assert_eq!(
            poll_ms(false, false, false, false),
            15_000,
            "tray, no events"
        );
        assert_eq!(
            poll_ms(false, false, false, true),
            60_000,
            "tray, events wake it"
        );
        assert_eq!(poll_ms(false, false, true, true), 10_000, "window open");
        assert_eq!(poll_ms(true, false, true, true), 4_000, "a login waits");
        assert_eq!(
            poll_ms(false, true, false, false),
            4_000,
            "queue with auto-accept"
        );
    }

    #[test]
    fn links() {
        assert_eq!(
            opgg_multi_url("EUW", &[json!("A b#EUW"), json!("<x>#1")]).unwrap(),
            "https://op.gg/multisearch/euw?summoners=A%20b%23EUW%2Cx%231"
        );
        assert_eq!(
            opgg_multi_url("", &[json!("A#1")]).unwrap(),
            "https://op.gg/multisearch/euw?summoners=A%231"
        );
        assert!(opgg_multi_url("euw", &[]).is_none());
        assert_eq!(
            opgg_multi_url(
                "na1",
                &(0..9).map(|i| json!(format!("P{i}#1"))).collect::<Vec<_>>()
            )
            .unwrap()
            .matches("%2C")
            .count(),
            4,
            "5 at most"
        );
        assert!(allowed_url("https://www.op.gg/summoners/euw/A-1"));
        assert!(allowed_url("https://buymeacoffee.com/zlizz3r"));
        assert!(!allowed_url("https://op.gg.evil.com/"));
        assert!(!allowed_url("http://op.gg/"));
        assert!(!allowed_url("file:///C:/Windows"));
    }
    #[test]
    fn low_prio_stays_until_over() {
        let mut a = Obj::new();
        assert!(set_low_prio(&mut a, Some(60), None, 1));
        assert_eq!(a["lowPrio"]["perGame"], 60);
        // between games (no search): kept
        assert!(!set_low_prio(&mut a, None, None, 2));
        assert!(a.contains_key("lowPrio"));
        assert!(set_low_prio(&mut a, None, Some(Some(2)), 3));
        assert_eq!(a["lowPrio"]["games"], 2);
        // the notices drop it: over
        assert!(set_low_prio(&mut a, None, Some(None), 4));
        assert!(!a.contains_key("lowPrio"));
        // a search without it: over
        set_low_prio(&mut a, Some(60), None, 5);
        assert!(set_low_prio(&mut a, Some(0), None, 6));
        assert!(!a.contains_key("lowPrio"));
    }
}
