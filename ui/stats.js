// Every key figure, computed in exactly one place – match history, overview, live, tags and the
// profile all use these functions. No DOM; shared by the window and the tests.
//
// Rules (docs/plans, section 1):
// - KDA = (K + A) / max(1, D), over sums when it's about several games; "Ø K / D / A" are three means.
// - Missing ≠ 0: a value that can't be known is null and left out of averages, never counted as 0.
// - Weighted: totals over games, never means of win rates.
// - Remakes (game shorter than 5 minutes) count nowhere.
// - One game, two own accounts: counted once for "games" (byGame), every participation counts for
//   performance (byParticipation). Each function says which one it uses.
(function (root) {
  const REMAKE_SEC = 300;
  const ARAM_QUEUES = [450, 2400, 3220, 3270, 720];
  const RANKED_QUEUES = [420, 440];

  // win rate in whole percent (from wins and games); null without games
  const winPct = (w, n) => (n ? Math.round((100 * w) / n) : null);

  // ---------- one game ----------
  const isRemake = g => !!g.remake || (g.dur != null && g.dur < REMAKE_SEC);
  const minutes = g => Math.max(1, (g.dur || 0) / 60);
  const kda = (k, d, a) => (k + a) / Math.max(1, d);
  const perfect = p => p.d === 0;                       // 0 deaths: shown as "Perfect"
  const team = (g, p) => g.players.filter(o => o.team === p.team);
  // kills of the player's team; null when no player has a kill count
  function teamKills(g, p) {
    const t = team(g, p).filter(o => Number.isFinite(o.k));
    return t.length ? t.reduce((s, o) => s + o.k, 0) : null;
  }
  // kill participation 0..1; null when the team had no kill (can't tell)
  function kp(g, p) {
    const tk = teamKills(g, p);
    return tk ? (p.k + p.a) / tk : null;
  }
  const csMin = (g, p) => (p.cs || 0) / minutes(g);
  const dmgMin = (g, p) => (p.dmg || 0) / minutes(g);
  const visMin = (g, p) => (Number.isFinite(p.vis) ? p.vis / minutes(g) : null);
  // share of the team's damage to champions 0..1; null without team damage
  function dmgShare(g, p) {
    const sum = team(g, p).reduce((s, o) => s + (o.dmg || 0), 0);
    return sum ? (p.dmg || 0) / sum : null;
  }
  // every figure of one player in one game
  function perGame(g, p) {
    return { k: p.k, d: p.d, a: p.a, kda: kda(p.k, p.d, p.a), perfect: perfect(p), kp: kp(g, p), csMin: csMin(g, p),
      dmgMin: dmgMin(g, p), visMin: visMin(g, p), dmgShare: dmgShare(g, p), win: !!p.win, mins: minutes(g) };
  }

  // ---------- which player rows count ----------
  // the own player of a game: its first own account (a game counts once)
  const me = g => g.players.find(p => p.puuid === (g.owners || [])[0]) || g.players[0];
  // each game once, with its first own account; remakes out
  const byGame = games => games.filter(g => !isRemake(g)).map(g => ({ g, p: me(g) })).filter(x => x.p);
  // every own account's part in every game (two own accounts in one game = two rows); remakes out
  function byParticipation(games, own) {
    const out = [];
    for (const g of games) {
      if (isRemake(g)) continue;
      const mine = own ? new Set(own) : new Set(g.owners || []);
      for (const p of g.players) if (mine.has(p.puuid)) out.push({ g, p });
    }
    return out;
  }
  // games counted once (for "how many games"), however many own accounts played them
  const uniqueGames = rows => new Set(rows.map(x => x.g.id)).size;

  // ---------- many games ----------
  // rows: [{ g, p }] from byGame / byParticipation. Means over the rows; KDA over the sums;
  // a figure some games can't tell (vision, KP) is averaged over the games that can, with its count.
  function aggregate(rows) {
    const n = rows.length;
    if (!n) return null;
    const sum = f => rows.reduce((s, x) => s + f(x), 0);
    const known = f => {
      const v = rows.map(x => f(x.g, x.p)).filter(x => x != null && Number.isFinite(x));
      return { avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, n: v.length };
    };
    const k = sum(x => x.p.k), d = sum(x => x.p.d), a = sum(x => x.p.a), wins = sum(x => (x.p.win ? 1 : 0));
    const kpv = known(kp), vis = known(visMin), share = known(dmgShare);
    return {
      n, games: uniqueGames(rows), wins, losses: n - wins, winrate: wins / n,
      k, d, a, avg: { k: k / n, d: d / n, a: a / n },
      kda: kda(k, d, a), perfect: d === 0,
      csMin: sum(x => csMin(x.g, x.p)) / n,
      dmgMin: sum(x => dmgMin(x.g, x.p)) / n,
      dmg: sum(x => x.p.dmg || 0) / n,
      visMin: vis.avg, visN: vis.n,
      kp: kpv.avg, kpN: kpv.n,
      dmgShare: share.avg, dmgShareN: share.n,
      secs: sum(x => x.g.dur || 0),
    };
  }
  // rows grouped by a key (champion, account, position …): Map key -> aggregate
  function groupBy(rows, key) {
    const m = new Map();
    for (const x of rows) {
      const k = key(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return new Map([...m].map(([k, list]) => [k, aggregate(list)]));
  }

  const api = { REMAKE_SEC, ARAM_QUEUES, RANKED_QUEUES, winPct, isRemake, minutes, kda, perfect, team, teamKills, kp, csMin, dmgMin,
    visMin, dmgShare, perGame, me, byGame, byParticipation, uniqueGames, aggregate, groupBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : this);
