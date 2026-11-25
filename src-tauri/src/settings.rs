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
        "sort": "level", "lang": "en", "theme": "system", "champPool": null, "lane": "top", "laneChosen": false, "tile": null,
        "streamer": false, "streamerHide": null, "uiScale": "100", "layout": "tiles", "seenVersion": "", "uiTabs": null,
        "othersLimit": "1000", "tagsLong": false, "tagTier": "2", "appearOffline": false
    })
    .as_object()
    .unwrap()
    .clone()
}

/// The app's language for Windows' display languages ("de-DE", "zh-Hans-CN", …, most preferred
/// first): the first one the app has, else English.
pub fn lang_for(tags: &[String]) -> &'static str {
    tags.iter()
        .filter_map(|t| {
            let base = t
                .split(['-', '_'])
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            LANGS.iter().find(|l| **l == base).copied()
        })
        .next()
        .unwrap_or("en")
}

/// Windows' display languages of this user, most preferred first (empty if Windows doesn't say).
#[cfg(not(test))]
fn windows_langs() -> Vec<String> {
    use windows::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};
    let (mut n, mut len) = (0u32, 0u32);
    // SAFETY: first call asks for the size, the second fills a buffer of that size
    unsafe {
        if GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut n,
            windows::core::PWSTR::null(),
            &mut len,
        )
        .is_err()
            || len == 0
        {
            return vec![];
        }
        let mut buf = vec![0u16; len as usize];
        if GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut n,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_err()
        {
            return vec![];
        }
        String::from_utf16_lossy(&buf)
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    }
}
#[cfg(test)]
fn windows_langs() -> Vec<String> {
    vec![]
}
/// The language on the very first start: Windows' own (see lang_for).
pub fn first_lang() -> &'static str {
    lang_for(&windows_langs())
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
        // Live: the traits up to this tier on the cards (1 key, 2 more, 3 all)
        "tagTier" => pick(&["1", "2", "3"], "2"),
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
        let l = |v: &[&str]| lang_for(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(l(&["de-DE", "en-US"]), "de");
        assert_eq!(l(&["nl-NL", "pt-BR"]), "pt");
        assert_eq!(l(&["zh-Hans-CN"]), "zh");
        assert_eq!(l(&["nl-NL"]), "en");
        assert_eq!(l(&[]), "en");
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
