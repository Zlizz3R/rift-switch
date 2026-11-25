// node tools/tag-thresholds.js [data folder] – the thresholds of the leveled tags (ui/tag-rules.js),
// per position, from the stored ranked games of the OTHER players (the own accounts left out):
// weak = lowest 25 %, terrible = lowest 10 %, great = best 33 %, master = best 16.6 % (deaths the
// other way round). Reads the own store (matches) and the one Live fills with the last games of the
// players it meets (matches-others).
//
// Two ways, the better one wins per position and figure:
// - REAL: every other player with at least 10 ranked games on the position, ALL of them together –
//   exactly the way a tag judges a player. Used from 30 such players on.
// - MODEL (until then): most other players appear in one or two games only, so the spread of season
//   averages is estimated: single games spread too wide, so each threshold is the middle between the
//   single games and averages of 10 games drawn from all players' games (fixed seed). Small counts
//   (roams, steals, first blood) from those averages alone; lane differences mirrored.
// Prints the distributions and the rounded levels with their source; copy those into tag-rules.js.
// Reads only.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const UI = path.join(__dirname, '..', 'ui') + path.sep;
const St = require(UI + 'stats.js');
const T = require(UI + 'tags.js');
const DIR = path.join(process.argv[2] || path.join(process.env.APPDATA || '', 'rift-switch'), 'matches');
const own = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'by.json'), 'utf8'))));
const games = new Map();
const OTHERS = path.join(path.dirname(DIR), 'matches-others', 'games.jsonl');
const lines = [...fs.readFileSync(path.join(DIR, 'games.jsonl'), 'utf8').split('\n'),
  ...(fs.existsSync(OTHERS) ? fs.readFileSync(OTHERS, 'utf8').split('\n') : [])];
for (const l of lines) {
  if (!l.trim()) continue;
  let g; try { g = JSON.parse(l); } catch { continue; }
  // lite games (one player from a match list, Live) have no team, no timeline: left out
  if (g.remake || g.mode !== 'CLASSIC' || g.lite) continue;
  const old = games.get(String(g.id));
  if (!old || (g.v || 0) >= (old.v || 0)) games.set(String(g.id), g);
}
// objectives from the raw archive for games stored before format 5 (newer games carry their own,
// with the killer and the enemies who hit it – those are never replaced)
let raw = '';
try { raw = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'raw.jsonl.gz'))).toString('utf8'); } catch (e) { console.log('raw', e.message); }
let withObj = 0;
for (const l of raw.split('\n')) {
  if (!l.trim()) continue;
  let r; try { r = JSON.parse(l); } catch { continue; }
  const g = games.get(String(r.id)); if (!g || !r.timeline || !r.game || Array.isArray(g.obj)) continue;
  const puuidOf = new Map(r.game.participantIdentities.map(x => [x.participantId, x.player && x.player.puuid]));
  const idx = pid => g.players.findIndex(p => p.puuid && p.puuid === puuidOf.get(pid));
  const KIND = { DRAGON: 'D', BARON_NASHOR: 'B', RIFTHERALD: 'H', ATAKHAN: 'A', HORDE: 'G' };
  g.obj = [];
  for (const f of r.timeline.frames) for (const e of f.events || []) {
    if (e.type !== 'ELITE_MONSTER_KILL' || !KIND[e.monsterType]) continue;
    const k = idx(e.killerId); if (k < 0) continue;
    const team = g.players[k].team;
    const ins = [...new Set([k, ...(e.assistingParticipantIds || []).map(idx)])].filter(i => i >= 0 && g.players[i].team === team).sort();
    g.obj.push([Math.floor(e.timestamp / 1000), e.monsterSubType === 'ELDER_DRAGON' ? 'E' : KIND[e.monsterType], team, ins]);
  }
  withObj++;
}
const FIG = ['csMin', 'dmgMin', 'kda', 'deaths', 'visMin', 'kp', 'goldDiff15', 'cs15', 'laneCs15', 'share0to15', 'share15to30', 'objPart',
  'xpDiff15', 'goldMin', 'wardsKilled', 'fbPart', 'fbDeath', 'roam', 'caught', 'steals', 'invade', 'invaded'];
