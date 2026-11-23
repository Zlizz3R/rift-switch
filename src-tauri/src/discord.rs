//! Discord status ("Rich Presence") over Discord's local pipe – no library, no network.
//! Shows what you are doing ("In champion select", "In game") and, if you want, your Solo/Duo rank
//! and in a game your champion and queue. Never an account name.
//!
//! The pipe protocol: frames of [opcode u32 LE][length u32 LE][JSON]; opcode 0 = handshake,
//! 1 = command. All of it runs on one thread of its own; `set` only hands over the wanted status.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// The Discord application ("Rift Switch") whose name and picture the status shows.
/// RS_DISCORD_ID overrides it (tests). Empty = the feature isn't set up yet.
const APP_ID: &str = "";
const CDRAGON: &str = "https://raw.communitydragon.org/latest/plugins";
const LOGO: &str =
    "https://raw.githubusercontent.com/Zlizz3R/rift-switch/main/src-tauri/icons/128x128.png";

pub fn app_id() -> String {
    std::env::var("RS_DISCORD_ID").unwrap_or_else(|_| APP_ID.to_string())
}
pub fn available() -> bool {
    !app_id().trim().is_empty()
}

/// What the status is built from (kept apart from the pipe so it can be tested).
#[derive(Clone, Default, PartialEq, Debug)]
pub struct Info {
    pub phase: String,
    /// "Ranked Solo/Duo", "ARAM" … (the client's own name of the queue)
    pub queue: String,
    pub champ: i64,
    pub champ_name: String,
    /// "GOLD", "II", 54
    pub rank: Option<(String, String, i64)>,
    pub rank_text: String,
    /// when the phase began (ms)
    pub since: i64,
}

/// The activity Discord gets; None = no status (League closed, nothing to show).
/// `texts`: the phase words in the user's language ("In champion select" …).
pub fn activity(i: &Info, details: bool, texts: &dyn Fn(&str) -> String) -> Option<Value> {
    let what = match i.phase.as_str() {
        "Lobby" => "discord.lobby",
        "Matchmaking" | "ReadyCheck" => "discord.queue",
        "ChampSelect" => "discord.champSelect",
        "GameStart" | "InProgress" | "Reconnect" => "discord.inGame",
        "PreEndOfGame" | "EndOfGame" | "WaitingForStats" => "discord.afterGame",
        "" => return None,
        _ => "discord.client",
    };
    let mut a = json!({ "details": texts(what), "instance": false });
    let in_game = matches!(
        i.phase.as_str(),
        "GameStart" | "InProgress" | "Reconnect" | "ChampSelect"
    );
    let mut assets = json!({ "large_image": LOGO, "large_text": "Rift Switch" });
    if details {
        if in_game && !i.queue.is_empty() {
            a["state"] = json!(i.queue);
        }
        if in_game && i.champ > 0 {
            assets["large_image"] = json!(format!(
                "{CDRAGON}/rcp-be-lol-game-data/global/default/v1/champion-icons/{}.png",
                i.champ
            ));
            assets["large_text"] = json!(if i.champ_name.is_empty() {
                "League of Legends"
            } else {
                i.champ_name.as_str()
            });
        }
        if let Some((tier, _, _)) = &i.rank {
            assets["small_image"] = json!(format!(
                "{CDRAGON}/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-{}.png",
                tier.to_lowercase()
            ));
            assets["small_text"] = json!(i.rank_text);
        }
    }
    a["assets"] = assets;
    if i.since > 0 && i.phase != "Lobby" && i.phase != "None" {
        a["timestamps"] = json!({ "start": i.since / 1000 });
    }
    Some(a)
}

