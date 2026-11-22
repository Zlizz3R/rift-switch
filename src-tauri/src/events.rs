//! Live events from the League client (its WebSocket, WAMP protocol) instead of asking every few
//! seconds. The app still polls slowly as a safety net; events just make it react right away.

use crate::riot::Lock;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

pub const TOPICS: [&str; 5] = [
    "/lol-gameflow/v1/gameflow-phase",
    "/lol-matchmaking/v1/ready-check",
    "/lol-summoner/v1/current-summoner",
    "/lol-ranked/v1/current-ranked-stats",
    "/lol-end-of-game/v1/eog-stats-block",
];
pub fn event_name(uri: &str) -> String {
    format!("OnJsonApiEvent{}", uri.replace('/', "_"))
}

pub struct Event {
    pub uri: String,
    pub data: Value,
}

/// One WAMP message -> an API event ([8, "OnJsonApiEvent_…", { uri, eventType, data }]), else None.
pub fn parse_event(raw: &str) -> Option<Event> {
    let m: Value = serde_json::from_str(raw).ok()?;
    let a = m.as_array()?;
    if a.first()?.as_i64()? != 8 {
        return None;
    }
    let p = a.get(2)?;
    Some(Event { uri: p.get("uri")?.as_str()?.to_string(), data: p.get("data").cloned().unwrap_or(Value::Null) })
}

static CONNECTED: AtomicBool = AtomicBool::new(false);
static PORT: Mutex<Option<String>> = Mutex::new(None);

pub fn connected() -> bool {
    CONNECTED.load(Ordering::Relaxed)
}

/// Keeps one connection to the client of `lf`; no-op while already connected (or connecting) to it.
pub fn connect(lf: Option<Lock>, tx: UnboundedSender<Event>) {
    let Some(lf) = lf else {
        *PORT.lock().unwrap() = None;
        return;
    };
    {
        let mut p = PORT.lock().unwrap();
        if p.as_deref() == Some(lf.port.as_str()) {
            return;
        }
        *p = Some(lf.port.clone());
    }
    tauri::async_runtime::spawn(async move {
        let port = lf.port.clone();
        let _ = run(lf, tx).await;
        CONNECTED.store(false, Ordering::Relaxed);
        let mut p = PORT.lock().unwrap();
        if p.as_deref() == Some(port.as_str()) {
            *p = None; // the next poll tries again
        }
    });
}

async fn run(lf: Lock, tx: UnboundedSender<Event>) -> Option<()> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let mut req = format!("wss://127.0.0.1:{}/", lf.port).into_client_request().ok()?;
    let h = req.headers_mut();
    h.insert("Authorization", format!("Basic {}", B64.encode(format!("riot:{}", lf.password))).parse().ok()?);
    h.insert("Sec-WebSocket-Protocol", "wamp".parse().ok()?);
    // the client uses its own self-signed certificate
    let tls = native_tls::TlsConnector::builder().danger_accept_invalid_certs(true).danger_accept_invalid_hostnames(true).build().ok()?;
    let conn = tokio_tungstenite::connect_async_tls_with_config(req, None, false, Some(tokio_tungstenite::Connector::NativeTls(tls)));
    let (mut ws, _) = tokio::time::timeout(std::time::Duration::from_secs(4), conn).await.ok()?.ok()?;
    for t in TOPICS {
        ws.send(Message::text(json!([5, event_name(t)]).to_string())).await.ok()?;
    }
    CONNECTED.store(true, Ordering::Relaxed);
    while let Some(msg) = ws.next().await {
        // a newer client (other port) took over: stop this one
        if PORT.lock().unwrap().as_deref() != Some(lf.port.as_str()) {
            break;
        }
        match msg.ok()? {
            Message::Text(t) => {
                if let Some(ev) = parse_event(&t) {
                    if tx.send(ev).is_err() {
                        break;
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_api_events() {
        let e = parse_event(r#"[8,"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",{"uri":"/lol-gameflow/v1/gameflow-phase","eventType":"Update","data":"ReadyCheck"}]"#).unwrap();
        assert_eq!(e.uri, "/lol-gameflow/v1/gameflow-phase");
        assert_eq!(e.data, "ReadyCheck");
        assert!(parse_event(r#"[0,"welcome"]"#).is_none());
        assert!(parse_event("not json").is_none());
        assert_eq!(event_name("/lol-gameflow/v1/gameflow-phase"), "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase");
    }
}
