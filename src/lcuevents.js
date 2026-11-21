// Live events from the League client (its WebSocket, WAMP protocol) instead of asking every few seconds.
// The app still polls slowly as a safety net; events just make it react right away.
const WebSocket = require('ws');

const TOPICS = [
  '/lol-gameflow/v1/gameflow-phase',
  '/lol-matchmaking/v1/ready-check',
  '/lol-summoner/v1/current-summoner',
  '/lol-ranked/v1/current-ranked-stats',
  '/lol-end-of-game/v1/eog-stats-block',
];
const eventName = uri => 'OnJsonApiEvent' + uri.replace(/\//g, '_');

let ws = null, port = null, onEvent = () => {};

function connected() { return !!ws && ws.readyState === WebSocket.OPEN; }

// lf = { port, password } from the League lockfile; no-op while already connected to that client
function connect(lf, handler) {
  onEvent = handler;
  if (!lf) return close();
  if (ws && port === lf.port && ws.readyState <= WebSocket.OPEN) return;
  close();
  port = lf.port;
  const sock = new WebSocket(`wss://127.0.0.1:${lf.port}/`, ['wamp'], {
    rejectUnauthorized: false,   // the client uses its own self-signed certificate
    headers: { Authorization: 'Basic ' + Buffer.from('riot:' + lf.password).toString('base64') },
    handshakeTimeout: 4000,
  });
  ws = sock;
  sock.on('open', () => { for (const t of TOPICS) sock.send(JSON.stringify([5, eventName(t)])); });
  sock.on('message', raw => {
    const ev = parseEvent(raw);
    if (ev) try { onEvent(ev.uri, ev.data, ev.type); } catch {}
  });
  const drop = () => { if (ws === sock) { ws = null; port = null; } };
  sock.on('close', drop);
  sock.on('error', drop);
}

// one WAMP message -> { uri, data, type } for an API event, else null
// (format: [8, "OnJsonApiEvent_…", { uri, eventType, data }])
function parseEvent(raw) {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return null; }
  if (!Array.isArray(m) || m[0] !== 8 || !m[2] || typeof m[2].uri !== 'string') return null;
  return { uri: m[2].uri, data: m[2].data, type: m[2].eventType };
}

function close() {
  if (ws) { try { ws.terminate(); } catch {} }
  ws = null; port = null;
}

module.exports = { connect, close, connected, parseEvent, TOPICS, eventName };
