//! Settings: defaults and the one place that decides what a value may be
//! (used for changes from the window and for imported files alike).

use crate::accounts::{truthy, Obj};
use serde_json::{json, Value};

pub const LANGS: [&str; 11] = [
    "en", "de", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur",
];

pub fn defaults() -> Obj {
    json!({
        "autostart": false, "startMinimized": false, "askedStart": false, "updateCheck": true, "autoAccept": false, "matchNotify": false, "autoPlay": true, "confirmSwitch": true,
        "sort": "level", "lang": "en", "theme": "system", "champPool": null, "lane": "top", "tile": null,
        "streamer": false, "streamerHide": null, "uiScale": "100", "layout": "tiles", "seenVersion": "", "uiTabs": null,
        "othersLimit": "1000", "tagsLong": false
    })
    .as_object()
    .unwrap()
    .clone()
}

fn switches(v: &Value) -> Value {
    match v.as_object() {
        Some(o) => Value::Object(
            o.iter()
                .filter(|(k, x)| {
                    (1..=20).contains(&k.len())
                        && k.chars().all(|c| c.is_ascii_alphanumeric())
                        && x.is_boolean()
                })
                .map(|(k, x)| (k.clone(), x.clone()))
                .collect(),
        ),
        None => Value::Null,
    }
}

fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Some(value) for an allowed key (value cleaned), None for a key that isn't a setting.
pub fn clean_setting(key: &str, value: &Value) -> Option<Value> {
    let defs = defaults();
    let def = defs.get(key)?;
    let s = match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    let pick = |list: &[&str], fallback: &str| {
        json!(if list.contains(&s.as_str()) {
            s.as_str()
        } else {
            fallback
        })
    };
    Some(match key {
        "tile" | "streamerHide" => switches(value),
        // the last chosen sub-tab per page ({ "dash": "mast" }) and similar small choices
        "uiTabs" => match value.as_object() {
            Some(o) => Value::Object(
                o.iter()
                    .filter(|(k, x)| {
                        let ok = |s: &str| {
                            (1..=20).contains(&s.len())
                                && s.chars().all(|c| c.is_ascii_alphanumeric())
                        };
                        ok(k) && x.as_str().is_some_and(ok)
                    })
                    .take(20)
                    .map(|(k, x)| (k.clone(), x.clone()))
                    .collect(),
            ),
            None => Value::Null,
        },
        "champPool" => match value.as_array() {
            Some(a) => Value::Array(
                a.iter()
                    .filter_map(as_num)
                    .filter(|n| n.fract() == 0.0 && *n > 0.0 && *n < 3000.0)
                    .take(40)
                    .map(|n| json!(n as i64))
                    .collect(),
            ),
            None => Value::Null,
        },
        "uiScale" => pick(&["80", "90", "100", "110", "125", "150"], "100"),
        "theme" => pick(&["system", "light", "dark"], "system"),
        "layout" => pick(&["tiles", "compact", "list"], "tiles"),
        // MB for other players' games (1 GB unless chosen; there is no "unlimited" any more – an
        // old "0" becomes 1 GB)
        "othersLimit" => pick(&["500", "1000", "2000", "5000"], "1000"),
        "seenVersion" => json!(s
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.')
            .take(16)
            .collect::<String>()),
        "sort" => pick(
            &["level", "rank", "flex", "played", "name", "custom"],
            "level",
        ),
        "lane" => pick(&["top", "jungle", "mid", "adc", "support"], "top"),
        "lang" => json!(if value.is_string() && LANGS.contains(&s.as_str()) {
            s.as_str()
        } else {
            "en"
        }),
        _ if def.is_boolean() => json!(truthy(Some(value))),
        _ => return None,
    })
}

/// Imported settings onto the current ones; machine-specific ones (start with Windows) stay.
pub fn merge_settings(target: &mut Obj, incoming: &Value) {
    let Some(inc) = incoming.as_object() else {
        return;
    };
    for (k, v) in inc {
        if k == "autostart" || (k == "lang" && !v.as_str().is_some_and(|l| LANGS.contains(&l))) {
            continue;
        }
        if let Some(x) = clean_setting(k, v) {
            target.insert(k.clone(), x);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validated() {
        assert_eq!(clean_setting("autoPlay", &json!("yes")), Some(json!(true)));
        assert_eq!(clean_setting("uiScale", &json!("999")), Some(json!("100")));
        assert_eq!(clean_setting("lang", &json!("xx")), Some(json!("en")));
        assert_eq!(
            clean_setting("theme", &json!("pink")),
            Some(json!("system"))
        );
        assert_eq!(clean_setting("lockHash", &json!("x")), None);
        assert_eq!(clean_setting("__proto__", &json!({})), None);
        assert_eq!(
            clean_setting("champPool", &json!([1, "2", -1, 5000, 1.5])),
            Some(json!([1, 2]))
        );
        assert_eq!(
            clean_setting(
                "tile",
                &json!({ "icon": false, "bad key": true, "x": "str" })
            ),
            Some(json!({ "icon": false }))
        );
        assert_eq!(
            clean_setting(
                "uiTabs",
                &json!({ "dash": "mast", "bad key": "x", "live": "a b", "n": 1 })
            ),
            Some(json!({ "dash": "mast" }))
        );
        let mut t = json!({ "autostart": true, "lang": "de" })
            .as_object()
            .unwrap()
            .clone();
        merge_settings(
            &mut t,
            &json!({ "autostart": false, "lang": "xx", "autoAccept": 1 }),
        );
        assert_eq!(t["autostart"], true);
        assert_eq!(t["lang"], "de");
        assert_eq!(t["autoAccept"], true);
    }
}
