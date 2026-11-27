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
    // dragons and barons of the own team the player was in on (killer or assist; game format 5)
    objPart: rows => {
      const r = rows.filter(x => Array.isArray(x.g.obj));
      let took = 0, inv = 0, n = 0;
      for (const x of r) {
        const i = x.g.players.indexOf(x.p);
        const mine = x.g.obj.filter(o => 'DEB'.includes(o[1]) && o[2] === x.p.team);
        if (!mine.length) continue;
        n++; took += mine.length; inv += mine.filter(o => o[3].includes(i)).length;
      }
      return { v: took ? inv / took : null, n, vars: { took, inv } };
    },
    // XP lead over the lane opponent at 15 minutes (game format 6)
    xpDiff15: rows => { const d = rows.map(x => St.xpDiffAt(x.g, x.p, 15)).filter(v => v != null); return { v: avgOf(d), n: d.length }; },
    goldMin: rows => { const r = rows.filter(x => x.g.dur > 0 && x.p.gold); return { v: avgOf(r.map(x => x.p.gold / (x.g.dur / 60))), n: r.length }; },
    wardsKilled: rows => { const r = withX(rows); return { v: avgOf(r.map(x => x.p.x.wardsKilled || 0)), n: r.length }; },
    // the game's first champion kill: in on it (kill or assist) / its victim
    fbPart: rows => {
      const r = rows.map(x => ({ x, k: St.hasKills(x.g) ? x.g.kills.find(k => k[2] >= 0) : null })).filter(y => y.k);
      return { v: avgOf(r.map(({ x, k }) => { const i = x.g.players.indexOf(x.p); return k[1] === i || k[3].includes(i) ? 1 : 0; })), n: r.length };
    },
    fbDeath: rows => {
      const r = rows.map(x => ({ x, k: St.hasKills(x.g) ? x.g.kills.find(k => k[2] >= 0) : null })).filter(y => y.k);
      return { v: avgOf(r.map(({ x, k }) => (k[2] === x.g.players.indexOf(x.p) ? 1 : 0))), n: r.length };
    },
    // games 2,000 gold behind at 15 minutes that were won / 2,000 ahead that were lost (the team's gold)
    comeback: rows => {
      const r = rows.filter(x => { const d = St.teamGoldDiffAt(x.g, x.p, 15); return d != null && d <= -COMEBACK_GOLD; });
      return { v: r.length ? r.filter(x => x.p.win).length / r.length : null, n: r.length, vars: { w: r.filter(x => x.p.win).length } };
    },
    throws: rows => {
      const r = rows.filter(x => { const d = St.teamGoldDiffAt(x.g, x.p, 15); return d != null && d >= COMEBACK_GOLD; });
      return { v: r.length ? r.filter(x => !x.p.win).length / r.length : null, n: r.length, vars: { l: r.filter(x => !x.p.win).length } };
    },
    // kills and assists before 14:00 in another lane than the own one (game format 6: kill places)
    roam: rows => {
      const own = { top: 'top', mid: 'mid', bot: 'bot', support: 'bot' };
      const r = rows.filter(x => St.hasKills(x.g) && x.g.at && own[St.role(x.g, x.p)]);
      return { v: avgOf(r.map(x => {
        const i = x.g.players.indexOf(x.p), lane = own[St.role(x.g, x.p)];
        return x.g.kills.filter(k => k[0] < 840 && k.length > 5 && (k[1] === i || k[3].includes(i)) && k[2] >= 0
          && x.g.players[k[2]].team !== x.p.team && ['top', 'mid', 'bot'].includes(St.zone(k[4], k[5])) && St.zone(k[4], k[5]) !== lane).length;
      })), n: r.length };
    },
    // caught: deaths after 15:00 with no team mate within 2,500 units and at least two enemies in on it
    caught: rows => {
      const r = rows.filter(x => St.hasKills(x.g) && x.g.at);
      return { v: avgOf(r.map(x => {
        const i = x.g.players.indexOf(x.p);
        return x.g.kills.filter(k => {
          if (k[2] !== i || k[0] < 900 || k[1] < 0 || k.length < 6) return false;
          const enemies = 1 + k[3].length;
          const near = x.g.players.some((o, j) => j !== i && o.team === x.p.team && (() => { const q = St.placeAt(x.g, j, k[0]); return q && Math.hypot(q[0] - k[4], q[1] - k[5]) < 25; })());
          return enemies >= 2 && !near;
        }).length;
      })), n: r.length };
    },
    // steals: a big objective the player took the last hit on while more enemies than team mates hit it
    steals: rows => {
      const r = rows.filter(x => Array.isArray(x.g.obj) && x.g.obj.every(o => o.length > 5));
      return { v: avgOf(r.map(x => { const i = x.g.players.indexOf(x.p); return x.g.obj.filter(o => 'DEBHA'.includes(o[1]) && o[4] === i && o[5] >= 2 && o[5] > o[3].length).length; })), n: r.length };
    },
    // jungle CS taken in the enemy jungle per game (per minute: the camps, where the player stood)
    invade: rows => { const r = rows.filter(x => x.g.jcs && x.g.at); return { v: avgOf(r.map(x => invadeCs(x.g, x.g.players.indexOf(x.p)))), n: r.length }; },
    // jungle CS the enemies took in the own jungle per game
    invaded: rows => {
      const r = rows.filter(x => x.g.jcs && x.g.at);
      return { v: avgOf(r.map(x => x.g.players.reduce((s, o, j) => (o.team !== x.p.team ? s + invadeCs(x.g, j) : s), 0))), n: r.length };
    },
    firstDrake: rows => { const r = rows.filter(x => x.g.drake1 != null); return { v: avgOf(r.map(x => (x.g.drake1 === x.p.team ? 1 : 0))), n: r.length }; },
    gank: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => (St.gankedBefore(x.g, x.p) ? 1 : 0))), n: r.length }; },
    takedowns15: rows => { const r = rows.filter(x => St.hasKills(x.g)); return { v: avgOf(r.map(x => St.takedownsBefore(x.g, x.p, 900))), n: r.length }; },
    // ARAM: per minute, because the games differ in length (also from the short match-list games)
    deathsMin10: rows => { const r = rows.filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => x.p.d / (x.g.dur / 600))), n: r.length }; },
    tankMin: rows => { const r = withX(rows).filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => ((x.p.x.taken || 0) + (x.p.x.mitig || 0)) / (x.g.dur / 60))), n: r.length }; },
    healMin: rows => { const r = withX(rows).filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => (x.p.x.heal || 0) / (x.g.dur / 60))), n: r.length }; },
    ccMin: rows => { const r = withX(rows).filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => (x.p.x.cc || 0) / (x.g.dur / 60))), n: r.length }; },
    // games with a triple kill or more
    multi3: rows => ({ v: avgOf(rows.map(x => ((x.p.multi || 0) >= 3 ? 1 : 0))), n: rows.length }),
    // ARAM: damage to towers per minute, kills and assists per 10 minutes, the damage dealt against the
    // damage taken, the longest killing spree, comebacks and thrown leads at 10 minutes (shorter games)
    turretMin: rows => { const r = withX(rows).filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => (x.p.x.turretDmg || 0) / (x.g.dur / 60))), n: r.length }; },
    killsMin10: rows => { const r = rows.filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => x.p.k / (x.g.dur / 600))), n: r.length }; },
    assistsMin10: rows => { const r = rows.filter(x => x.g.dur > 0); return { v: avgOf(r.map(x => x.p.a / (x.g.dur / 600))), n: r.length }; },
    poke: rows => {
      const r = withX(rows).filter(x => x.p.x.taken > 0);
      const taken = r.reduce((s, x) => s + x.p.x.taken, 0);
      return { v: taken ? r.reduce((s, x) => s + (x.p.dmg || 0), 0) / taken : null, n: r.length };
    },
    spree: rows => { const r = withX(rows); return { v: avgOf(r.map(x => x.p.x.spree || 0)), n: r.length }; },
    comeback10: rows => {
      const r = rows.filter(x => { const d = St.teamGoldDiffAt(x.g, x.p, 10); return d != null && d <= -ARAM_COMEBACK_GOLD; });
      return { v: r.length ? r.filter(x => x.p.win).length / r.length : null, n: r.length, vars: { w: r.filter(x => x.p.win).length } };
    },
    throws10: rows => {
      const r = rows.filter(x => { const d = St.teamGoldDiffAt(x.g, x.p, 10); return d != null && d >= ARAM_COMEBACK_GOLD; });
      return { v: r.length ? r.filter(x => !x.p.win).length / r.length : null, n: r.length, vars: { l: r.filter(x => !x.p.win).length } };
    },
  };
  // ARAM: a team this far behind / ahead at minute 10 counts for comebacks and thrown leads
  const ARAM_COMEBACK_GOLD = 1500;

  const COMEBACK_GOLD = 2000;
  // jungle CS player i took in the enemy jungle: each minute's camps count where the player stood
  // at its start and end (half each)
  function invadeCs(g, i) {
    const team = g.players[i].team, theirs = team === 100 ? 'jungle200' : 'jungle100';
    let s = 0;
    for (let m = 0; m + 1 < g.jcs.length; m++) {
      const d = (g.jcs[m + 1][i] || 0) - (g.jcs[m][i] || 0);
      if (d <= 0) continue;
      const a = g.at[m] && g.at[m][i], b = g.at[m + 1] && g.at[m + 1][i];
      s += d * (((a && St.zone(a[0], a[1]) === theirs) ? 0.5 : 0) + ((b && St.zone(b[0], b[1]) === theirs) ? 0.5 : 0));
    }
    return s;
  }

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
  // d: { all, season, d7, d30, d60, role rows, role, level, mastery, prev, now }
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
      case 'poolTop': {
        // the top champions take more than this share of the games
        if (rows.length < r.min) return [few(rows.length, r.min)];
        const tops = [...countBy(rows, x => x.p.champ)].sort((a, b) => b[1] - a[1]).slice(0, r.champs);
        const share = tops.reduce((s, [, c]) => s + c, 0) / rows.length;
        return [out(share > r.share ? 'met' : 'not', { value: share, th: r.share, n: rows.length, champ: tops[0][0],
          vars: { k: tops.length, share: Math.round(share * 100), n: rows.length, champs: tops.map(([c]) => c) } })];
      }
      case 'phase': {
        // win rate in short games against long ones; only a clear difference counts (z ≥ 1.65,
        // about 95 % sure, and at least r.diff), with enough games on both sides
        const short = rows.filter(x => x.g.dur < r.short * 60), long = rows.filter(x => x.g.dur >= r.long * 60);
        if (short.length < r.min || long.length < r.min) return [few(Math.min(short.length, long.length), r.min)];
        const ws = short.filter(x => x.p.win).length / short.length, wl = long.filter(x => x.p.win).length / long.length;
        const p = (ws * short.length + wl * long.length) / (short.length + long.length);
        const se = Math.sqrt(p * (1 - p) * (1 / short.length + 1 / long.length)) || 1;
        const d = r.late ? wl - ws : ws - wl;
        return [out(d >= r.diff && d / se >= 1.65 ? 'met' : 'not', { value: d, th: r.diff, n: short.length + long.length,
          vars: { s: Math.round(ws * 100), l: Math.round(wl * 100), ns: short.length, nl: long.length } })];
      }
      case 'roleSpread': {
        const mr = mainRole(rows);
        if (mr.total < r.min) return [few(mr.total, r.min)];
        const sorted = [...mr.shares].sort((a, b) => b[1] - a[1]);
        const list = sorted.map(([ro, n]) => [ro, Math.round((100 * n) / mr.total)]);
        const share = sorted[0][1] / mr.total;
        // maxShare: no role above it (generalist); minShare: one role above it (one role only)
        const ok = r.minShare != null ? share > r.minShare : share <= r.maxShare;
        return [out(ok ? 'met' : 'not', { value: share, th: r.minShare != null ? r.minShare : r.maxShare, n: mr.total,
          vars: { list, role: sorted[0][0], pct: list[0][1], n: mr.total } })];
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
        // every champion past a milestone (not only the top three)
        const hits = d.mastery.filter(m => m.total >= steps[steps.length - 1][1]);
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
  //        prev: Set of 'id:level' shown before, rows: the participations to judge (a filter's choice –
  //        queues, period, last n games, champion; Summoner's Rift only) instead of this season's ranked }
  // → { role, main, most, results }
  function evaluate(ctx) {
    const now = ctx.now || Date.now();
    const own = new Set(ctx.own || []);
    // this season's ranked games only – or exactly the games a filter chose
    const seasonFrom = seasonStart(now);
    const all = ctx.rows ? ctx.rows.filter(x => own.has(x.p.puuid) && !St.offRift(x.g))
      : St.byParticipation(ctx.games || []).filter(x => own.has(x.p.puuid) && RANKED.includes(x.g.q) && x.g.t >= seasonFrom);
    const d = {
      all, now, level: ctx.level == null ? null : ctx.level, mastery: ctx.mastery || null, prev: ctx.prev || new Set(),
      season: ctx.rows ? all : all.filter(x => x.g.t >= seasonFrom), d7: all.filter(x => now - x.g.t <= 7 * DAY), d30: all.filter(x => now - x.g.t <= 30 * DAY), d60: all.filter(x => now - x.g.t <= 60 * DAY),
    };
    const mr = mainRole(d.season);
    d.role = ctx.role || mr.main || mr.most || null;
    d.roleRows = d.role ? d.season.filter(x => St.role(x.g, x.p) === d.role) : d.season;
    const results = [];
    for (const r of TR.TAG_RULES) if (!r.live && !r.off) results.push(...evalRule(r, d));
    // OTP beats "main" on the same champion
    const otp = results.find(x => x.id === 'otp' && x.state === 'met');
    const kept = otp ? results.filter(x => !(x.id === 'main' && x.state === 'met' && x.champ === otp.champ)) : results;
    return { role: d.role, main: mr.main, most: mr.most, shares: mr.shares, total: mr.total, roleN: d.roleRows.length, results: kept };
  }

  // "All roles": the tags that depend on the role (metric, carry, avg) for every role played at least
  // ALL_ROLE_MIN times, each with that role's thresholds; each such result carries its role and the
  // role's share of the games. The other tags once, as for the main role.
  const ROLE_TYPES = new Set(['metric', 'carry', 'avg']);
  const ALL_ROLE_MIN = 5;
  function evaluateAll(ctx) {
    const base = evaluate({ ...ctx, role: null });
    const typeOf = id => (TR.TAG_RULES.find(r => r.id === id) || {}).type;
    const results = base.results.filter(x => !ROLE_TYPES.has(typeOf(x.id)));
    const roles = [...base.shares].filter(([, n]) => n >= ALL_ROLE_MIN).sort((a, b) => b[1] - a[1]);
    for (const [role, n] of roles) {
      const share = n / base.total;
      const prev = new Set([...(ctx.prev || [])].filter(k => k.endsWith(':' + role)).map(k => k.slice(0, -role.length - 1)));
      for (const x of evaluate({ ...ctx, role, prev }).results) if (ROLE_TYPES.has(typeOf(x.id))) results.push({ ...x, role, roleShare: share });
    }
    return { ...base, role: null, all: true, roles: roles.map(([role, n]) => ({ role, n, share: n / base.total })), results };
  }

  // ARAM: this season's ARAM games with the ARAM catalogue (tag-rules.js ARAM_RULES) – no roles.
  // ctx: { games, own: puuids counted, now, prev } → { aram: true, n, results }
  const ARAM_Q = [450, 2400];
  const ARAM_GROUPS = ['pool', 'form', 'stats', 'fight'];
  function evaluateAram(ctx) {
    const now = ctx.now || Date.now();
    const own = new Set(ctx.own || []);
    const all = ctx.rows ? ctx.rows.filter(x => own.has(x.p.puuid) && ARAM_Q.includes(x.g.q))
      : St.byParticipation(ctx.games || []).filter(x => own.has(x.p.puuid) && ARAM_Q.includes(x.g.q) && x.g.t >= seasonStart(now));
    const d = { all, now, level: null, mastery: null, prev: ctx.prev || new Set(), role: null, roleRows: all, season: all,
      d7: all.filter(x => now - x.g.t <= 7 * DAY), d30: all.filter(x => now - x.g.t <= 30 * DAY), d60: all.filter(x => now - x.g.t <= 60 * DAY) };
    const results = [];
    for (const r of TR.ARAM_RULES || []) if (!r.off && !r.live) results.push(...evalRule(r, d));
    return { aram: true, role: null, n: all.length, roleN: all.length, results };
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
  // weak / terrible levels, and the tags that are bad on their own (not the form ones: a losing
  // streak isn't something to work on)
  const isWeakness = x => x.state === 'met' && (x.level === 'weak' || x.level === 'terrible' || (!x.level && x.color === 'bad' && x.group !== 'form'));
  // Other players (Live, the player page): Riot's policies forbid shaming players by any metric,
  // also by recent results, and assumptions that make them look bad. So they get only what speaks
  // for them or is neutral: no weak / terrible levels, no "bad" or "warn" tags (losing streak,
  // "Smurf?", dies to ganks, new to a champion, autofilled …) – except two neutral play styles.
  // The own accounts see everything. Tags that aren't met stay (nothing is said about them).
  const OTHERS_NEUTRAL = new Set(['readyToRumble', 'aggroJungler']);
  const forOthers = results => results.filter(x => x.state !== 'met'
    || (x.level ? x.level === 'great' || x.level === 'master' : x.color === 'good' || x.color === 'info' || OTHERS_NEUTRAL.has(x.id)));
  // the keys for the next run's hysteresis
  // ("All roles": with the role at the end – each role keeps its own)
  const keys = results => new Set(results.filter(x => x.state === 'met' && x.level).map(x => `${x.id}:${x.level}${x.role ? ':' + x.role : ''}`));

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

  // How much a trait matters while playing against (or with) someone – Live shows the first ones:
  // 1 = act on it (dies to ganks, first blood victim, a streak, autofilled …), 2 = good to know
  // (great farmer, early lead …), 3 = background (pool size, mastery, one role only).
  // ctx: { champ: played now, position: from the client, main: main role } – a trait about another
  // champion than the one played now, or "one role only" on that very role, is background.
  const TIER1 = new Set(['fbVictim', 'gankVictim', 'invaded', 'throws', 'lossStreak', 'hotStreak', 'smurf', 'firstBlood', 'aggroJungler',
    'ganker', 'roamer', 'invader', 'duelist', 'soloFighter', 'unkillable', 'carry', 'newTo', 'mainTaken', 'mainBanned', 'autofill', 'otp', 'noPinks',
    'arHot', 'arCold', 'arCarry', 'arMulti']);
  const TIER3 = new Set(['flexPool', 'smallPool', 'generalist', 'oneRole', 'mastery', 'grinder', 'backAgain']);
  function tierOf(x, ctx = {}) {
    if (x.live) return 1;
    if (x.champ && ctx.champ && x.champ !== ctx.champ) return 3;
    if (x.id === 'oneRole' && ctx.position && (!ctx.main || ctx.position === ctx.main)) return 3;
    if (x.id === 'deaths' && (x.level === 'weak' || x.level === 'terrible')) return 1;
    return TIER1.has(x.id) ? 1 : TIER3.has(x.id) ? 3 : 2;
  }

  const api = { GROUPS, ARAM_GROUPS, METRICS, mainRole, levelOf, evaluate, evaluateAll, evaluateAram, tierOf, pick, isStrength, isWeakness, forOthers, keys, liveTags };
  if (node) module.exports = api;
  else root.Tags = api;
})(typeof window !== 'undefined' ? window : this);
