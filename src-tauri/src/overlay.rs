//! In-game overlay: the gold lead of your team, worked out from the items everybody has bought
//! (gold in the bank can't be seen), and lane against lane when Riot names the positions.
//! Data: Riot's own Live Client Data API (https://127.0.0.1:2999, only while a game runs).
//! The window is small, see-through, never takes the focus and lets every click through.

use crate::riot::now_ms;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "overlay";
static RUNNING: AtomicBool = AtomicBool::new(false);
static PRICES: Mutex<Option<HashMap<i64, i64>>> = Mutex::new(None);

/// Total price of every item (CommunityDragon), kept a day in itemprices.json.
async fn prices(data_dir: &Path) -> HashMap<i64, i64> {
    if let Some(p) = PRICES.lock().unwrap().clone() {
        return p;
    }
    let file = data_dir.join("itemprices.json");
    let fresh = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < Duration::from_secs(86_400));
    let saved: Option<HashMap<i64, i64>> = fresh
        .then(|| std::fs::read_to_string(&file).ok())
        .flatten()
        .and_then(|t| serde_json::from_str(&t).ok());
    let map = match saved {
        Some(m) => m,
        None => {
            let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";
            let list: Option<Value> = match crate::riot::web_client()
                .get(url)
                .timeout(Duration::from_secs(10))
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => r
                    .text()
                    .await
                    .ok()
                    .and_then(|t| serde_json::from_str(&t).ok()),
                _ => None,
            };
            let m: HashMap<i64, i64> = list
                .as_ref()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|x| Some((x["id"].as_i64()?, x["priceTotal"].as_i64()?)))
                .collect();
            if !m.is_empty() {
                let _ = crate::store::write_atomic(
                    &file,
                    serde_json::to_string(&m).unwrap_or_default().as_bytes(),
                );
            }
            m
        }
    };
    if !map.is_empty() {
        *PRICES.lock().unwrap() = Some(map.clone());
    }
    map
}

/// The value of what one player has bought.
fn items_value(p: &Value, prices: &HashMap<i64, i64>) -> i64 {
    p["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|it| {
            let id = it["itemID"].as_i64().unwrap_or(0);
            let each = prices
                .get(&id)
                .copied()
                .or_else(|| it["price"].as_i64())
                .unwrap_or(0);
            each * it["count"].as_i64().unwrap_or(1).max(1)
        })
        .sum()
}

const POSITIONS: [(&str, &str); 5] = [
    ("TOP", "top"),
    ("JUNGLE", "jgl"),
    ("MIDDLE", "mid"),
    ("BOTTOM", "bot"),
    ("UTILITY", "sup"),
];

/// allgamedata -> { mine, theirs, lanes: [{ pos, diff }] } seen from your team.
pub fn gold_of(all: &Value, prices: &HashMap<i64, i64>) -> Option<Value> {
    let players = all["allPlayers"].as_array()?;
    let me = all["activePlayer"]["riotId"]
        .as_str()
        .or(all["activePlayer"]["summonerName"].as_str())?;
    let same =
        |p: &Value| p["riotId"].as_str() == Some(me) || p["summonerName"].as_str() == Some(me);
    let my_team = players.iter().find(|p| same(p))?["team"]
        .as_str()?
        .to_string();
    let (mut mine, mut theirs) = (0, 0);
    let mut by_pos: HashMap<&str, (Option<i64>, Option<i64>)> = HashMap::new();
    for p in players {
        let v = items_value(p, prices);
        let ours = p["team"].as_str() == Some(my_team.as_str());
        if ours {
            mine += v;
        } else {
            theirs += v;
        }
        if let Some((_, short)) = POSITIONS
            .iter()
            .find(|(k, _)| p["position"].as_str() == Some(*k))
        {
            let e = by_pos.entry(short).or_default();
            if ours {
                e.0 = Some(v);
            } else {
                e.1 = Some(v);
            }
        }
    }
    // lanes only when both teams name all five positions (not in ARAM, Arena …)
    let lanes: Vec<Value> = POSITIONS
        .iter()
        .filter_map(|(_, s)| match by_pos.get(s) {
            Some((Some(a), Some(b))) => Some(json!({ "pos": s, "diff": a - b })),
            _ => None,
        })
        .collect();
    Some(
        json!({ "mine": mine, "theirs": theirs, "lanes": if lanes.len() == 5 { lanes } else { vec![] } }),
    )
}

