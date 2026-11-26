// node tools/aram-thresholds.js [data folder] – the thresholds of the ARAM traits (ui/tag-rules.js
// ARAM_RULES) from the stored ARAM games of the OTHER players (the own accounts left out): weak =
// lowest 25 %, terrible = lowest 10 %, great = best 33 %, master = best 16.6 % (deaths the other way
// round). Most players appear in a game or two only, so the spread of season averages is estimated
// like tools/tag-thresholds.js does it: each threshold is the middle between the single games and
// averages of 10 games drawn from all players' games (fixed seed). Team figures (kill participation,
// damage share) need games with all ten players; the rest also counts the short games from match
// lists (one player each). Prints the levels; copy them into tag-rules.js. Reads only.
const fs = require('fs'), path = require('path');
const UI = path.join(__dirname, '..', 'ui') + path.sep;
const St = require(UI + 'stats.js');
const T = require(UI + 'tags.js');
const DIR = path.join(process.argv[2] || path.join(process.env.APPDATA || '', 'rift-switch'), 'matches');
const own = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'by.json'), 'utf8'))));
const ARAM = [450, 2400];
const games = new Map();
const OTHERS = path.join(path.dirname(DIR), 'matches-others', 'games.jsonl');
for (const f of [path.join(DIR, 'games.jsonl'), OTHERS]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let g; try { g = JSON.parse(l); } catch { continue; }
    if (!ARAM.includes(g.q) || St.isRemake(g)) continue;
    // one game, several stored forms: the full one wins, lite ones add their player
    const k = String(g.id), old = games.get(k);
    if (!old || (old.lite && !g.lite)) games.set(k, g);
    else if (old.lite && g.lite) for (const p of g.players) if (!old.players.some(o => o.puuid === p.puuid)) old.players.push(p);
  }
}
const rows = [];
for (const g of games.values()) for (const p of g.players) if (p.puuid && !own.has(p.puuid)) rows.push({ g, p });
const full = rows.filter(x => !x.g.lite);
console.log(`${games.size} ARAM games, ${rows.length} player games of other players (${full.length} in games with all ten)`);

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
// figure → rows it is measured on; dir 1 = more is better
const FIG = {
  dmgMin: [rows, 1], kda: [rows, 1], deathsMin10: [rows, -1], kp: [full, 1], tankMin: [rows, 1], healMin: [rows, 1], ccMin: [rows, 1],
  multi3: [rows, 1], dmgShare: [full, 1],
};
const val = (fig, list) => {
  if (fig === 'dmgShare') { const a = St.aggregate(list); return a && a.dmgShare; }
  const r = T.METRICS[fig](list);
  return r && r.n ? r.v : null;
};
for (const [fig, [src, dir]] of Object.entries(FIG)) {
  const single = src.map(x => val(fig, [x])).filter(v => v != null && Number.isFinite(v));
  const avg10 = [];
  for (let i = 0; i < 3000 && src.length >= 10; i++) {
    const pick = Array.from({ length: 10 }, () => src[Math.floor(rnd() * src.length)]);
    const v = val(fig, pick);
    if (v != null && Number.isFinite(v)) avg10.push(v);
  }
  const lv = q => (pct(single, q) + pct(avg10, q)) / 2;
  const levels = dir > 0
    ? { great: lv(0.67), master: lv(0.834), weak: lv(0.25), terrible: lv(0.1) }
    : { great: lv(0.33), master: lv(0.166), weak: lv(0.75), terrible: lv(0.9) };
  const r = v => (Math.abs(v) >= 100 ? Math.round(v / 10) * 10 : Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100);
  console.log(fig.padEnd(12), `${single.length} games`, JSON.stringify(Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, r(v)]))),
    `median ${r(pct(single, 0.5))}`);
}
