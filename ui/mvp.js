// MVP, ACE and the placement of all ten (postgame.js). Summoner's Rift: every player's game is set
// against players on the same role with the same result (winners against winners, losers against
// losers) – kill participation, share of the team's kills, deaths, share of the team's damage, farm
// (not a support's), vision, share of the damage taken, objectives, crowd control, the lane against
// the opponent and KDA – each as its distance from what is usual there. The sum becomes "how rare is
// that among those players", so a support's great game counts as much as a carry's: in the stored
// games every role is MVP and ACE equally often. A win adds a bonus (winners above losers in the
// placement); the MVP is the best winner, the ACE the best loser. The figures behind it are in
// ui/mvp-rules.js (tools/mvp-calibrate.js, from the stored games of OTHER players – the own
// accounts left out). ARAM, Arena or a game without roles: every figure against the best of the ten.
// No DOM; window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const RULES = node ? (() => { try { return require('./mvp-rules.js'); } catch { return null; } })() : root.MvpRules;
  const FEAT = ['kp', 'ksh', 'dth', 'dsh', 'cpm', 'vpm', 'tsh', 'obj', 'ccm', 'lane', 'kda'];
  // how much each part counts (KDA little: kill participation and deaths say most of it already)
  const WEIGHTS = { kp: 0.22, ksh: 0.14, dth: 0.12, dsh: 0.18, cpm: 0.05, vpm: 0.08, tsh: 0.06, obj: 0.05, ccm: 0.04, lane: 0.06, kda: 0.06 };
  const NOT_FOR = { support: new Set(['cpm']) };
  const LOWER_BETTER = new Set(['dth']);
  const WIN_BONUS = 0.5;
  const LANE_W = { gold: 0.3, dmg: 0.25, kda: 0.25, cs: 0.1, vis: 0.1 };

  // how much better than the lane opponent: per stat my share of the two of us (0.5 = even),
  // weighted; mult: the same as ×0.60 … ×1.40 (shown under the placement – a 60 : 40 lane is ×1.15)
  function lane(g, p, ro = St.roles(g)) {
    if (!ro) return null;
    const o = g.players.find(x => x.team !== p.team && ro.get(x) === ro.get(p));
    if (!o) return null;
    const v = x => ({ gold: x.gold || 0, dmg: x.dmg || 0, kda: St.kda(x.k, x.d, x.a), cs: x.cs || 0, vis: x.vis || 0 });
    const a = v(p), b = v(o);
    const share = Object.keys(LANE_W).reduce((s, k) => s + LANE_W[k] * (a[k] + b[k] > 0 ? a[k] / (a[k] + b[k]) : 0.5), 0);
    return { opp: o, share, mult: Math.min(1.4, Math.max(0.6, 1 + (share - 0.5) * 1.5)) };
  }

  // every player's figures; null where the game doesn't say (the end screen has no objectives …).
  // null for the whole game: no roles (not Summoner's Rift, not five a side)
  function features(g, roIn) {
    const ro = roIn || (g && g.players && St.roles(g));
    if (!ro) return null;
    const min = Math.max(1, (g.dur || 0) / 60);
    const known = k => g.players.some(p => p.x && p.x[k] != null);
    const has = { mitig: known('mitig'), obj: known('obj'), cc: known('cc') };
    const xs = (p, k) => (p.x && p.x[k]) || 0;
    const sum = (ps, f) => ps.reduce((s, o) => s + (f(o) || 0), 0);
    const tank = o => xs(o, 'taken') + xs(o, 'mitig');
    return g.players.map(p => {
      const tm = g.players.filter(o => o.team === p.team);
      const tk = sum(tm, o => o.k), td = sum(tm, o => o.dmg), tt = sum(tm, tank), to = sum(tm, o => xs(o, 'obj'));
      const l = lane(g, p, ro);
      return {
        role: ro.get(p), win: !!p.win, lane_: l,
        kp: tk ? (p.k + p.a) / tk : null,
        ksh: tk ? p.k / tk : null,
        dth: p.d / min,
        dsh: td ? (p.dmg || 0) / td : null,
        cpm: (p.cs || 0) / min,
        vpm: (p.vis || 0) / min,
        tsh: has.mitig && tt ? tank(p) / tt : null,
        obj: has.obj && to ? xs(p, 'obj') / to : null,
        ccm: has.cc ? xs(p, 'cc') / min : null,
        lane: l ? l.share : null,
        kda: Math.min(10, St.kda(p.k, p.d, p.a)),
      };
    });
  }
  const groupOf = x => x.role + (x.win ? 'W' : 'L');
  // the weighted sum of the parts, each in spreads from the usual of the group (±3 at most)
  function raw(x, norm) {
    const nm = norm[groupOf(x)];
    if (!nm) return 0;
    let s = 0;
    for (const k of FEAT) {
      if (x[k] == null || !nm[k] || (NOT_FOR[x.role] && NOT_FOR[x.role].has(k))) continue;
      const [m, sd] = nm[k];
      const z = Math.max(-3, Math.min(3, (x[k] - m) / (sd || 1)));
      s += WEIGHTS[k] * (LOWER_BETTER.has(k) ? -z : z);
    }
    return s;
  }
  // the inverse of the normal distribution (P. Acklam's approximation)
  function probit(p) {
    p = Math.min(0.999, Math.max(0.001, p));
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
    if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
    const q = p - 0.5, r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // share of the group below v, from its quantiles (q[0] = lowest … q[n] = highest)
  function cdf(q, v) {
    const n = q.length - 1;
    if (v <= q[0]) return 0.25 / n;
    if (v >= q[n]) return 1 - 0.25 / n;
    let i = 0;
    while (i < n - 1 && q[i + 1] < v) i++;
    return (i + (v - q[i]) / (q[i + 1] - q[i] || 1)) / n;
  }
  // the final score of every row: how rare among its group, the win bonus, the role's offset
  function scoreRows(rows, R = RULES) {
    return rows.map(x => {
      const q = R.quant[groupOf(x)];
      if (!q) return 0;
      return probit(cdf(q, raw(x, R.norm))) + (x.win ? WIN_BONUS : -WIN_BONUS) + ((R.offset || {})[x.role] || 0);
    });
  }
  // ARAM, Arena, a game without roles: every figure relative to the best of the ten
  const FALLBACK = { kp: 0.25, dmg: 0.25, kda: 0.15, gold: 0.1, taken: 0.1, vis: 0.1, cs: 0.05 };
  function fallback(g) {
    const vals = g.players.map(p => ({
      kda: Math.min(10, St.kda(p.k, p.d, p.a)), kp: St.kp(g, p) ?? 0, dmg: p.dmg || 0, gold: p.gold || 0,
      taken: (p.x && p.x.taken) || 0, vis: p.vis || 0, cs: St.csMin(g, p),
    }));
    const max = Object.fromEntries(Object.keys(FALLBACK).map(k => [k, Math.max(1e-9, ...vals.map(v => v[k]))]));
    return vals.map(v => Object.keys(FALLBACK).reduce((s, k) => s + FALLBACK[k] * (v[k] / max[k]), 0));
  }

  // the score on a scale from 0 to 10: 5 = an average game (winners above it, losers below); the
  // other modes: the share of the best possible against the best of the ten
  const clamp10 = v => Math.max(0, Math.min(10, v));
  const RATE = { mid: 5, per: 1.6 };

  // { place(i) 1…10, mvp: index of the best winner, ace: of the best loser, lane(i), score(i), rating(i) 0–10 }
  // ro: the roles to use (a game rebuilt for one minute keeps the roles of the whole game)
  function placements(g, ro) {
    const rows = RULES && RULES.quant ? features(g, ro) : null;
    const score = rows ? scoreRows(rows) : fallback(g);
    const lanes = rows ? rows.map(x => x.lane_) : g.players.map(() => null);
    const order = g.players.map((p, i) => i).sort((a, b) => score[b] - score[a]);
    const place = new Map(order.map((i, n) => [i, n + 1]));
    const best = win => order.find(i => !!g.players[i].win === win);
    const rating = i => clamp10(rows ? RATE.mid + RATE.per * score[i] : 10 * score[i]);
    return { place: i => place.get(i), mvp: best(true), ace: best(false), lane: i => lanes[i], score: i => score[i], rating };
  }

  // the game as if it had ended at minute m: kills, deaths and assists from its kills, gold and CS
  // from the timeline, everything else (damage, vision, damage taken …) that share of the end figures
  function atMinute(g, m) {
    const sec = m * 60, frac = Math.min(1, sec / Math.max(60, g.dur || 0));
    const kills = (g.kills || []).filter(k => k[0] <= sec);
    const players = g.players.map((p, i) => {
      const x = {};
      for (const [k, v] of Object.entries(p.x || {})) x[k] = typeof v === 'number' ? v * frac : v;
      const gold = g.gold && g.gold[m] && g.gold[m][i], cs = g.csm && g.csm[m] && g.csm[m][i];
      return { ...p, x,
        k: kills.filter(k => k[1] === i).length, d: kills.filter(k => k[2] === i).length, a: kills.filter(k => (k[3] || []).includes(i)).length,
        gold: gold != null ? gold : (p.gold || 0) * frac, cs: cs != null ? cs : (p.cs || 0) * frac,
        dmg: (p.dmg || 0) * frac, vis: (p.vis || 0) * frac };
    });
    return { ...g, dur: Math.min(sec, g.dur || sec), players };
  }
  // the score minute by minute – per player an array of 0–10 values, minute 1 … the end (the last
  // one is the game's own score); the first minutes are pulled towards 5 (a kill or two say little
  // yet). null without a timeline (gold per minute and the kills).
  function timeline(g) {
    const n = g && Array.isArray(g.gold) ? g.gold.length : 0;
    if (n < 4 || !Array.isArray(g.kills) || !g.players) return null;
    const ro0 = St.roles(g);
    const out = g.players.map(() => []);
    for (let m = 1; m < n - 1; m++) {
      const snap = atMinute(g, m);
      const ro = ro0 && new Map(snap.players.map((p, i) => [p, ro0.get(g.players[i])]));
      const pl = placements(snap, ro);
      const c = Math.min(1, (m + 1) / 9);
      for (let i = 0; i < g.players.length; i++) out[i].push(+(5 + (pl.rating(i) - 5) * c).toFixed(1));
    }
    const fin = placements(g);
    for (let i = 0; i < g.players.length; i++) out[i].push(+fin.rating(i).toFixed(1));
    return out;
  }

  const api = { FEAT, WEIGHTS, NOT_FOR, WIN_BONUS, RATE, lane, features, groupOf, raw, probit, cdf, scoreRows, placements, atMinute, timeline };
  if (node) module.exports = api;
  else root.Mvp = api;
})(typeof window !== 'undefined' ? window : this);
