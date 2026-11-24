// Filters, sorting and the little statistics of the match history page. Every figure comes from
// stats.js (one place per formula). Shared by the window and the tests (no DOM).
(function (root) {
  const St = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;
  const DAY = 86400000;

  // the player row of the own account that played the game (a game counts once)
  const me = St.me;
  // for sorting and the "KDA at least" filter: 0 deaths = "perfect", ranked above all
  const kda = p => St.kda(p.k, p.d, p.a) + (St.perfect(p) ? 1000 : 0);
  const csMin = (p, g) => St.csMin(g, p);

  // "2026-11-03" -> local midnight of that day (ms), or null
  const dayStart = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };

  // f: { range: 'all'|'today'|'7'|'30'|'90'|'custom', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', result: ''|'win'|'loss', champ: id, minKills, maxDeaths,
  //      minKda, minMulti, sort: 'new'|'kda'|'kills'|'deaths'|'dmg'|'cs'|'long' }
  function filterGames(games, f = {}, now = Date.now()) {
    const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    let from = 0, to = Infinity;
    if (f.range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); from = d.getTime(); }
    else if (['7', '30', '90'].includes(String(f.range))) from = now - Number(f.range) * DAY;
    else if (f.range === 'custom') {
      // both days included; a missing end = open end; swapped dates are fine
      let a = dayStart(f.from), b = dayStart(f.to);
      if (a != null && b != null && a > b) [a, b] = [b, a];
      if (a != null) from = a;
      if (b != null) to = b + DAY;
    }
    const minK = num(f.minKills), maxD = num(f.maxDeaths), minKda = num(f.minKda), minMulti = num(f.minMulti), champ = num(f.champ);
    const out = games.filter(g => {
      const p = me(g);
      if (!p || g.t < from || g.t >= to) return false;
      if (f.result === 'win' && (!p.win || g.remake)) return false;
      if (f.result === 'loss' && (p.win || g.remake)) return false;
      if (champ && p.champ !== champ) return false;
      if (minK != null && p.k < minK) return false;
      if (maxD != null && p.d > maxD) return false;
      if (minKda != null && kda(p) < minKda) return false;
      if (minMulti && (p.multi || 0) < minMulti) return false;
      return true;
    });
    const by = {
      kda: (a, b) => kda(me(b)) - kda(me(a)),
      kills: (a, b) => me(b).k - me(a).k,
      deaths: (a, b) => me(b).d - me(a).d,
      dmg: (a, b) => me(b).dmg - me(a).dmg,
      cs: (a, b) => csMin(me(b), b) - csMin(me(a), a),
      long: (a, b) => b.dur - a.dur,
    }[f.sort];
    return out.sort((a, b) => (by && by(a, b)) || b.t - a.t);
  }

  // totals and records of a list of games (remakes left out; each game once, with its first own account)
  // max: how many entries the champion and teammate lists keep (5 if not given)
  function summarize(games, max = 5) {
    const ps = St.byGame(games);
    const ag = St.aggregate(ps);
    if (!ag) return null;
    const n = ag.n;
    const best = (score) => ps.reduce((b, x) => (!b || score(x) > score(b) ? x : b), null);
    return {
      games: n, wins: ag.wins, winrate: Math.round(100 * ag.winrate),
      // KDA over the sums; null = no death at all ("perfect")
      avg: { k: ag.avg.k, d: ag.avg.d, a: ag.avg.a, kda: ag.perfect ? null : ag.kda, csMin: ag.csMin, dmg: ag.dmg },
      records: {
        kills: best(x => x.p.k), deaths: best(x => x.p.d), kda: best(x => kda(x.p)),
        dmg: best(x => x.p.dmg), multi: best(x => (x.p.multi || 0) * 100 + x.p.k),
      },
      pentas: ps.filter(x => x.p.multi >= 5).length,
      // games by their biggest multikill: { 2: doubles, 3: triples, 4: quadras, 5: pentas }
      multis: Object.fromEntries([2, 3, 4, 5].map(m => [m, ps.filter(x => Math.min(5, x.p.multi || 0) === m).length])),
      streak: streakOf(games),
      champs: topChamps(ps, n, max),
      accounts: perAccount(ps, n),
      duos: duos(ps, max),
      // time in these games (seconds), remakes included – they were played too
      time: games.reduce((s, g) => s + (g.dur || 0), 0),
    };
  }
  // the players you were on a team with most often (2+ games), with the win rate together
  function duos(ps, max = 5) {
    const by = new Map();
    for (const { g, p } of ps) {
      for (const o of g.players) {
        if (o.team !== p.team || o.puuid === p.puuid || !o.puuid || !o.name) continue;
        const d = by.get(o.puuid) || { puuid: o.puuid, name: o.name, tag: o.tag || '', games: 0, wins: 0, champs: new Map() };
        d.games++; d.wins += p.win ? 1 : 0;
        d.champs.set(o.champ, (d.champs.get(o.champ) || 0) + 1);
        by.set(o.puuid, d);
      }
    }
    return [...by.values()].filter(d => d.games >= 2)
      .sort((x, y) => y.games - x.games || y.wins - x.wins).slice(0, max)
      .map(d => ({ puuid: d.puuid, name: d.name, tag: d.tag, games: d.games, wins: d.wins, winrate: Math.round((100 * d.wins) / d.games),
        champ: [...d.champs.entries()].sort((x, y) => y[1] - x[1])[0][0] }));
  }
  // games per own account: games, win rate, share of all games, time played – most games first
  function perAccount(ps, n) {
    const by = new Map();
    for (const { g, p } of ps) {
      const id = (g.owners && g.owners[0]) || p.puuid;
      const a = by.get(id) || { puuid: id, games: 0, wins: 0, time: 0 };
      a.games++; a.wins += p.win ? 1 : 0; a.time += g.dur || 0;
      by.set(id, a);
    }
    return [...by.values()].sort((x, y) => y.games - x.games)
      .map(a => ({ ...a, winrate: Math.round((100 * a.wins) / a.games), share: Math.round((100 * a.games) / n) }));
  }
  // the most played champions: games, win rate, share of all games (play rate), KDA – most games first
  function topChamps(ps, n, max = 5) {
    const by = new Map();
    for (const { p } of ps) {
      const c = by.get(p.champ) || { champ: p.champ, games: 0, wins: 0, k: 0, d: 0, a: 0 };
      c.games++; c.wins += p.win ? 1 : 0; c.k += p.k; c.d += p.d; c.a += p.a;
      by.set(p.champ, c);
    }
    return [...by.values()]
      .sort((x, y) => y.games - x.games || y.wins - x.wins)
      .slice(0, max)
      .map(c => ({ ...c, winrate: Math.round((100 * c.wins) / c.games), playrate: Math.round((100 * c.games) / n), kda: c.d ? St.kda(c.k, c.d, c.a) : null }));
  }
  // current win/loss streak, newest first (by time, remakes skipped)
  function streakOf(games) {
    const list = games.filter(g => !St.isRemake(g)).slice().sort((a, b) => b.t - a.t);
    if (!list.length) return null;
    const first = me(list[0]).win;
    let n = 0;
    for (const g of list) { if (me(g).win !== first) break; n++; }
    return { win: first, n };
  }

  const api = { dayStart, filterGames, summarize, streakOf, kda, me };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MatchFilter = api;
})(typeof window !== 'undefined' ? window : this);
