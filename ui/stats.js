// Every key figure, computed in exactly one place – match history, overview, live, tags and the
// profile all use these functions. No DOM; shared by the window and the tests.
//
// Rules:
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
  // games on another map than Summoner's Rift (ARAM's Howling Abyss, Arena, Swarm): their places mean
  // nothing on the Rift's map – ARAM's one lane would count as mid lane
  // Arena: the queues of its seasons (1700/1710 two-player teams, 1740/1750 since 2026: six teams of
  // three) – and its game mode CHERRY, so a new queue is Arena too
  const ARENA_QUEUES = [1700, 1710, 1740, 1750];
  const isArena = g => ARENA_QUEUES.includes(Number(g.q)) || g.mode === 'CHERRY';
  const OFF_RIFT = [...ARAM_QUEUES, ...ARENA_QUEUES, 1810, 1820, 1830, 1840];
  const OFF_MODES = ['ARAM', 'CHERRY', 'KIWI', 'STRAWBERRY'];
  const offRift = g => OFF_RIFT.includes(Number(g.q)) || OFF_MODES.includes(g.mode);
  const isRemake = g => !!g.remake || (g.dur != null && g.dur < REMAKE_SEC);
  const minutes = g => Math.max(1, (g.dur || 0) / 60);
  const kda = (k, d, a) => (k + a) / Math.max(1, d);
  const perfect = p => p.d === 0;                       // 0 deaths: shown as "Perfect"
  const team = (g, p) => g.players.filter(o => o.team === p.team);
  // kills of the player's team; null when no player has a kill count
  // (a "lite" game from a match list holds only some players: nothing about the team)
  function teamKills(g, p) {
    if (g.lite) return null;
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
    if (g.lite) return null;
    const sum = team(g, p).reduce((s, o) => s + (o.dmg || 0), 0);
    return sum ? (p.dmg || 0) / sum : null;
  }
  // every figure of one player in one game
  function perGame(g, p) {
    return { k: p.k, d: p.d, a: p.a, kda: kda(p.k, p.d, p.a), perfect: perfect(p), kp: kp(g, p), csMin: csMin(g, p),
      dmgMin: dmgMin(g, p), visMin: visMin(g, p), dmgShare: dmgShare(g, p), win: !!p.win, mins: minutes(g) };
  }

  // ---------- positions ----------
  const POSITIONS = ['top', 'jungle', 'mid', 'bot', 'support'];
  // support items (World Atlas line and the older ones) – their owner was the support
  const SUPPORT_ITEMS = new Set([3850, 3851, 3853, 3854, 3855, 3857, 3858, 3859, 3860, 3862, 3863, 3864, 3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877]);
  const roleCache = new WeakMap();
  // the position of every player of a Summoner's Rift game, or null. Riot's own guess ("pos", from
  // the timeline's lane / role) is often wrong – two tops, jungler and support swapped – so each team
  // gets the best of all 120 arrangements: Smite = jungle, a support item = support, Riot's guess,
  // fewest CS = support, Teleport = top, Heal / Barrier = bot, Exhaust = support.
  function roles(g) {
    if (roleCache.has(g)) return roleCache.get(g);
    let out = null;
    if (g.mode === 'CLASSIC' && g.players && g.players.length === 10) {
      out = new Map();
      for (const team of new Set(g.players.map(p => p.team))) {
        const ps = g.players.filter(p => p.team === team);
        if (ps.length !== 5) { out = null; break; }
        const minCs = Math.min(...ps.map(p => p.cs || 0));
        const fit = (p, r) => {
          const sp = p.spells || [];
          const smite = sp.includes(11), sup = (p.items || []).some(i => SUPPORT_ITEMS.has(i));
          let s = p.pos === r ? 4 : 0;
          if (r === 'jungle') s += smite ? 12 : -8; else if (smite) s -= 8;
          if (r === 'support') s += (sup ? 10 : 0) + ((p.cs || 0) === minCs ? 3 : 0) + (sp.includes(3) ? 1 : 0); else if (sup) s -= 6;
          if (r === 'top' && sp.includes(12)) s += 1;
          if (r === 'bot' && (sp.includes(7) || sp.includes(21))) s += 1;
          return s;
        };
        const f = ps.map(p => POSITIONS.map(r => fit(p, r)));
        let best = null, bestS = -Infinity;
        const walk = (i, used, perm, s) => {
          if (i === 5) { if (s > bestS) { bestS = s; best = perm.slice(); } return; }
          for (let r = 0; r < 5; r++) if (!(used & (1 << r))) { perm.push(r); walk(i + 1, used | (1 << r), perm, s + f[i][r]); perm.pop(); }
        };
        walk(0, 0, [], 0);
        ps.forEach((p, i) => out.set(p, POSITIONS[best[i]]));
      }
    }
    roleCache.set(g, out);
    return out;
  }
  // one player's position, or null (ARAM, Arena, games without all ten players)
  // a lite game: Riot's own guess (Smite = jungle) – the rest of the team isn't known
  const liteRole = (g, p) => (g.mode === 'CLASSIC' ? ((p.spells || []).includes(11) ? 'jungle' : p.pos || null) : null);
  const role = (g, p) => { if (g.lite) return liteRole(g, p); const r = roles(g); return (r && r.get(p)) || null; };

  // the lane opponent: the enemy on the same position (null when positions aren't known)
  function laneOpponent(g, p) {
    if (g.lite) return null;
    const r = roles(g), mine = r && r.get(p);
    return mine ? g.players.find(o => o.team !== p.team && r.get(o) === mine) || null : null;
  }
  // gold lead over the lane opponent at minute m (stored gold per minute); null if unknown
  function goldDiffAt(g, p, m = 15) {
    const o = laneOpponent(g, p), row = g.gold && g.gold[m];
    if (!o || !row) return null;
    const i = g.players.indexOf(p), j = g.players.indexOf(o);
    return Number.isFinite(row[i]) && Number.isFinite(row[j]) ? row[i] - row[j] : null;
  }

  // XP lead over the lane opponent at minute m (game format 6: "xp" per minute); null if unknown
  function xpDiffAt(g, p, m = 15) {
    const o = laneOpponent(g, p), row = g.xp && g.xp[m];
    if (!o || !row) return null;
    const i = g.players.indexOf(p), j = g.players.indexOf(o);
    return Number.isFinite(row[i]) && Number.isFinite(row[j]) ? row[i] - row[j] : null;
  }
  // the own team's gold lead at minute m (all five together); null if unknown
  function teamGoldDiffAt(g, p, m = 15) {
    const row = g.gold && g.gold[m];
    if (!row) return null;
    let d = 0;
    g.players.forEach((o, j) => { if (Number.isFinite(row[j])) d += o.team === p.team ? row[j] : -row[j]; });
    return d;
  }
  // Summoner's Rift in hundreds of units (0–148; blue base bottom left, red top right): where a
  // place is – 'top' | 'mid' | 'bot' (lanes), 'river', 'base', or 'jungle100' / 'jungle200' (the
  // jungle on the blue / red side of the river)
  function zone(x, y) {
    if ((x < 45 && y < 45) || (x > 103 && y > 103)) return 'base';
    if ((x < 22 && y > 45) || (y > 126 && x < 103) || (x < 35 && y > 113)) return 'top';
    if ((y < 22 && x > 45) || (x > 126 && y < 103) || (x > 113 && y < 35)) return 'bot';
    if (Math.abs(x - y) < 12) return 'mid';
    if (Math.abs(x + y - 148) < 10) return 'river';
    return x + y < 148 ? 'jungle100' : 'jungle200';
  }
  // where player i stood at second s (game format 6: "at" per minute, in between interpolated)
  function placeAt(g, i, s) {
    if (!g.at) return null;
    const m = Math.floor(s / 60), a = g.at[m] && g.at[m][i], b = g.at[m + 1] && g.at[m + 1][i];
    if (!a) return b || null;
    if (!b) return a;
    const f = s / 60 - m;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  // ---------- timeline (game format 4: "csm", "kills" [second, killer, victim, [assists]], "w1", "drake1") ----------
  const hasKills = g => Array.isArray(g.kills);
  const pIdx = (g, p) => g.players.indexOf(p);
  // CS of player i at minute m; null when the game has no such minute
  const csAt = (g, i, m) => (g.csm && g.csm.length > m && g.csm[m] ? g.csm[m][i] : null);
  // solo kill: a kill on a champion without any assist, by a champion
  const soloKills = (g, p) => g.kills.filter(k => k[1] === pIdx(g, p) && k[2] >= 0 && !k[3].length).length;
  // solo death: killed by one enemy champion without assists; gank death: with at least one assist
  const soloDeaths = (g, p) => g.kills.filter(k => k[2] === pIdx(g, p) && k[1] >= 0 && !k[3].length).length;
  const deathsBefore = (g, p, sec) => g.kills.filter(k => k[2] === pIdx(g, p) && k[0] < sec).length;
  const gankDeathsBefore = (g, p, sec) => g.kills.filter(k => k[2] === pIdx(g, p) && k[0] < sec && k[3].length > 0).length;
  // kills and assists before a time; the first own kill
  const takedownsBefore = (g, p, sec) => { const i = pIdx(g, p); return g.kills.filter(k => k[0] < sec && (k[1] === i || k[3].includes(i))).length; };
  const killBefore = (g, p, sec) => g.kills.some(k => k[1] === pIdx(g, p) && k[0] < sec);
  // farm share from minute a to b: own CS ÷ the team's CS in that time; null if not known
  function farmShare(g, p, a, b) {
    const i = pIdx(g, p);
    const mine = csAt(g, i, b) != null && csAt(g, i, a) != null ? csAt(g, i, b) - csAt(g, i, a) : null;
    const team = g.players.reduce((s, o, j) => (o.team === p.team && csAt(g, j, b) != null ? s + csAt(g, j, b) - (csAt(g, j, a) || 0) : s), 0);
    return mine != null && team > 0 ? mine / team : null;
  }
  // a successful gank (jungle): a kill before 14:00 the jungler took part in, on an enemy laner
  function gankedBefore(g, p, sec = 840) {
    const i = pIdx(g, p);
    return g.kills.some(k => {
      const v = k[2] >= 0 ? g.players[k[2]] : null;
      const r = v && role(g, v);
      return k[0] < sec && (k[1] === i || k[3].includes(i)) && v && v.team !== p.team && r && r !== 'jungle';
    });
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
      cs: sum(x => x.p.cs || 0) / n,
      accounts: new Set(rows.map(x => x.p.puuid)).size,
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

  const api = { REMAKE_SEC, ARAM_QUEUES, ARENA_QUEUES, isArena, RANKED_QUEUES, winPct, isRemake, offRift, minutes, kda, perfect, team, teamKills, kp, csMin, dmgMin,
    visMin, dmgShare, perGame, POSITIONS, roles, role, laneOpponent, goldDiffAt, xpDiffAt, teamGoldDiffAt, zone, placeAt, hasKills, csAt, soloKills, soloDeaths, deathsBefore, gankDeathsBefore, takedownsBefore, killBefore, farmShare, gankedBefore, me, byGame, byParticipation, uniqueGames, aggregate, groupBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : this);
