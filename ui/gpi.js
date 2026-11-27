// Another player's play profile (Live's cards, the player page): eight areas – fighting, farming,
// vision, survival, objectives, aggression, consistency, versatility – each 0–100 against what is
// usual for the role (the thresholds of tag-rules.js: the weak quarter ≈ 35, the middle ≈ 55, the best
// third ≈ 75), several figures weighed into one area. Never against the lane opponent and without the
// figures themselves (Riot's policies: no player shown up by their performance) – the own accounts
// keep the exact radar against the lane opponent (radar.js). No DOM; window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const TR = node ? require('./tag-rules.js') : root.TagRules;
  const Tg = node ? require('./tags.js') : root.Tags;

  // area → [[metric, weight]]; every metric with thresholds per role in tag-rules.js
  const AREAS = [
    { id: 'fight', parts: [['kda', 0.4], ['dmgMin', 0.35], ['kp', 0.25]] },
    { id: 'farm', parts: [['csMin', 0.6], ['goldMin', 0.4]] },
    { id: 'vision', parts: [['visMin', 0.75], ['wardsKilled', 0.25]] },
    { id: 'surv', parts: [['deaths', 0.8], ['fbDeath', 0.2]] },
    { id: 'obj', parts: [['objPart', 1]] },
    { id: 'aggr', parts: [['fbPart', 0.45], ['kp', 0.25], ['roam', 0.3]] },
    { id: 'cons' },
    { id: 'vers' },
  ];
  const clamp = v => Math.max(4, Math.min(99, v));
  // a metric's thresholds for a role: the rule's own for that role, else its general levels
  function levelsOf(metric, role) {
    const r = TR.TAG_RULES.find(x => x.type === 'metric' && x.metric === metric && !x.off && !x.id.startsWith('ar'));
    if (!r || (r.roles && role && !r.roles.includes(role))) return null;
    const L = { ...((role && r[role]) || r.levels || {}) };
    // a rule with one side only (first blood: great / master; its victim: weak / terrible): the other
    // side mirrored at the same distance
    if (L.great == null && L.weak != null && L.terrible != null) L.great = L.weak - (L.terrible - L.weak) * 1.3;
    if (L.weak == null && L.great != null && L.master != null) L.weak = L.great - (L.master - L.great) * 1.3;
    if (L.great == null || L.weak == null) return null;
    return { ...L, dir: r.dir || 1 };
  }
  // a value on the 0–100 scale: terrible 15, weak 35, the middle 55, great 75, master 90
  function scoreOf(v, L) {
    const d = L.dir;
    const pts = [[L.terrible != null ? L.terrible : L.weak - (L.great - L.weak) * 0.5, 15], [L.weak, 35], [(L.weak + L.great) / 2, 55], [L.great, 75],
      [L.master != null ? L.master : L.great + (L.great - L.weak) * 0.5, 90]];
    // more is better: rising values; fewer is better (deaths): the thresholds fall
    const x = d > 0 ? v : -v;
    const xs = pts.map(([t, s]) => [d > 0 ? t : -t, s]).sort((a, b) => a[0] - b[0]);
    if (x <= xs[0][0]) { const [a, sa] = xs[0], [b, sb] = xs[1]; return clamp(sa - ((a - x) / Math.max(1e-9, b - a)) * (sb - sa)); }
    for (let i = 1; i < xs.length; i++) {
      const [a, sa] = xs[i - 1], [b, sb] = xs[i];
      if (x <= b) return clamp(sa + ((x - a) / Math.max(1e-9, b - a)) * (sb - sa));
    }
    const [a, sa] = xs[xs.length - 2], [b, sb] = xs[xs.length - 1];
    return clamp(sb + ((x - b) / Math.max(1e-9, b - a)) * (sb - sa) * 0.5);
  }
  // consistency: how even the games are – the spread of a per-game score (fighting + farming)
  function consistency(rows, role) {
    const per = rows.map(x => {
      const a = St.aggregate([x]);
      if (!a) return null;
      const s = [['kda', a.kda], ['dmgMin', a.dmgMin], ['csMin', a.csMin]].map(([m, v]) => { const L = levelsOf(m, role); return L && v != null ? scoreOf(v, L) : null; }).filter(v => v != null);
      return s.length ? s.reduce((t, v) => t + v, 0) / s.length : null;
    }).filter(v => v != null);
    if (per.length < 3) return { v: null, n: per.length };
    const m = per.reduce((t, v) => t + v, 0) / per.length;
    const sd = Math.sqrt(per.reduce((t, v) => t + (v - m) ** 2, 0) / per.length);
    // a spread of 8 points is very even (90), 30 points is all over the place (20)
    return { v: clamp(90 - ((sd - 8) / 22) * 70), n: per.length };
  }
  // versatility: champions played several times and the roles of the games
  function versatility(rows) {
    if (rows.length < 3) return { v: null, n: rows.length };
    const by = new Map();
    for (const x of rows) by.set(x.p.champ, (by.get(x.p.champ) || 0) + 1);
    const pool = [...by.values()].filter(n => n >= Math.max(2, rows.length * 0.08)).length || 1;
    const roles = new Set(rows.map(x => St.role(x.g, x.p)).filter(Boolean)).size || 1;
    return { v: clamp(20 + Math.min(5, pool - 1) * 11 + Math.min(3, roles - 1) * 8), n: rows.length };
  }
  // rows: one player's participations ({ g, p }), Summoner's Rift; role: the role to compare with
  // (none: each game with its own role's thresholds is too fine – the main role is taken)
  function profile(rows, role) {
    rows = rows.filter(x => !St.isRemake(x.g) && !St.offRift(x.g));
    if (!role) { const mr = Tg.mainRole(rows); role = mr.main || mr.most || ''; }
    // the games on that role (its thresholds); none known: all of them
    const onRole = role ? rows.filter(x => St.role(x.g, x.p) === role) : [];
    if (onRole.length) rows = onRole;
    return AREAS.map(a => {
      if (a.id === 'cons') return { id: a.id, ...consistency(rows, role) };
      if (a.id === 'vers') return { id: a.id, ...versatility(rows) };
      let sum = 0, w = 0, n = 0;
      for (const [m, wt] of a.parts) {
        const L = levelsOf(m, role);
        if (!L || !Tg.METRICS[m]) continue;
        const r = Tg.METRICS[m](rows);
        if (r.v == null || !Number.isFinite(r.v) || !r.n) continue;
        sum += scoreOf(r.v, L) * wt; w += wt; n = Math.max(n, r.n);
      }
      return { id: a.id, v: w ? clamp(sum / w) : null, n };
    });
  }
  const api = { AREAS, profile, scoreOf, levelsOf, roleOf: rows => { const mr = Tg.mainRole(rows); return mr.main || mr.most || ''; } };
  if (node) module.exports = api;
  else root.Gpi = api;
})(typeof window !== 'undefined' ? window : this);
