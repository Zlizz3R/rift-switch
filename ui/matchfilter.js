// Filters, sorting and the little statistics of the match history page.
// Shared by the window and the tests (no DOM).
(function (root) {
  const DAY = 86400000;

  // the player row of the own account that played the game
  const me = g => g.players.find(p => p.puuid === g.owners[0]) || g.players[0];
  const kda = p => (p.d ? (p.k + p.a) / p.d : p.k + p.a + 1000);   // no deaths = "perfect", ranked above all
  const csMin = (p, g) => p.cs / Math.max(1, g.dur / 60);

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

  // totals and records of a list of games (remakes left out)
  function summarize(games) {
    const real = games.filter(g => !g.remake);
    if (!real.length) return null;
    const ps = real.map(g => ({ g, p: me(g) }));
    const sum = k => ps.reduce((s, x) => s + x.p[k], 0);
    const wins = ps.filter(x => x.p.win).length;
    const n = ps.length;
    const best = (score) => ps.reduce((b, x) => (!b || score(x) > score(b) ? x : b), null);
    const k = sum('k'), d = sum('d'), a = sum('a');
    return {
      games: n, wins, winrate: Math.round(100 * wins / n),
      avg: { k: k / n, d: d / n, a: a / n, kda: d ? (k + a) / d : null,
        csMin: ps.reduce((s, x) => s + csMin(x.p, x.g), 0) / n, dmg: sum('dmg') / n },
      records: {
        kills: best(x => x.p.k), deaths: best(x => x.p.d), kda: best(x => kda(x.p)),
        dmg: best(x => x.p.dmg), multi: best(x => (x.p.multi || 0) * 100 + x.p.k),
      },
      pentas: ps.filter(x => x.p.multi >= 5).length,
      // games by their biggest multikill: { 2: doubles, 3: triples, 4: quadras, 5: pentas }
      multis: Object.fromEntries([2, 3, 4, 5].map(m => [m, ps.filter(x => Math.min(5, x.p.multi || 0) === m).length])),
      streak: streakOf(games),
      champs: topChamps(ps, n),
      accounts: perAccount(ps, n),
      // time in these games (seconds), remakes included – they were played too
      time: games.reduce((s, g) => s + (g.dur || 0), 0),
    };
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
      .map(c => ({ ...c, winrate: Math.round((100 * c.wins) / c.games), playrate: Math.round((100 * c.games) / n), kda: c.d ? (c.k + c.a) / c.d : null }));
  }
  // current win/loss streak, newest first (by time, remakes skipped)
  function streakOf(games) {
    const list = games.filter(g => !g.remake).slice().sort((a, b) => b.t - a.t);
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
