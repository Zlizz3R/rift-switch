//! Texts of the background part (tray, jump list) and what the tray menu shows, as plain data.

use crate::accounts::{str_of, truthy, Obj};
use crate::store::State;
use serde_json::Value;
use std::sync::OnceLock;

fn strings() -> &'static Value {
    static S: OnceLock<Value> = OnceLock::new();
    S.get_or_init(|| serde_json::from_str(include_str!("../strings.json")).unwrap_or(Value::Null))
}

/// t(lang, key, vars) like ui/i18n.js: falls back to English, fills {app} and {name}-style vars.
pub fn tr(lang: &str, key: &str, vars: &[(&str, &str)]) -> String {
    let s = strings();
    let get = |l: &str, k: &str| {
        s.get(l)
            .and_then(|x| x.get(k))
            .and_then(Value::as_str)
            .map(String::from)
    };
    let mut t = get(lang, key)
        .or_else(|| get("en", key))
        .unwrap_or_else(|| key.to_string());
    if t.contains("{app}") {
        let app = get(lang, "app.name")
            .or_else(|| get("en", "app.name"))
            .unwrap_or_else(|| "Rift Switch".into());
        t = t.replace("{app}", &app);
    }
    for (k, v) in vars {
        t = t.replace(&format!("{{{k}}}"), v);
    }
    t
}

const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];

fn hides(st: &State, k: &str) -> bool {
    if !st.set_bool("streamer") {
        return false;
    }
    let def = matches!(k, "name" | "tag" | "login");
    st.settings
        .get("streamerHide")
        .and_then(|h| h.get(k))
        .and_then(Value::as_bool)
        .unwrap_or(def)
}

/// Streamer mode: same rules as the window (renderer.js dispName).
pub fn display_name(a: &Obj, st: &State) -> String {
    let lang = st.lang();
    let placeholder_hidden =
        truthy(a.get("placeholder")) && !truthy(a.get("tagLine")) && hides(st, "login");
    if !hides(st, "name") && !placeholder_hidden {
        let name = str_of(a, "gameName");
        let name = if name == "Gespeicherter Login" {
            tr(&lang, "tile.savedLogin", &[])
        } else {
            name.to_string()
        };
        let tag = str_of(a, "tagLine");
        return if !tag.is_empty() && !hides(st, "tag") {
            format!("{name}#{tag}")
        } else {
            name
        };
    }
    let note = str_of(a, "note");
    if !note.is_empty() && !hides(st, "note") {
        return note.to_string();
    }
    let n = st
        .accounts
        .iter()
        .position(|x| std::ptr::eq(x, a))
        .map_or(0, |i| i + 1);
    tr(&lang, "stream.alias", &[("n", &n.to_string())])
}

fn rank_text(q: &Value, lang: &str) -> String {
    let tier = q.get("tier").and_then(Value::as_str).unwrap_or("");
    let t = tr(lang, &format!("tier.{tier}"), &[]);
    if APEX.contains(&tier) {
        t
    } else {
        format!(
            "{t} {}",
            q.get("division").and_then(Value::as_str).unwrap_or("")
        )
    }
}

#[derive(Debug, PartialEq)]
pub enum Item {
    Account {
        puuid: String,
        label: String,
        checked: bool,
    },
    Header(String),
    Locked(String),
    Separator,
}

pub fn account_items(st: &State, locked: bool) -> Vec<Item> {
    let lang = st.lang();
    if locked {
        return vec![
            Item::Locked(format!("🔒 {}", tr(&lang, "lock.locked", &[]))),
            Item::Separator,
        ];
    }
    let item = |a: &Obj| {
        let mut label = display_name(a, st);
        if let Some(q) = a.get("solo").filter(|q| q.is_object()) {
            if !hides(st, "ranks") {
                label += &format!("   ·   {}", rank_text(q, &lang));
            }
        }
        Item::Account {
            puuid: str_of(a, "puuid").into(),
            label,
            checked: st.active.as_deref() == Some(str_of(a, "puuid")),
        }
    };
    let cat_ids: Vec<&str> = st.categories.iter().map(|c| str_of(c, "id")).collect();
    let mut out = vec![];
    let loose: Vec<&Obj> = st
        .accounts
        .iter()
        .filter(|a| !cat_ids.contains(&str_of(a, "category")))
        .collect();
    if !loose.is_empty() {
        out.extend(loose.into_iter().map(item));
        out.push(Item::Separator);
    }
    for c in &st.categories {
        let list: Vec<&Obj> = st
            .accounts
            .iter()
            .filter(|a| str_of(a, "category") == str_of(c, "id"))
            .collect();
        if !list.is_empty() {
            out.push(Item::Header(str_of(c, "name").into()));
            out.extend(list.into_iter().map(item));
            out.push(Item::Separator);
        }
    }
    out
}

/// Taskbar jump list: (account id, title, description), up to 10, none while locked.
pub fn jump_tasks(st: &State, locked: bool) -> Vec<(String, String, String)> {
    if locked {
        return vec![];
    }
    let lang = st.lang();
    st.accounts
        .iter()
        .filter(|a| !truthy(a.get("placeholder")) || truthy(a.get("hasCred")))
        .take(10)
        .map(|a| {
            let name = display_name(a, st);
            (
                str_of(a, "puuid").into(),
                name.clone(),
                tr(&lang, "jump.switch", &[("name", &name)]),
            )
        })
        .collect()
}

/// The account id from "--switch=<id>" on the command line, if it is one of ours.
pub fn switch_arg(argv: &[String], st: &State) -> Option<String> {
    let id = argv.iter().find_map(|x| x.strip_prefix("--switch="))?;
    (crate::accounts::is_id(id) && st.has(id)).then(|| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::normalize;
    use serde_json::json;
    const P1: &str = "11111111-1111-1111-1111-111111111111";
    const P2: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn tray_and_jump_list() {
        let mut st = normalize(
            json!({ "active": P1, "categories": [{ "id": "c1", "name": "Friends" }],
            "accounts": [{ "puuid": P1, "gameName": "Main", "tagLine": "EUW", "solo": { "tier": "DIAMOND", "division": "II" } },
                         { "puuid": P2, "gameName": "Second", "tagLine": "EUW", "category": "c1" }] }),
        );
        let items = account_items(&st, false);
        match &items[0] {
            Item::Account { label, checked, .. } => {
                assert!(label.starts_with("Main#EUW"));
                assert!(*checked);
            }
            _ => panic!(),
        }
        assert!(items.contains(&Item::Header("Friends".into())));
        assert_eq!(account_items(&st, true).len(), 2);
        st.settings.insert("streamer".into(), json!(true));
        match &account_items(&st, false)[0] {
            Item::Account { label, .. } => assert!(!label.contains("Main")),
            _ => panic!(),
        }
        assert!(jump_tasks(&st, true).is_empty());
        assert_eq!(jump_tasks(&st, false)[0].0, P1);
        assert_eq!(
            switch_arg(&["app.exe".into(), format!("--switch={P2}")], &st),
            Some(P2.to_string())
        );
        assert_eq!(
            switch_arg(&[format!("--switch={}", "3".repeat(36))], &st),
            None
        );
    }

    #[test]
    fn texts() {
        assert_eq!(tr("de", "tray.quit", &[]), "Beenden");
        assert_eq!(tr("xx", "tray.quit", &[]), "Quit");
        assert!(tr("de", "tray.open", &[]).contains("öffnen"));
    }
}
