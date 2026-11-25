// Overview → Deaths: where on the map you die, by game phase. Every death with a place (game
// format 6: "kills" [second, killer, victim, [assists], x, y], Summoner's Rift in hundreds of units).
// Seen from the blue side: a red-side game is mirrored across the map's other diagonal, so your base
// is always bottom left and top lane stays top lane. No DOM; shared by the window and the tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;

  const SIZE = 148;
  // game phases by minute: [id, from, to)
  const PHASES = [['early', 0, 10], ['mid', 10, 20], ['late', 20, Infinity]];
  // the zones a death is counted in (stats.js zone(), turned into "own" / "enemy" and the river halves)
  const ZONES = ['top', 'mid', 'bot', 'riverTop', 'riverBot', 'jungleOwn', 'jungleEnemy', 'baseOwn', 'baseEnemy'];

  // red side → blue side: across the diagonal from top left to bottom right
  const toBlue = (x, y, team) => (team === 200 ? [SIZE - y, SIZE - x] : [x, y]);
  function zoneOf(x, y) {
    const z = St.zone(x, y);
    if (z === 'base') return x + y < SIZE ? 'baseOwn' : 'baseEnemy';
    if (z === 'river') return y > x ? 'riverTop' : 'riverBot';
    if (z === 'jungle100') return 'jungleOwn';
    if (z === 'jungle200') return 'jungleEnemy';
    return z;
  }
  const phaseOf = s => (PHASES.find(([, a, b]) => s / 60 >= a && s / 60 < b) || PHASES[2])[0];

  // every death of the participations [{ g, p }] that has a place →
  // [{ x, y, s, zone, phase, enemies (killer + assists), champ, gameId }]
  function deaths(parts) {
    const out = [];
    for (const { g, p } of parts) {
      if (!Array.isArray(g.kills) || St.isRemake(g)) continue;
      const i = g.players.indexOf(p);
      if (i < 0) continue;
      for (const k of g.kills) {
        if (k[2] !== i || k.length < 6) continue;
        const [x, y] = toBlue(k[4], k[5], p.team);
        out.push({ x, y, s: k[0], zone: zoneOf(x, y), phase: phaseOf(k[0]), enemies: (k[1] >= 0 ? 1 : 0) + (k[3] || []).length, champ: p.champ, gameId: String(g.id) });
      }
    }
    return out;
  }
  // games that count: with a timeline (kill places), not remakes
  const games = parts => parts.filter(({ g }) => Array.isArray(g.kills) && !St.isRemake(g) && g.kills.some(k => k.length >= 6));

  // per phase (and 'all'): deaths, per game, the zones by share (most first), how many died to 2+
  function summary(parts) {
    const list = deaths(parts);
    const n = games(parts).length;
    const sum = ds => {
      const by = new Map();
      for (const d of ds) by.set(d.zone, (by.get(d.zone) || 0) + 1);
      const zones = [...by].map(([zone, c]) => ({ zone, n: c, share: c / ds.length })).sort((a, b) => b.n - a.n || ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone));
      return { n: ds.length, perGame: n ? ds.length / n : null, zones, outnumbered: ds.length ? ds.filter(d => d.enemies >= 2).length / ds.length : null };
    };
    const out = { games: n, all: sum(list) };
    for (const [id] of PHASES) out[id] = sum(list.filter(d => d.phase === id));
    return out;
  }
  // the headline of a phase: its top zone, if it stands out (≥ 5 deaths and ≥ 30 %)
  function hotspot(ph) {
    const z = ph && ph.zones[0];
    return z && ph.n >= 5 && z.share >= 0.3 ? z : null;
  }

  const api = { SIZE, PHASES, ZONES, toBlue, zoneOf, phaseOf, deaths, games, summary, hotspot };
  if (node) module.exports = api;
  else root.DeathMath = api;
})(typeof window !== 'undefined' ? window : this);