// fewer is better
const DOWN = new Set(['deaths', 'caught', 'fbDeath', 'invaded']);
const MIRROR = ['goldDiff15', 'laneCs15', 'xpDiff15'];
// yes / no per game (first blood) or small counts (steals, roams, caught): one game sticks at 0, 1, 2 …
// and says nothing – the 10-game mix alone
const RATE = new Set(['fbPart', 'fbDeath', 'steals', 'roam', 'caught']);
const by = {};
let pg = 0;
const rowsBy = {};
for (const g of games.values()) for (const p of g.players) {
  if (own.has(p.puuid)) continue;
  if (![420, 440].includes(g.q)) continue;
  const role = St.role(g, p); if (!role) continue;
  pg++;
  ((rowsBy[role] = rowsBy[role] || { r: [] }).r).push({ g, p });
  for (const f of FIG) {
    const { v, n } = T.METRICS[f]([{ g, p }]);
    if (v == null || !n) continue;
    ((by[role] = by[role] || {})[f] = by[role][f] || []).push(v);
  }
}
const q = (a, x) => a[Math.min(a.length - 1, Math.floor(a.length * x / 100))];
const objN = [...games.values()].filter(g => Array.isArray(g.obj)).length;
console.log(`games ${games.size} (with objectives ${objN}, from the raw archive ${withObj}), other players' games ${pg}, own accounts left out: ${own.size}`);
const out = {};
for (const role of St.POSITIONS) {
  console.log('==', role);
  for (const f of FIG) {
    const a = ((by[role] || {})[f] || []).sort((x, y) => x - y);
    if (!a.length) continue;
    const row = { n: a.length, p10: q(a, 10), p20: q(a, 20), p50: q(a, 50), p75: q(a, 75), p90: q(a, 90) };
    (out[role] = out[role] || {})[f] = row;
    console.log('  ' + f.padEnd(12), `n=${String(a.length).padStart(4)}`, ['p10', 'p20', 'p50', 'p75', 'p90'].map(k => `${k}=${+row[k].toFixed(2)}`).join(' '));
  }
}

