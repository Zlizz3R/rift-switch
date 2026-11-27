// Live, more (docs/plans Phase 5b): premades, "do I know them?", the own record against the lane
// opponent's champion, the damage mix of a team and what changed in the own tags with a game.
// Pure functions on stored games (format of matches.rs); no DOM; shared by the window and the tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;
  const DAY = 86400000;

  // ---------- who played with whom ----------
  // games: every known game (any list); ids: the players of the current game; current: its id (left out)
  // → Map "a|b" (sorted) → { same: [games], against: [games] }, newest first
  function together(games, ids, current) {
    const want = new Set(ids);
    const out = new Map();
    const seen = new Set();
    for (const g of [...games].sort((a, b) => b.t - a.t)) {
      const id = String(g.id);
      if (id === String(current) || seen.has(id) || St.isRemake(g)) continue;
      seen.add(id);
      const here = g.players.filter(p => want.has(p.puuid));
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          const [a, b] = [here[i], here[j]].sort((x, y) => (x.puuid < y.puuid ? -1 : 1));
          const k = a.puuid + '|' + b.puuid;
          if (!out.has(k)) out.set(k, { same: [], against: [] });
          out.get(k)[a.team === b.team ? 'same' : 'against'].push(g);
        }
      }
    }
    return out;
  }
  // Parties of one team: players with at least 2 earlier games in the same team (with the current
  // one that makes 3). Linked pairs join into one party. → [[puuid, …], …] (at most 2 per team matter)
  function parties(pairs, team) {
    const link = new Map(team.map(p => [p, p]));
    const find = p => (link.get(p) === p ? p : find(link.get(p)));
    for (const [k, v] of pairs) {
      const [a, b] = k.split('|');
      if (link.has(a) && link.has(b) && v.same.length >= 2) link.set(find(a), find(b));
    }
    const groups = new Map();
    for (const p of team) { const r = find(p); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
    return [...groups.values()].filter(g => g.length > 1);
  }
  // exactly one earlier game together (same team or as enemies): a hint, not a premade
  function onceMet(pairs) {
    const out = [];
    for (const [k, v] of pairs) {
      const n = v.same.length + v.against.length;
      if (n === 1 && v.same.length < 2) {
        const [a, b] = k.split('|');
        out.push({ a, b, g: v.same[0] || v.against[0], same: v.same.length === 1 });
      }
    }
    return out;
  }

  // ---------- do I know them? ----------
  // ownGames: the own stored games; own: own puuids; puuid: the other player
  // → { last: { g, me, them, same, win }, n, same: { n, w }, against: { n, w }, list } or null
  function meetings(ownGames, own, puuid, current) {
    const mine = new Set(own);
    const list = [];
    for (const g of ownGames) {
      if (String(g.id) === String(current) || St.isRemake(g)) continue;
      const them = g.players.find(p => p.puuid === puuid);
      if (!them) continue;
      const me = g.players.find(p => mine.has(p.puuid) && p.puuid !== puuid);
      if (!me) continue;
      list.push({ g, me, them, same: me.team === them.team, win: !!me.win });
    }
    if (!list.length) return null;
    list.sort((a, b) => b.g.t - a.g.t);
    const sum = f => { const l = list.filter(f); return { n: l.length, w: l.filter(x => x.win).length }; };
    return { last: list[0], n: list.length, same: sum(x => x.same), against: sum(x => !x.same), list };
  }
  // "today" / "yesterday" / days ago of a time, by local midnight
  function daysAgo(t, now = Date.now()) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    if (t >= d0.getTime()) return 0;
    return Math.ceil((d0.getTime() - t) / DAY);
  }

  // ---------- damage mix of a team ----------
  // champs: [{ puuid, champ }]; games: every known game; types: { champ: 'kPhysical'|'kMagic'|'kMixed' }
  // → { ad, ap, tru (0..1), per: [{ champ, src: 'player'|'champ'|'type'|null }] }
  const MIN = 3;
  function damageOf(games, filter) {
    let ad = 0, ap = 0, tr = 0, n = 0;
    for (const g of games) for (const p of g.players) {
      if (!filter(p) || !p.x) continue;
      const a = p.x.phys || 0, m = p.x.magic || 0, t = p.x.true || 0;
      if (a + m + t <= 0) continue;
      const s = a + m + t;
      ad += a / s; ap += m / s; tr += t / s; n++;
    }
    return n ? { ad: ad / n, ap: ap / n, tru: tr / n, n } : null;
  }
  function damageMix(champs, games, types = {}) {
    let ad = 0, ap = 0, tr = 0, k = 0;
    const per = [];
    for (const c of champs) {
      if (!c.champ) continue;
      let d = damageOf(games, p => p.puuid === c.puuid && p.champ === c.champ), src = 'player';
      if (!d || d.n < MIN) { d = damageOf(games, p => p.champ === c.champ); src = 'champ'; }
      if (!d || d.n < MIN) {
        const ty = types[c.champ];
        d = ty === 'kPhysical' ? { ad: 1, ap: 0, tru: 0 } : ty === 'kMagic' ? { ad: 0, ap: 1, tru: 0 } : ty === 'kMixed' ? { ad: 0.5, ap: 0.5, tru: 0 } : null;
        src = d ? 'type' : null;
      }
      per.push({ champ: c.champ, src });
      if (!d) continue;
      ad += d.ad; ap += d.ap; tr += d.tru; k++;
    }
    if (!k) return null;
    return { ad: ad / k, ap: ap / k, tru: tr / k, known: k, per };
  }

  // ---------- what changed in the tags with a game ----------
  // before / after: results of Tags.evaluate; → [{ id, champ, dir: 1 | -1, kind, from, to, x }]
  const LEVEL = { terrible: -2, weak: -1, great: 1, master: 2 };
  function tagDiff(before, after, dirOf = () => 1) {
    const key = x => x.id + ':' + (x.champ || '');
    const b = new Map(before.filter(x => x.state !== 'few').map(x => [key(x), x]));
    const a = new Map(after.filter(x => x.state !== 'few').map(x => [key(x), x]));
    const out = [];
    for (const [k, x] of a) {
      const y = b.get(k);
      const metNow = x.state === 'met', metThen = y && y.state === 'met';
      if (metNow && !metThen) out.push({ ...x, kind: 'new', dir: x.color === 'bad' || LEVEL[x.level] < 0 ? -1 : 1, x });
      else if (!metNow && metThen) out.push({ ...y, kind: 'gone', dir: y.color === 'bad' || LEVEL[y.level] < 0 ? 1 : -1, from: y.value, to: x.value, x: y });
      else if (metNow && metThen && x.level !== y.level) out.push({ ...x, kind: 'level', dir: (LEVEL[x.level] || 0) > (LEVEL[y.level] || 0) ? 1 : -1, from: y.value, to: x.value, x });
      else if (metNow && metThen && x.value != null && y.value != null && x.value !== y.value && typeof x.value === 'number') {
        out.push({ ...x, kind: 'value', dir: Math.sign((x.value - y.value) * dirOf(x)), from: y.value, to: x.value, x });
      }
    }
    for (const [k, y] of b) if (y.state === 'met' && !a.has(k)) out.push({ ...y, kind: 'gone', dir: y.color === 'bad' ? 1 : -1, from: y.value, x: y });
    // state changes first, then the biggest value moves
    const rank = { new: 0, gone: 0, level: 1, value: 2 };
    return out.filter(x => x.dir).sort((p, q) => rank[p.kind] - rank[q.kind] || Math.abs((q.to - q.from) / (q.from || 1)) - Math.abs((p.to - p.from) / (p.from || 1)));
  }

  // ---------- whose lane is it? ----------
  // games: every known game → Map champion → Map role → games on it (Summoner's Rift, positions known)
  function roleCounts(games) {
    const out = new Map();
    const seen = new Set();
    for (const g of games) {
      const id = String(g.id);
      if (seen.has(id) || St.isRemake(g)) continue;
      seen.add(id);
      for (const p of g.players || []) {
        const r = St.role(g, p);
        if (!r || !p.champ) continue;
        if (!out.has(p.champ)) out.set(p.champ, new Map());
        const m = out.get(p.champ);
        m.set(r, (m.get(r) || 0) + 1);
      }
    }
    return out;
  }
  // The enemies' positions (Riot hides them in ranked): every champion on its own lane, the
  // arrangement that fits best how often each champion is played on each lane (all 120 tried).
  // champs: up to 5 champion ids; counts: roleCounts(); known: { champ: role } already sure
  // → [{ champ, role, share (0..1 of his known games on that role, null without any), n }]
  function guessLanes(champs, counts, known = {}) {
    const R = St.POSITIONS;
    const list = champs.filter(Boolean).slice(0, 5);
    const prob = (c, r) => {
      if (known[c]) return known[c] === r ? 1 : 1e-6;
      const m = counts.get(c);
      const n = m ? [...m.values()].reduce((s, x) => s + x, 0) : 0;
      return ((m && m.get(r)) || 0) + 0.2 / (n + 1) / R.length + 1e-9 / (n + 1);
    };
    const lp = list.map(c => R.map(r => Math.log(prob(c, r))));
    let best = null, bestS = -Infinity;
    const walk = (i, used, perm, s) => {
      if (i === list.length) { if (s > bestS) { bestS = s; best = perm.slice(); } return; }
      for (let r = 0; r < R.length; r++) if (!(used & (1 << r))) { perm.push(r); walk(i + 1, used | (1 << r), perm, s + lp[i][r]); perm.pop(); }
    };
    walk(0, 0, [], 0);
    return list.map((c, i) => {
      const role = R[best[i]], m = counts.get(c);
      const n = m ? [...m.values()].reduce((s, x) => s + x, 0) : 0;
      return { champ: c, role, n, share: known[c] ? 1 : n ? ((m.get(role) || 0) / n) : null, sure: !!known[c] };
    });
  }

  const api = { together, parties, onceMet, meetings, daysAgo, damageMix, tagDiff, roleCounts, guessLanes };
  if (node) module.exports = api;
  else root.Insights = api;
})(typeof window !== 'undefined' ? window : this);
