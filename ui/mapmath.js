// Overview → Map: where you die, kill and help, by minute. Every death, kill and assist with a place
// (game format 6: "kills" [second, killer, victim, [assists], x, y], in hundreds of units) – on
// Summoner's Rift, on ARAM's map (one lane from base to base) or on Arena's (seven small arenas on
// one big map, ARENAS). Seen from the blue side: a red-side game on the Rift or ARAM is mirrored
// across the map's other diagonal, so your base is always bottom left and top lane stays top lane
// (Arena has no sides). No DOM; shared by the window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;

  const SIZE = 148;
  // ARAM's map: about 12,800 units square, the lane on the diagonal from base to base
  const ARAM_SIZE = 128;
  // Arena's map: about 24,000 units square with seven arenas on it – [x0, x1, y0, y1] each, from
  // 5,690 kills of 44 stored Arena games (27.11.2026: each arena about 14 % of them, a few in between)
  const ARENA_SIZE = 240;
  const ARENAS = [[20, 60, 24, 60], [28, 60, 128, 156], [36, 68, 184, 220], [108, 144, 188, 224], [132, 168, 124, 156], [196, 228, 160, 188], [176, 212, 60, 96]];
  // game phases by minute: [id, from, to)
  const PHASES = [['early', 0, 10], ['mid', 10, 20], ['late', 20, Infinity]];
  // the zones a death or kill is counted in (stats.js zone(), turned into "own" / "enemy" and the river halves)
  // ARAM: the own base, the own towers, the middle, the enemy towers, the enemy base – along the lane
  const ZONES = ['top', 'mid', 'bot', 'riverTop', 'riverBot', 'jungleOwn', 'jungleEnemy', 'baseOwn', 'aOwn', 'aMid', 'aEnemy', 'baseEnemy',
    ...ARENAS.map((_, i) => 'ar' + (i + 1)), 'arOther'];
  // the kinds of events, in the order the map shows them
  const KINDS = ['kill', 'death', 'assist'];
  // where on the way from the own base (0) to the enemy's (1) the ARAM zones end (the towers and
  // inhibitors of Howling Abyss; the stored deaths cluster between 0.4 and 0.6)
  const ARAM_CUTS = [[0.24, 'baseOwn'], [0.42, 'aOwn'], [0.58, 'aMid'], [0.76, 'aEnemy'], [Infinity, 'baseEnemy']];

  // the map of a game: 'sr' (Summoner's Rift), 'aram', 'arena' or '' (Swarm and the like: no map)
  const mapOf = g => (St.isArena(g) ? 'arena' : !St.offRift(g) ? 'sr' : St.ARAM_QUEUES.includes(Number(g.q)) || g.mode === 'ARAM' ? 'aram' : '');
  const sizeOf = map => (map === 'aram' ? ARAM_SIZE : map === 'arena' ? ARENA_SIZE : SIZE);
  // red side → blue side: across the diagonal from top left to bottom right (Arena: as it is)
  const toBlue = (x, y, team, map = 'sr') => { const S = sizeOf(map); return team === 200 && map !== 'arena' ? [S - y, S - x] : [x, y]; };
  function zoneOf(x, y, map = 'sr') {
    if (map === 'arena') { const i = ARENAS.findIndex(([x0, x1, y0, y1]) => x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 4 && y <= y1 + 4); return i < 0 ? 'arOther' : 'ar' + (i + 1); }
    if (map === 'aram') { const p = (x + y) / 2 / ARAM_SIZE; return ARAM_CUTS.find(([to]) => p < to)[1]; }
    const z = St.zone(x, y);
    if (z === 'base') return x + y < SIZE ? 'baseOwn' : 'baseEnemy';
    if (z === 'river') return y > x ? 'riverTop' : 'riverBot';
    if (z === 'jungle100') return 'jungleOwn';
    if (z === 'jungle200') return 'jungleEnemy';
    return z;
  }
  // Arena: where in its own arena an event lies – u across, v up, each 0–1 over the arena's box –
  // and which arena it is (n 1–7); null between the arenas. "All arenas" lays the seven on each other.
  function arenaSpot(e) {
    const m = /^ar(\d)$/.exec((e && e.zone) || '');
    if (!m) return null;
    const [x0, x1, y0, y1] = ARENAS[m[1] - 1];
    const c = v => Math.max(0, Math.min(1, v));
    return { n: +m[1], u: c((e.x - x0) / (x1 - x0)), v: c((e.y - y0) / (y1 - y0)) };
  }
  const phaseOf = s => (PHASES.find(([, a, b]) => s / 60 >= a && s / 60 < b) || PHASES[2])[0];

  // every death, kill and assist of the participations [{ g, p }] that has a place →
  // [{ kind: 'death'|'kill'|'assist', x, y, s, zone, phase, enemies (death: killer + assists), solo
  //    (kill: no helper), champ, gameId }]
  // map: the games of which map ('sr', 'aram' or 'arena')
  function events(parts, map = 'sr') {
    const out = [];
    for (const { g, p } of parts) {
      if (!Array.isArray(g.kills) || St.isRemake(g) || mapOf(g) !== map) continue;
      const i = g.players.indexOf(p);
      if (i < 0) continue;
      for (const k of g.kills) {
        const helpers = k[3] || [];
        if (k.length < 6 || (k[2] !== i && k[1] !== i && !helpers.includes(i))) continue;
        const [x, y] = toBlue(k[4], k[5], p.team, map);
        const base = { x, y, s: k[0], zone: zoneOf(x, y, map), phase: phaseOf(k[0]), champ: p.champ, gameId: String(g.id) };
        if (k[2] === i) out.push({ ...base, kind: 'death', enemies: (k[1] >= 0 ? 1 : 0) + helpers.length });
        else if (k[1] === i) out.push({ ...base, kind: 'kill', solo: !helpers.length });
        else out.push({ ...base, kind: 'assist' });
      }
    }
    return out;
  }
  // only deaths (as before)
  const deaths = parts => events(parts).filter(e => e.kind === 'death');
  // games that count: with a timeline (places), not remakes
  const games = (parts, map = 'sr') => parts.filter(({ g }) => Array.isArray(g.kills) && !St.isRemake(g) && mapOf(g) === map && g.kills.some(k => k.length >= 6));
  // the map most of these games with places were played on (Summoner's Rift when tied), '' none
  function mainMap(parts) {
    const n = ['sr', 'aram', 'arena'].map(m => [m, games(parts, m).length]).filter(([, c]) => c);
    return n.length ? n.sort((a, b) => b[1] - a[1])[0][0] : '';
  }

  // in a time window: minutes [from, to) – to null = to the end
  const inWindow = (e, from, to) => e.s >= from * 60 && (to == null || e.s < to * 60);

  // a list of one kind: count, per game, the zones by share (most first), and for deaths how many
  // were against 2+ enemies, for kills how many were solo
  function sum(list, nGames) {
    const by = new Map();
    for (const d of list) by.set(d.zone, (by.get(d.zone) || 0) + 1);
    const zones = [...by].map(([zone, c]) => ({ zone, n: c, share: c / list.length })).sort((a, b) => b.n - a.n || ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone));
    const part = f => (list.length ? list.filter(f).length / list.length : null);
    return { n: list.length, perGame: nGames ? list.length / nGames : null, zones, outnumbered: part(d => d.enemies >= 2), solo: part(d => d.solo) };
  }
  // per phase (and 'all') for deaths – the old summary, kept for the deaths alone
  function summary(parts) {
    const list = deaths(parts);
    const n = games(parts).length;
    const out = { games: n, all: sum(list, n) };
    for (const [id] of PHASES) out[id] = sum(list.filter(d => d.phase === id), n);
    return out;
  }
  // the headline of a list: its top zone, if it stands out (≥ 5 and ≥ 30 %)
  function hotspot(ph) {
    const z = ph && ph.zones[0];
    return z && ph.n >= 5 && z.share >= 0.3 ? z : null;
  }
  // per minute (0 … last): [{ m, deaths, kills }] – the time chart under the map
  function perMinute(list, cap = 60) {
    const last = Math.min(cap - 1, list.reduce((a, e) => Math.max(a, Math.floor(e.s / 60)), 0));
    const rows = Array.from({ length: last + 1 }, (_, m) => ({ m, deaths: 0, kills: 0, assists: 0 }));
    for (const e of list) {
      const r = rows[Math.min(last, Math.floor(e.s / 60))];
      if (e.kind === 'death') r.deaths++; else if (e.kind === 'kill') r.kills++; else r.assists++;
    }
    return rows;
  }
  // the chosen kinds side by side per zone: [{ zone, n: { kill, death, assist }, share: { … } }],
  // most events first
  function zonesBy(list, kinds = KINDS) {
    const of = Object.fromEntries(kinds.map(k => [k, list.filter(e => e.kind === k)]));
    const rows = ZONES.map(zone => {
      const n = {}, share = {};
      for (const k of kinds) { n[k] = of[k].filter(e => e.zone === zone).length; share[k] = of[k].length ? n[k] / of[k].length : 0; }
      return { zone, n, share, all: kinds.reduce((s, k) => s + n[k], 0) };
    }).filter(r => r.all);
    return rows.sort((a, b) => b.all - a.all);
  }
  // both kinds side by side per zone: [{ zone, deaths, kills, dShare, kShare }] by total
  function zonesBoth(list) {
    const d = list.filter(e => e.kind === 'death'), k = list.filter(e => e.kind === 'kill');
    const rows = ZONES.map(zone => {
      const dn = d.filter(e => e.zone === zone).length, kn = k.filter(e => e.zone === zone).length;
      return { zone, deaths: dn, kills: kn, dShare: d.length ? dn / d.length : 0, kShare: k.length ? kn / k.length : 0 };
    }).filter(r => r.deaths + r.kills);
    return rows.sort((a, b) => b.deaths + b.kills - (a.deaths + a.kills));
  }

  const api = { SIZE, ARAM_SIZE, ARENA_SIZE, ARENAS, PHASES, ZONES, KINDS, mapOf, sizeOf, toBlue, zoneOf, arenaSpot, phaseOf, events, deaths, games, mainMap, inWindow, sum, summary, hotspot, perMinute, zonesBoth, zonesBy };
  if (node) module.exports = api;
  else root.MapMath = api;
})(typeof window !== 'undefined' ? window : this);
