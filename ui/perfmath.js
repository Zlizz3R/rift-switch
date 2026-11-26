// Overview → Performance / Champions: which games count under the filters, the key figures, the
// role table and the champion list. Every figure comes from stats.js; the time filter is the match
// history's (matchfilter.js). No DOM; shared by the window and the tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const MF = node ? require('./matchfilter.js') : root.MatchFilter;

  // the queue choices – the same groups as the match history (matches.rs QUEUE_GROUPS)
  const QUEUES = {
    ranked: [420, 440], solo: [420], flex: [440], normal: [400, 430, 480, 490], aram: [450, 2400], custom: [0, 3220, 3270], all: null,
  };
  const ROLES = [...St.POSITIONS, 'none'];
  // colour only where it says something (tag-rules.js takes these over in Phase 4)
  const MARK = { minGames: 5, winrate: 0.6, kda: 3 };

  // the calendar years with games, newest first (for "Season 2026")
  const years = games => [...new Set(games.map(g => new Date(g.t).getFullYear()))].sort((a, b) => b - a);

  // A participation's position: top … support, or 'none' (ARAM, Arena, games without all ten).
  const roleOf = x => St.role(x.g, x.p) || 'none';

  // the queue groups of the match history (matches.rs QUEUE_GROUPS): any of them can be on or off
  const GROUPS = {
    solo: [420], flex: [440], r5: [710], classic: [4310], normal: [400, 430, 480, 490], aram: [450, 2400],
    arena: [1700, 1710], clash: [700, 720], custom: [0, 3220, 3270],
  };
  // f: { accs: puuids (none = all), queues: group keys (none = all) or queue: key of QUEUES,
  //      range / from / to (matchfilter.js), role: '' or ROLES }
  // → every own account's part in every game that matches (remakes out; stats.js byParticipation)
  function select(games, f = {}, now = Date.now()) {
    const qs = Array.isArray(f.queues) ? (f.queues.length ? f.queues.flatMap(k => GROUPS[k] || []) : null)
      : QUEUES[f.queue] === undefined ? QUEUES.ranked : QUEUES[f.queue];
    const accs = f.accs && f.accs.length ? new Set(f.accs) : f.acc ? new Set([f.acc]) : null;
    const [from, to] = MF.rangeBounds(f, now);
    return St.byParticipation(games).filter(x =>
      (!accs || accs.has(x.p.puuid)) &&
      (!qs || qs.includes(x.g.q)) &&
      x.g.t >= from && x.g.t < to &&
      (!f.role || roleOf(x) === f.role));
  }

  // champion rows of some participations, most games first: [{ champ, ...aggregate }]
  function champRows(parts) {
    const by = St.groupBy(parts, x => x.p.champ);
    return [...by].map(([champ, ag]) => ({ champ, ...ag })).sort((a, b) => b.n - a.n || b.wins - a.wins);
  }

  // roles in a fixed order, each with its champions; roles without games are left out
  function roleTable(parts) {
    const by = new Map(ROLES.map(r => [r, []]));
    for (const x of parts) by.get(roleOf(x)).push(x);
    return ROLES.filter(r => by.get(r).length).map(r => ({ role: r, ...St.aggregate(by.get(r)), champs: champRows(by.get(r)) }));
  }

  // sorting a list of rows; ties: more games first
  const SORTS = {
    n: r => r.n, winrate: r => r.winrate, kda: r => (r.perfect ? Infinity : r.kda), avg: r => r.avg.k + r.avg.a - r.avg.d,
    csMin: r => r.csMin, dmgMin: r => r.dmgMin, kp: r => (r.kp == null ? -1 : r.kp), visMin: r => (r.visMin == null ? -1 : r.visMin),
    accounts: r => r.accounts,
  };
  function sortRows(rows, key = 'n', dir = -1) {
    const v = SORTS[key] || SORTS.n;
    return [...rows].sort((a, b) => (v(a) === v(b) ? 0 : v(a) < v(b) ? -dir : dir) || b.n - a.n);
  }

  // what deserves colour: 'good' / '' – nothing under MARK.minGames
  const markWinrate = r => (r.n >= MARK.minGames && r.winrate >= MARK.winrate ? 'good' : '');
  const markKda = r => (r.n >= MARK.minGames && (r.perfect || r.kda >= MARK.kda) ? 'good' : '');

  // Trend: the last n games against the n before them (newest first by time). key: a figure of
  // stats.js aggregate; better: 1 = more is better, -1 = fewer. → { cur, prev, wr: [now, before], ok }
  const TREND_KEYS = { kda: 1, csMin: 1, dmgMin: 1, visMin: 1, kp: 1, deaths: -1 };
  function trend(parts, n, key) {
    const list = [...parts].sort((a, b) => b.g.t - a.g.t);
    if (list.length < 2 * n) return { ok: false, have: list.length, need: 2 * n };
    const a = St.aggregate(list.slice(0, n)), b = St.aggregate(list.slice(n, 2 * n));
    const val = x => (key === 'deaths' ? x.avg.d : x[key]);
    return { ok: true, cur: val(a), prev: val(b), better: TREND_KEYS[key] || 1, wr: [a.winrate, b.winrate] };
  }

  const api = { QUEUES, GROUPS, ROLES, MARK, years, roleOf, select, champRows, roleTable, sortRows, markWinrate, markKda, TREND_KEYS, trend };
  if (node) module.exports = api;
  else root.PerfMath = api;
})(typeof window !== 'undefined' ? window : this);