/// One frame of the pipe protocol.
pub fn frame(op: u32, body: &Value) -> Vec<u8> {
    let data = body.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

// ---------- the pipe thread ----------

static TX: OnceLock<Mutex<Sender<Option<Value>>>> = OnceLock::new();

/// The wanted status (None = clear it and let go of Discord). Cheap: the thread does the rest.
pub fn set(activity: Option<Value>) {
    let tx = TX.get_or_init(|| {
        let (tx, rx) = channel();
        std::thread::spawn(move || run(rx));
        Mutex::new(tx)
    });
    let _ = tx.lock().unwrap().send(activity);
}

fn run(rx: Receiver<Option<Value>>) {
    let mut pipe: Option<std::fs::File> = None;
    let mut wanted: Option<Value> = None;
    let mut sent: Option<Value> = None;
    loop {
        // newest wish (several may have queued up), or a retry every 15 s while Discord is closed
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(v) => {
                wanted = v;
                while let Ok(v) = rx.try_recv() {
                    wanted = v;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return,
        }
        if wanted.is_none() {
            if let Some(mut p) = pipe.take() {
                let _ = send(&mut p, &json!(null)); // clears it at once (closing would too, a little later)
            }
            sent = None;
            continue;
        }
        if pipe.is_none() {
            pipe = connect();
            sent = None;
        }
        let Some(p) = pipe.as_mut() else { continue };
        if sent != wanted {
            if send(p, wanted.as_ref().unwrap()).is_ok() {
                sent = wanted.clone();
            } else {
                pipe = None; // Discord closed: try again later
            }
        }
    }
}

fn connect() -> Option<std::fs::File> {
    let id = app_id();
    if id.trim().is_empty() {
        return None;
    }
    for n in 0..10 {
        let Ok(mut f) = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(format!(r"\\.\pipe\discord-ipc-{n}"))
        else {
            continue;
        };
        if f.write_all(&frame(0, &json!({ "v": 1, "client_id": id })))
            .is_ok()
            && read_frame(&mut f).is_some()
        {
            return Some(f);
        }
    }
    None
}

fn send(p: &mut std::fs::File, activity: &Value) -> std::io::Result<()> {
    let nonce = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let body = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity }, "nonce": nonce });
    p.write_all(&frame(1, &body))?;
    read_frame(p)
        .map(|_| ())
        .ok_or_else(|| std::io::Error::other("no answer"))
}

fn read_frame(p: &mut std::fs::File) -> Option<Value> {
    let mut head = [0u8; 8];
    p.read_exact(&mut head).ok()?;
    let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
    if len > 1 << 20 {
        return None;
    }
    let mut body = vec![0u8; len];
    p.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(k: &str) -> String {
        k.to_string()
    }

    #[test]
    fn frames_are_opcode_length_json() {
        let f = frame(1, &json!({ "a": 1 }));
        assert_eq!(&f[..4], &1u32.to_le_bytes());
        assert_eq!(&f[4..8], &7u32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
    }

    #[test]
    fn status_without_and_with_details() {
        let i = Info {
            phase: "InProgress".into(),
            queue: "Ranked Solo/Duo".into(),
            champ: 103,
            champ_name: "Ahri".into(),
            rank: Some(("GOLD".into(), "II".into(), 54)),
            rank_text: "Gold II · 54 LP".into(),
            since: 1_700_000_000_000,
        };
        let plain = activity(&i, false, &words).unwrap();
        assert_eq!(plain["details"], "discord.inGame");
        assert!(plain.get("state").is_none());
        assert!(plain["assets"].get("small_image").is_none());
        assert_eq!(plain["timestamps"]["start"], 1_700_000_000);
        let full = activity(&i, true, &words).unwrap();
        assert_eq!(full["state"], "Ranked Solo/Duo");
        assert!(full["assets"]["large_image"]
            .as_str()
            .unwrap()
            .ends_with("/103.png"));
        assert!(full["assets"]["small_image"]
            .as_str()
            .unwrap()
            .ends_with("emblem-gold.png"));
        assert_eq!(full["assets"]["small_text"], "Gold II · 54 LP");
        // nothing anywhere that names the account
        assert!(!full.to_string().contains("Player"));
        // League closed: no status
        assert!(activity(&Info::default(), true, &words).is_none());
    }
}
