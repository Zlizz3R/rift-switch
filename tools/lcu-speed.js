// How fast the League client hands out match history – for tuning Live's loading (main.rs scout_*).
// Only reads (GET), only from the client on this PC. Run it while League is open – in the lobby, in
// champion select or in a game (that's the case that counts):
//   node tools/lcu-speed.js            the players of the current game (else: the signed-in summoner)
//   node tools/lcu-speed.js 30         … with 30 games per run instead of 24
// It measures: one match list (the first one per player and client session is the slow one), game
// details alone, timelines alone, both together – one at a time and 4 / 8 / 12 / 24 at once – and
// prints games per second. Nothing is stored; no names are printed.
const fs = require('fs');
const https = require('https');
const path = require('path');

const N = Math.max(4, Number(process.argv[2]) || 24);

function leagueDirs() {
  let keys = [];
  try { keys = Object.keys(JSON.parse(fs.readFileSync('C:/ProgramData/Riot Games/RiotClientInstalls.json', 'utf8')).associated_client || {}); } catch { /* default below */ }
  const live = keys.find(d => d.replace(/\/$/, '').toLowerCase().endsWith('league of legends')) || 'C:/Riot Games/League of Legends/';
  const pbe = keys.find(d => d.replace(/\/$/, '').toLowerCase().endsWith('league of legends (pbe)'));
  return [live, pbe].filter(Boolean);
}
function lock() {
  const found = leagueDirs().map(d => path.join(d, 'lockfile')).filter(f => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!found.length) { console.log('League is not open (no lockfile).'); process.exit(1); }
  const [, , port, password] = fs.readFileSync(found[0], 'utf8').split(':');
  return { port, auth: 'Basic ' + Buffer.from('riot:' + password).toString('base64') };
}
const L = lock();
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 64 });
function get(p, timeout = 30000) {
  const t0 = performance.now();
  return new Promise(res => {
    const req = https.get({ host: '127.0.0.1', port: L.port, path: p, agent, headers: { Authorization: L.auth }, timeout }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        res({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, body, ms: performance.now() - t0 });
      });
    });
    req.on('timeout', () => { req.destroy(); res({ ok: false, status: 'timeout', ms: performance.now() - t0 }); });
    req.on('error', () => res({ ok: false, status: 'error', ms: performance.now() - t0 }));
  });
}
const fmt = ms => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const stats = list => {
  const ms = list.map(r => r.ms).sort((a, b) => a - b);
  return { avg: ms.reduce((a, b) => a + b, 0) / (ms.length || 1), p90: ms[Math.floor(ms.length * 0.9)] || 0, max: ms[ms.length - 1] || 0, failed: list.filter(r => !r.ok).length };
};
// run jobs with `par` always on their way (like main.rs)
async function pool(jobs, par) {
  const out = [];
  let i = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(par, jobs.length) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; out.push(await j()); }
  }));
  return { out, ms: performance.now() - t0 };
}

(async () => {
  const phase = (await get('/lol-gameflow/v1/gameflow-phase')).body;
  const me = (await get('/lol-summoner/v1/current-summoner')).body || {};
  let players = [];
  if (['InProgress', 'GameStart', 'Reconnect'].includes(phase)) {
    const s = (await get('/lol-gameflow/v1/session')).body || {};
    players = [...(s.gameData?.teamOne || []), ...(s.gameData?.teamTwo || [])].map(p => p.puuid).filter(p => p && p !== me.puuid);
  }
  if (!players.length && me.puuid) players = [me.puuid];
  console.log(`League: ${phase} · ${players.length} player(s) to read · ${N} games per run\n`);

  // 1) match lists: the first one per player and client session takes long, later ones are quick
  const lists = await pool(players.map(p => () => get(`/lol-match-history/v1/products/lol/${p}/matches?begIndex=0&endIndex=199`)), 12);
  const ls = stats(lists.out);
  console.log(`match lists (${players.length} at once): all in ${fmt(lists.ms)} · each avg ${fmt(ls.avg)} max ${fmt(ls.max)} · failed ${ls.failed}`);
  const again = await get(`/lol-match-history/v1/products/lol/${players[0]}/matches?begIndex=0&endIndex=199`);
  console.log(`the same list once more: ${fmt(again.ms)}\n`);

  // games of these players, newest first, players in turn – fresh ones for every run (no cache hits)
  const per = lists.out.map(r => ((r.body && r.body.games && r.body.games.games) || []).map(g => g.gameId));
  const ids = [];
  for (let k = 0; ids.length < N * 12 && per.some(l => l[k] != null); k++) for (const l of per) if (l[k] != null && !ids.includes(l[k])) ids.push(l[k]);
  if (ids.length < N) { console.log(`only ${ids.length} games known – too few to measure`); return; }
  let next = 0;
  const take = n => { const s = ids.slice(next, next + n); next += n; return s; };

  // 2) details alone, timelines alone, both – one at a time
  const one = async (label, mk) => {
    const s = take(Math.min(8, N));
    if (s.length < 4) return;
    const r = await pool(s.map(id => () => get(mk(id), 10000)), 1);
    const st = stats(r.out);
    console.log(`${label.padEnd(26)} one at a time: avg ${fmt(st.avg)} · p90 ${fmt(st.p90)} · max ${fmt(st.max)} · failed ${st.failed}`);
  };
  await one('game details', id => `/lol-match-history/v1/games/${id}`);
  await one('timelines', id => `/lol-match-history/v1/game-timelines/${id}`);
  console.log('');

  // 3) game + timeline together (what Live does), at 4 / 8 / 12 / 24 at once
  for (const par of [4, 8, 12, 24]) {
    const s = take(N);
    if (s.length < N) { console.log(`(not enough fresh games for ${par} at once)`); break; }
    const r = await pool(s.map(id => async () => {
      const [g, t] = await Promise.all([get(`/lol-match-history/v1/games/${id}`, 10000), get(`/lol-match-history/v1/game-timelines/${id}`, 10000)]);
      return { ok: g.ok, ms: Math.max(g.ms, t.ms), g, t };
    }), par);
    const st = stats(r.out), gs = stats(r.out.map(x => x.g)), ts = stats(r.out.map(x => x.t));
    const rate = (s.length - st.failed) / (r.ms / 1000);
    console.log(`${String(par).padStart(2)} at once: ${s.length} games in ${fmt(r.ms)} = ${rate.toFixed(1)} games/s · details avg ${fmt(gs.avg)} max ${fmt(gs.max)} · timelines avg ${fmt(ts.avg)} max ${fmt(ts.max)} · failed ${st.failed}`);
    console.log(`           → 450 games (9 players × 50) would take about ${fmt(450 / Math.max(rate, 0.01) * 1000)}`);
  }
  agent.destroy();
})();