/// Runs while a game is on (started by the tick when the phase is InProgress); closes the window
/// when the game API stops answering.
pub fn start(app: AppHandle, data_dir: std::path::PathBuf, lang: String) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let prices = prices(&data_dir).await;
        let mut misses = 0;
        let started = now_ms();
        loop {
            if !crate::overlay_wanted() {
                break;
            }
            let data = crate::riot::live_game_data().await;
            match data.as_ref().and_then(|d| gold_of(d, &prices)) {
                Some(g) => {
                    misses = 0;
                    show(&app, &g, &lang);
                }
                None => {
                    misses += 1;
                    // the game API needs a while at the start; after the game it stops answering
                    let limit = if now_ms() - started < 180_000 { 120 } else { 5 };
                    if misses >= limit {
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(2000)).await;
        }
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

fn show(app: &AppHandle, g: &Value, lang: &str) {
    let w = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => {
            let Some(w) = create(app) else { return };
            w
        }
    };
    let _ = w.eval(format!(
        "window.update && window.update({}, {})",
        g,
        json!(lang)
    ));
}

fn create(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let mon = app.primary_monitor().ok().flatten()?;
    let scale = mon.scale_factor();
    let size = mon.size().to_logical::<f64>(scale);
    let pos = mon.position().to_logical::<f64>(scale);
    let (w, h) = (360.0, 64.0);
    // top middle, under the score bar of the game
    let x = pos.x + (size.width - w) / 2.0;
    let y = pos.y + size.height * 0.085;
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Rift Switch overlay")
        .inner_size(w, h)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .additional_browser_args(&crate::browser_args())
        .build()
        .ok()?;
    let _ = win.set_ignore_cursor_events(true);
    Some(win)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gold_from_items() {
        let prices: HashMap<i64, i64> = [(1001, 300), (3006, 1100), (2003, 50)].into();
        let p = |id: &str, team: &str, pos: &str, items: Value| json!({ "riotId": id, "team": team, "position": pos, "items": items });
        let mut all = json!({ "activePlayer": { "riotId": "Me#EUW" }, "allPlayers": [] });
        let mut list = vec![];
        for (i, (k, _)) in POSITIONS.iter().enumerate() {
            let mine = if i == 0 {
                "Me#EUW".to_string()
            } else {
                format!("A{i}")
            };
            list.push(p(
                &mine,
                "ORDER",
                k,
                json!([{ "itemID": 3006, "count": 1 }, { "itemID": 2003, "count": 2 }]),
            ));
            list.push(p(
                &format!("B{i}"),
                "CHAOS",
                k,
                json!([{ "itemID": 1001, "count": 1 }]),
            ));
        }
        all["allPlayers"] = json!(list);
        let g = gold_of(&all, &prices).unwrap();
        assert_eq!(g["mine"], 5 * 1200);
        assert_eq!(g["theirs"], 5 * 300);
        assert_eq!(g["lanes"].as_array().unwrap().len(), 5);
        assert_eq!(g["lanes"][0], json!({ "pos": "top", "diff": 900 }));
        // ARAM: no positions -> team totals only
        for p in all["allPlayers"].as_array_mut().unwrap() {
            p["position"] = json!("");
        }
        let g = gold_of(&all, &prices).unwrap();
        assert!(g["lanes"].as_array().unwrap().is_empty());
        // unknown price: the API's own number
        assert_eq!(
            items_value(&json!({ "items": [{ "itemID": 9, "price": 75 }] }), &prices),
            75
        );
    }
}