// a season average: 10 games of the role drawn at random, 4000 times, with the app's own figures
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const avg = {};
for (const role of St.POSITIONS) {
  console.log('== 10-game averages', role);
  for (const f of FIG) {
    const pool = (rowsBy[role] || {}).r || [];
    if (pool.length < 20) { console.log('  ' + f, 'too few', pool.length); continue; }
    const vals = [];
    for (let i = 0; i < 4000; i++) {
      const pick = Array.from({ length: 10 }, () => pool[Math.floor(rnd() * pool.length)]);
      const { v } = T.METRICS[f](pick);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    if (!vals.length) continue;
    const row = Object.fromEntries([3, 10, 20, 50, 75, 90, 97].map(x => ['p' + x, q(vals, x)]));
    (avg[role] = avg[role] || {})[f] = row;
    console.log('  ' + f.padEnd(12), Object.entries(row).map(([k, v]) => `${k}=${+v.toFixed(2)}`).join(' '));
  }
}

// thresholds: weak = lowest 25 %, terrible = lowest 10 %, great = best 33 %, master = best 16.6 %
// (for deaths the other way round); the middle between single games and 10-game averages
const PCT = { terrible: 10, weak: 25, great: 67, master: 83.4 };
const single = {};
for (const role of St.POSITIONS) for (const f of FIG) {
  const a = ((by[role] || {})[f] || []).slice().sort((x, y) => x - y);
  if (a.length) (single[role] = single[role] || {})[f] = a;
}
const levels = {};
for (const role of St.POSITIONS) {
  for (const f of FIG) {
    const a = (single[role] || {})[f];
    const pool = (rowsBy[role] || {}).r || [];
    if (!a || pool.length < 20) continue;
    seed = 11;
    const vals = [];
    for (let i = 0; i < 4000; i++) { const { v } = T.METRICS[f](Array.from({ length: 10 }, () => pool[Math.floor(rnd() * pool.length)])); if (v != null) vals.push(v); }
    vals.sort((x, y) => x - y);
    if (!vals.length) continue;
    const down = DOWN.has(f);
    const lv = {};
    for (const [k, p] of Object.entries(PCT)) {
      const pp = down ? 100 - p : p;
      lv[k] = RATE.has(f) ? q(vals, pp) : (q(a, pp) + q(vals, pp)) / 2;
    }
    (levels[f] = levels[f] || {})[role] = lv;
  }
}

// lane differences: one player's lead is the other's deficit – mirrored, so the median is 0
for (const f of MIRROR) for (const role of St.POSITIONS) {
  const a0 = (single[role] || {})[f]; if (!a0) continue;
  const a = [...a0, ...a0.map(v => -v)].sort((x, y) => x - y);
  seed = 13;
  const vals = [];
  for (let i = 0; i < 4000; i++) { let s = 0; for (let j = 0; j < 10; j++) s += a[Math.floor(rnd() * a.length)]; vals.push(s / 10); }
  vals.sort((x, y) => x - y);
  const lv = {};
  for (const [k, p] of Object.entries(PCT)) lv[k] = (q(a, p) + q(vals, p)) / 2;
  (levels[f] = levels[f] || {})[role] = lv;
}
// REAL: other players' season averages over all their games on a position (at least REAL_MIN)
const REAL_MIN = 10, REAL_PLAYERS = 30;
const source = {};
{
  const seasonFrom = new Date(new Date().getFullYear(), 0, 1).getTime();
  const per = {};   // role -> puuid -> rows
  for (const role of St.POSITIONS) for (const x of (rowsBy[role] || {}).r || []) {
    if (x.g.t < seasonFrom) continue;
    ((per[role] = per[role] || {})[x.p.puuid] = per[role][x.p.puuid] || []).push(x);
  }
  console.log(`== real season averages (players with ${REAL_MIN}+ games on the position; used from ${REAL_PLAYERS} players on)`);
  for (const role of St.POSITIONS) {
    const players = Object.values(per[role] || {}).filter(r => r.length >= REAL_MIN);
    console.log('  ' + role.padEnd(8), 'players', players.length);
    if (players.length < REAL_PLAYERS) continue;
    for (const f of FIG) {
      const vals = players.map(r => T.METRICS[f](r)).filter(o => o.v != null && o.n >= REAL_MIN).map(o => o.v).sort((x, y) => x - y);
      if (vals.length < REAL_PLAYERS) continue;
      const down = DOWN.has(f);
      (levels[f] = levels[f] || {})[role] = Object.fromEntries(Object.entries(PCT).map(([k, p]) => [k, q(vals, down ? 100 - p : p)]));
      (source[f] = source[f] || {})[role] = `real, ${vals.length} players`;
    }
  }
}
const STEP = { csMin: 0.1, dmgMin: 10, kda: 0.05, deaths: 0.1, visMin: 0.01, kp: 0.01, goldDiff15: 50, cs15: 1, laneCs15: 1, share0to15: 0.005, share15to30: 0.005,
  objPart: 0.01, xpDiff15: 50, goldMin: 5, wardsKilled: 0.1, fbPart: 0.01, fbDeath: 0.01, roam: 0.05, caught: 0.05, steals: 0.01, invade: 1, invaded: 1 };
const round = (f, v) => +(Math.round(v / STEP[f]) * STEP[f]).toFixed(3);
const outLv = {};
for (const [f, roles] of Object.entries(levels)) for (const [role, lv] of Object.entries(roles))
  ((outLv[f] = outLv[f] || {})[role] = Object.fromEntries(['great', 'master', 'weak', 'terrible'].map(k => [k, round(f, lv[k])])));
for (const [f, roles] of Object.entries(outLv)) { console.log(f); for (const [r, lv] of Object.entries(roles)) console.log('  ', r.padEnd(8), JSON.stringify(lv), (source[f] || {})[r] || 'model'); }

// comeback / throw: how often a team 2,000 gold behind at 15 minutes still wins, and one ahead loses
{
  let b = 0, bw = 0, a = 0, al = 0;
  for (const g of games.values()) {
    if (![420, 440].includes(g.q) || !g.gold || !g.gold[15]) continue;
    const p = g.players.find(x => x.team === 100);
    const d = St.teamGoldDiffAt(g, p, 15);
    for (const [diff, win] of [[d, p.win], [-d, !p.win]]) {
      if (diff <= -2000) { b++; if (win) bw++; }
      if (diff >= 2000) { a++; if (!win) al++; }
    }
  }
  console.log(`2,000 behind at 15: ${b} team games, ${(100 * bw / b).toFixed(1)} % won; 2,000 ahead: ${a}, ${(100 * al / a).toFixed(1)} % lost`);
}
