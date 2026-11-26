// Play style against the lane opponent (docs/plans Phase 6): per axis the own average ÷ the lane
// opponents' average over the same games (a ratio per game and then a mean would let one game with a
// near-zero opponent – 300 tower damage – blow it up). 1 = as good as the opponent; deaths the other
// way round (fewer is better). Shown as the difference: +13 % = 13 % better. Games without a clear lane opponent don't count; an axis with
// fewer than MIN games has no value (never 0). No total score. No DOM; window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const MIN = 10;
  // id, the figure of a player in a game (null = unknown), invert: fewer is better
  const AXES = [
    { id: 'farm', of: (g, p) => St.csMin(g, p), unit: 'CS/min', dec: 1 },
    { id: 'dmg', of: (g, p) => St.dmgMin(g, p), unit: 'dmg/min', dec: 0 },
    { id: 'gold', of: (g, p) => (p.gold ? p.gold / St.minutes(g) : null), unit: 'gold/min', dec: 0 },
    { id: 'kp', of: (g, p) => St.kp(g, p), pct: true },
    { id: 'vis', of: (g, p) => St.visMin(g, p), unit: 'vis/min', dec: 2 },
    { id: 'surv', of: (g, p) => p.d, invert: true, unit: 'deaths', dec: 1 },
    // lane phase: gold at 15 minutes (stored per minute); games shorter than that don't count
    { id: 'lane', of: (g, p) => (g.gold && g.gold[15] ? g.gold[15][g.players.indexOf(p)] : null), unit: 'gold@15', dec: 0 },
    { id: 'tower', of: (g, p) => (p.x ? p.x.turretDmg || 0 : null), unit: 'tower dmg', dec: 0 },
  ];
  // rows: [{ g, p }] (participations) → [{ id, ratio, mine, theirs, n }]
  function radar(rows) {
    return AXES.map(a => {
      const ratios = [], mine = [], theirs = [];
      for (const { g, p } of rows) {
        const o = St.laneOpponent(g, p);
        if (!o) continue;
        const x = a.of(g, p), y = a.of(g, o);
        if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        ratios.push(1); mine.push(x); theirs.push(y);
      }
      const avg = l => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);
      const n = ratios.length;
      const m = avg(mine), th = avg(theirs);
      // deaths: theirs ÷ mine (at least 1 death per game on both sides, so 0 isn't infinite)
      const ratio = n < MIN || m == null ? null : a.invert ? Math.max(1, th) / Math.max(1, m) : th > 0 ? m / th : null;
      return { id: a.id, ratio, mine: m, theirs: th, n, axis: a };
    });
  }
  const api = { MIN, AXES, radar };
  if (node) module.exports = api;
  else root.Radar = api;
})(typeof window !== 'undefined' ? window : this);
