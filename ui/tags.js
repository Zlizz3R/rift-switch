// The tag engine: evaluates the rules of tag-rules.js on the stored games. Every tag comes out as
// met | not | few (too little data – never shown as "not met"), with its value, threshold, number
// of games and period. pick() chooses what is shown (conflicts, order). No DOM; window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const TR = node ? require('./tag-rules.js') : root.TagRules;
  const DAY = 86400000;
  const RANKED = St.RANKED_QUEUES;
  const GROUPS = ['pool', 'form', 'stats', 'fight', 'mastery'];

  // ---------- the figures behind metric tags (rows: [{ g, p }]) → { v, n } ----------
  const avgOf = list => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : null);
  const withX = rows => rows.filter(x => x.p.x && typeof x.p.x === 'object');
  const METRICS = {
    csMin: rows => { const a = St.aggregate(rows); return { v: a && a.csMin, n: rows.length }; },
    dmgMin: rows => { const a = St.aggregate(rows); return { v: a && a.dmgMin, n: rows.length }; },
    kda: rows => { const a = St.aggregate(rows); return { v: a && a.kda, n: rows.length }; },
    deaths: rows => { const a = St.aggregate(rows); return { v: a && a.avg.d, n: rows.length }; },
    visMin: rows => { const a = St.aggregate(rows); return { v: a && a.visMin, n: a ? a.visN : 0 }; },
    kp: rows => { const a = St.aggregate(rows); return { v: a && a.kp, n: a ? a.kpN : 0 }; },
    // gold lead over the lane opponent at 15 minutes (games that lasted that long, positions known)
    goldDiff15: rows => { const d = rows.map(x => St.goldDiffAt(x.g, x.p, 15)).filter(v => v != null); return { v: avgOf(d), n: d.length }; },
    // stats of the details ("x" leaves out zeros: a game with details and no such key had 0)
    turretDmg: rows => { const r = withX(rows); return { v: avgOf(r.map(x => x.p.x.turretDmg || 0)), n: r.length }; },
    pinks: rows => { const r = withX(rows); return { v: avgOf(r.map(x => x.p.x.pinks || 0)), n: r.length }; },
    // from the timeline (game format 4); older games have none and count as "no data"
    cs15: rows => { const v = rows.map(x => St.csAt(x.g, x.g.players.indexOf(x.p), 15)).filter(v => v != null); return { v: avgOf(v), n: v.length }; },
    laneCs15: rows => {
      const diff = x => {
        const o = St.laneOpponent(x.g, x.p);
        const a = St.csAt(x.g, x.g.players.indexOf(x.p), 15), b = o ? St.csAt(x.g, x.g.players.indexOf(o), 15) : null;
        return a != null && b != null ? a - b : null;
      };
      const v = rows.map(diff).filter(v => v != null);
      return { v: avgOf(v), n: v.length };
    },
    share0to15: rows => { const v = rows.map(x => St.farmShare(x.g, x.p, 0, 15)).filter(v => v != null); return { v: avgOf(v), n: v.length }; },
    share15to30: rows => {
      const v = rows.filter(x => x.g.dur >= 25 * 60 && x.g.csm).map(x => St.farmShare(x.g, x.p, 15, Math.min(30, x.g.csm.length - 1))).filter(v => v != null);
      return { v: avgOf(v), n: v.length };
    },
    soloKills: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => St.soloKills(x.g, x.p))), n: r.length }; },
    duels: rows => {
      const r = rows.filter(x => St.hasKills(x.g));
      const k = r.reduce((s, x) => s + St.soloKills(x.g, x.p), 0), d = r.reduce((s, x) => s + St.soloDeaths(x.g, x.p), 0);
      return { v: k + d ? k / (k + d) : null, n: k + d, vars: { k, d } };
    },
    deaths10: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => St.deathsBefore(x.g, x.p, 600))), n: r.length }; },
    gankDeaths15: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => St.gankDeathsBefore(x.g, x.p, 900))), n: r.length }; },
    firstKill5: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => (St.killBefore(x.g, x.p, 300) ? 1 : 0))), n: r.length }; },
    ward3: rows => {
      const r = rows.filter(x => Array.isArray(x.g.w1));
      return { v: avgOf(r.map(x => { const w = x.g.w1[x.g.players.indexOf(x.p)]; return w != null && w < 180 ? 1 : 0; })), n: r.length };
    },
    firstDrake: rows => { const r = rows.filter(x => x.g.drake1 != null); return { v: avgOf(r.map(x => (x.g.drake1 === x.p.team ? 1 : 0))), n: r.length }; },
    gank: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => (St.gankedBefore(x.g, x.p) ? 1 : 0))), n: r.length }; },
    takedowns15: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => St.takedownsBefore(x.g, x.p, 900))), n: r.length }; },
  };

  // ---------- helpers ----------
  const byNewest = rows => [...rows].sort((a, b) => b.g.t - a.g.t);
  const countBy = (rows, key) => { const m = new Map(); for (const x of rows) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; };
  const top = m => [...m].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  // the main role: ≥ 60 % of the games with a known position, from 10 games on; else null
  function mainRole(rows) {
    const m = countBy(rows.filter(x => St.role(x.g, x.p)), x => St.role(x.g, x.p));
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    const [r, n] = top(m);
    return { main: total >= TR.MAIN_ROLE.min && n / total >= TR.MAIN_ROLE.share ? r : null, most: r, shares: m, total };
  }
  // does v pass th? sense 1: v ≥ th, -1: v ≤ th. A tag shown before keeps going until 5 % past it.
  function passes(v, th, sense, sticky) {
    const t = sticky ? th - sense * Math.abs(th) * TR.TAG_HYSTERESIS : th;
    return sense > 0 ? v >= t : v <= t;
  }
  // the level a value reaches: master / great (good side), terrible / weak (bad side), or null
  function levelOf(v, levels, dir, prev, id) {
    const order = [['master', dir], ['great', dir], ['terrible', -dir], ['weak', -dir]];
    for (const [lv, sense] of order) {
      if (levels[lv] == null) continue;
      if (passes(v, levels[lv], sense, prev && prev.has(`${id}:${lv}`))) return lv;
    }
    return null;
  }

  // ---------- one rule ----------
  // d: { all, season, d30, d60, role rows, role, level, mastery, prev, now }
  function evalRule(r, d) {
    const out = (state, o = {}) => ({ id: r.id, group: r.group, color: r.color || null, stage: r.stage, period: r.period || null, state, ...o });
    const few = (n, need) => out('few', { n, need });
    const rows = r.period ? d[r.period] : d.all;
    switch (r.type) {
      case 'champShare': {
        if (rows.length < r.min) return [few(rows.length, r.min)];
        const [champ, c] = top(countBy(rows, x => x.p.champ));
        const share = c / rows.length;
        return [out(share >= r.share ? 'met' : 'not', { value: share, th: r.share, n: rows.length, champ, vars: { n: c, total: rows.length } })];
      }
      case 'champRecent': {
        const m = countBy(rows, x => x.p.champ);
        const hits = [...m].filter(([, c]) => c >= r.games).sort((a, b) => b[1] - a[1]);
        if (!hits.length) return [out('not', { value: top(m)[1], th: r.games, n: rows.length })];
        return hits.map(([champ, c]) => out('met', { value: c, th: r.games, n: c, champ, vars: { n: c } }));
      }
      case 'champWinrate': {
        const by = St.groupBy(rows, x => x.p.champ);
        const enough = [...by].filter(([, a]) => a.n >= r.games);
        if (!enough.length) return [few(Math.max(0, ...[...by.values()].map(a => a.n)), r.games)];
        const hits = enough.filter(([, a]) => a.winrate >= r.winrate).sort((a, b) => b[1].n - a[1].n);
        if (!hits.length) return [out('not', { value: Math.max(...enough.map(([, a]) => a.winrate)), th: r.winrate, n: rows.length })];
        return hits.map(([champ, a]) => out('met', { value: a.winrate, th: r.winrate, n: a.n, champ, vars: { wr: Math.round(a.winrate * 100), n: a.n } }));
      }
      case 'pool': {
        if (rows.length < r.min) return [few(rows.length, r.min)];
        const m = countBy(rows, x => x.p.champ);
        const [champ, c] = top(m);
        const share = c / rows.length;
        return [out(m.size >= r.champs && share <= r.maxShare ? 'met' : 'not', { value: m.size, th: r.champs, n: rows.length, champ, vars: { k: m.size, share: Math.round(share * 100) } })];
      }
      case 'roleSpread': {
        const mr = mainRole(rows);
        if (mr.total < r.min) return [few(mr.total, r.min)];
        const list = [...mr.shares].sort((a, b) => b[1] - a[1]).map(([ro, n]) => [ro, Math.round((100 * n) / mr.total)]);
        return [out(list[0][1] / 100 <= r.maxShare ? 'met' : 'not', { value: list[0][1] / 100, th: r.maxShare, n: mr.total, vars: { list } })];
      }
      case 'streak': {
        const list = byNewest(rows);
        if (list.length < r.min) return [few(list.length, r.min)];
        let n = 0;
        for (const x of list) { if (!!x.p.win !== r.win) break; n++; }
        return [out(n >= r.n ? 'met' : 'not', { value: n, th: r.n, n: list.length, vars: { n } })];
      }
      case 'break': {
        const list = byNewest(rows);
        if (list.length < r.min) return [few(list.length, r.min)];
        // the newest pause of at least r.days that ended (with a game) in the last r.within days
        for (let i = 0; i + 1 < list.length && d.now - list[i].g.t <= r.within * DAY; i++) {
          const gap = list[i].g.t - list[i + 1].g.t;
          if (gap >= r.days * DAY) return [out('met', { value: Math.floor(gap / DAY), th: r.days, n: list.length, vars: { days: Math.floor(gap / DAY) } })];
        }
        return [out('not', { n: list.length })];
      }
      case 'count':
        return [out(rows.length >= r.games ? 'met' : 'not', { value: rows.length, th: r.games, n: rows.length, vars: { n: rows.length } })];
      case 'level':
        if (d.level == null) return [];
        return [out(d.level < r.below ? 'met' : 'not', { value: d.level, th: r.below, vars: { lvl: d.level } })];
      case 'metric': {
        if (r.roles && d.role && !r.roles.includes(d.role)) return [];
        const { v, n } = METRICS[r.metric](d.role ? d.roleRows : rows);
        if (n < r.min || v == null) return [few(n, r.min)];
        const levels = (d.role && r[d.role]) || r.levels;
        const lv = levelOf(v, levels, r.dir, d.prev, r.id);
        const th = lv ? levels[lv] : levels.great;
        return [out(lv ? 'met' : 'not', { level: lv, value: v, th, n, vars: { v, n } })];
      }
      case 'carry': {
        if (r.roles && d.role && !r.roles.includes(d.role)) return [];
        const a = St.aggregate(d.role ? d.roleRows : rows);
        if (!a || a.dmgShareN < r.min || a.kp == null) return [few(a ? a.dmgShareN : 0, r.min)];
        const ok = a.dmgShare >= r.share && a.kp >= r.kp;
        return [out(ok ? 'met' : 'not', { value: a.dmgShare, th: r.share, n: a.dmgShareN, vars: { share: Math.round(a.dmgShare * 100), kp: Math.round(a.kp * 100), n: a.dmgShareN } })];
      }
      case 'avg': {
        if (r.roles && d.role && !r.roles.includes(d.role)) return [];
        const { v, n, vars } = METRICS[r.metric](d.role ? d.roleRows : rows);
        if (n < r.min || v == null) return [few(n, r.min)];
        const ok = r.atLeast != null ? v >= r.atLeast : v < r.below;
        return [out(ok ? 'met' : 'not', { value: v, th: r.atLeast != null ? r.atLeast : r.below, n, vars: { v, n, ...vars } })];
      }
      case 'mastery': {
        if (!d.mastery) return [out('few', { n: 0, need: 1, unread: true })];
        const steps = Object.entries(r.steps).sort((a, b) => b[1] - a[1]);
        const hits = d.mastery.filter(m => m.total >= steps[steps.length - 1][1]).slice(0, r.max);
        if (!hits.length) return [out('not', { value: d.mastery.length ? d.mastery[0].total : 0, th: steps[steps.length - 1][1] })];
        return hits.map(m => out('met', { level: steps.find(([, at]) => m.total >= at)[0], value: m.total, champ: m.id, vars: { pts: m.total, k: m.n } }));
      }
      default:
        return [];   // 'live': evaluated in Live (Phase 5)
    }
  }

  // the season starts with the year
  const seasonStart = now => new Date(new Date(now).getFullYear(), 0, 1).getTime();

  // ctx: { games, own: puuids counted, now, role: forced position or null, level, mastery: masteryTable rows or null,
  //        prev: Set of 'id:level' shown before }
  // → { role, main, most, results }
  function evaluate(ctx) {
    const now = ctx.now || Date.now();
    const own = new Set(ctx.own || []);
    // this season's ranked games only
    const seasonFrom = seasonStart(now);
    const all = St.byParticipation(ctx.games || []).filter(x => own.has(x.p.puuid) && RANKED.includes(x.g.q) && x.g.t >= seasonFrom);
    const d = {
      all, now, level: ctx.level == null ? null : ctx.level, mastery: ctx.mastery || null, prev: ctx.prev || new Set(),
      season: all.filter(x => x.g.t >= seasonFrom), d30: all.filter(x => now - x.g.t <= 30 * DAY), d60: all.filter(x => now - x.g.t <= 60 * DAY),
    };
    const mr = mainRole(d.season);
    d.role = ctx.role || mr.main || mr.most || null;
    d.roleRows = d.role ? d.season.filter(x => St.role(x.g, x.p) === d.role) : d.season;
    const results = [];
    for (const r of TR.TAG_RULES) if (!r.live && !r.off) results.push(...evalRule(r, d));
    // OTP beats "main" on the same champion
    const otp = results.find(x => x.id === 'otp' && x.state === 'met');
    const kept = otp ? results.filter(x => !(x.id === 'main' && x.state === 'met' && x.champ === otp.champ)) : results;
    return { role: d.role, main: mr.main, most: mr.most, roleN: d.roleRows.length, results: kept };
  }

  // what is shown: met tags, conflicts resolved (the first of a pair wins), in group order
  function pick(results) {
    const met = results.filter(x => x.state === 'met');
    const ids = new Set(met.map(x => x.id));
    const drop = new Set();
    for (const [a, b] of TR.TAG_CONFLICTS) if (ids.has(a) && ids.has(b)) drop.add(b);
    return met.filter(x => !drop.has(x.id)).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  }
  const isStrength = x => x.state === 'met' && (x.level === 'master' || x.level === 'great');
  const isWeakness = x => x.state === 'met' && (x.level === 'weak' || x.level === 'terrible');
  // the keys for the next run's hysteresis
  const keys = results => new Set(results.filter(x => x.state === 'met' && x.level).map(x => `${x.id}:${x.level}`));

  // Live tags: they are about the current game, so they come first on a card (docs/plans 5.4).
  // d: { games, puuid, champ (played now), mastery (points on it, null = unknown), position (from the
  //      client, '' = unknown or guessed), enemyChamps, bans, results (evaluate() of this player), now }
  function liveTags(d) {
    const rule = id => TR.TAG_RULES.find(r => r.id === id) || {};
    const now = d.now || Date.now();
    const out = [];
    const mine = St.byParticipation(d.games || []).filter(x => x.p.puuid === d.puuid);
    const ranked = mine.filter(x => RANKED.includes(x.g.q) && x.g.t >= seasonStart(now));
    const tag = (id, o) => out.push({ id, group: 'live', color: rule(id).color || 'warn', state: 'met', live: true, ...o });
    // new to the champion: few ranked games on it lately AND little mastery (both needed; no mastery → no tag)
    const nr = rule('newTo');
    if (d.champ && d.mastery != null) {
      const n = ranked.filter(x => x.p.champ === d.champ && now - x.g.t <= nr.days * DAY).length;
      if (n <= nr.games && d.mastery < nr.mastery) tag('newTo', { champ: d.champ, vars: { n, pts: d.mastery } });
    }
    // their main / OTP champion picked by the enemy or banned
    const mains = (d.results || []).filter(x => (x.id === 'main' || x.id === 'otp') && x.state === 'met' && x.champ);
    for (const m of mains) {
      const n = (m.vars && m.vars.n) || m.n;
      if ((d.enemyChamps || []).includes(m.champ)) tag('mainTaken', { champ: m.champ, vars: { n } });
      else if ((d.bans || []).includes(m.champ)) tag('mainBanned', { champ: m.champ, vars: { n } });
    }
    // a position from the client that isn't the main role
    if (d.position && d.main && d.position !== d.main) {
      const mr = mainRole(ranked);
      const pct = mr.total ? Math.round((100 * (mr.shares.get(d.main) || 0)) / mr.total) : 0;
      tag('autofill', { vars: { role: d.main, now: d.position, pct } });
    }
    return out;
  }

  const api = { GROUPS, METRICS, mainRole, levelOf, evaluate, pick, isStrength, isWeakness, keys, liveTags };
  if (node) module.exports = api;
  else root.Tags = api;
})(typeof window !== 'undefined' ? window : this);
