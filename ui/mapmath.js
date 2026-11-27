// Overview → Map: where you die and where you kill, by minute. Every death and kill with a place
// (game format 6: "kills" [second, killer, victim, [assists], x, y], in hundreds of units) – on
// Summoner's Rift or on ARAM's map (one lane from base to base; Arena has many small maps and none
// here). Seen from the blue side: a red-side game is mirrored across the map's other diagonal, so
// your base is always bottom left and top lane stays top lane. No DOM; shared by the window and tests.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const St = node ? require('./stats.js') : root.Stats;

  const SIZE = 148;
  // ARAM's map: about 12,800 units square, the lane on the diagonal from base to base
  const ARAM_SIZE = 128;
  // game phases by minute: [id, from, to)
  const PHASES = [['early', 0, 10], ['mid', 10, 20], ['late', 20, Infinity]];
  // the zones a death or kill is counted in (stats.js zone(), turned into "own" / "enemy" and the river halves)
  // ARAM: the own base, the own towers, the middle, the enemy towers, the enemy base – along the lane
  const ZONES = ['top', 'mid', 'bot', 'riverTop', 'riverBot', 'jungleOwn', 'jungleEnemy', 'baseOwn', 'aOwn', 'aMid', 'aEnemy', 'baseEnemy'];
  // where on the way from the own base (0) to the enemy's (1) the ARAM zones end (the towers and
  // inhibitors of Howling Abyss; the stored deaths cluster between 0.4 and 0.6)
  const ARAM_CUTS = [[0.24, 'baseOwn'], [0.42, 'aOwn'], [0.58, 'aMid'], [0.76, 'aEnemy'], [Infinity, 'baseEnemy']];

  // the map of a game: 'sr' (Summoner's Rift), 'aram' or '' (Arena and the like: no map)
  const mapOf = g => (!St.offRift(g) ? 'sr' : St.ARAM_QUEUES.includes(Number(g.q)) ? 'aram' : '');
  // red side → blue side: across the diagonal from top left to bottom right
  const toBlue = (x, y, team, map = 'sr') => { const S = map === 'aram' ? ARAM_SIZE : SIZE; return team === 200 ? [S - y, S - x] : [x, y]; };
  function zoneOf(x, y, map = 'sr') {
    if (map === 'aram') { const p = (x + y) / 2 / ARAM_SIZE; return ARAM_CUTS.find(([to]) => p < to)[1]; }
    const z = St.zone(x, y);
    if (z === 'base') return x + y < SIZE ? 'baseOwn' : 'baseEnemy';
    if (z === 'river') return y > x ? 'riverTop' : 'riverBot';
    if (z === 'jungle100') return 'jungleOwn';
    if (z === 'jungle200') return 'jungleEnemy';
    return z;
  }
  const phaseOf = s => (PHASES.find(([, a, b]) => s / 60 >= a && s / 60 < b) || PHASES[2])[0];

  // every death and kill of the participations [{ g, p }] that has a place →
  // [{ kind: 'death'|'kill', x, y, s, zone, phase, enemies (death: killer + assists), solo (kill:
  //    no helper), champ, gameId }]
  // map: the games of which map ('sr' or 'aram')
  function events(parts, map = 'sr') {
    const out = [];
    for (const { g, p } of parts) {
      if (!Array.isArray(g.kills) || St.isRemake(g) || mapOf(g) !== map) continue;
      const i = g.players.indexOf(p);
      if (i < 0) continue;
      for (const k of g.kills) {
        if (k.length < 6 || (k[2] !== i && k[1] !== i)) continue;
        const [x, y] = toBlue(k[4], k[5], p.team, map);
        const base = { x, y, s: k[0], zone: zoneOf(x, y, map), phase: phaseOf(k[0]), champ: p.champ, gameId: String(g.id) };
        if (k[2] === i) out.push({ ...base, kind: 'death', enemies: (k[1] >= 0 ? 1 : 0) + (k[3] || []).length });
        else out.push({ ...base, kind: 'kill', solo: !(k[3] || []).length });
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
    const sr = games(parts, 'sr').length, aram = games(parts, 'aram').length;
    return sr || aram ? (sr >= aram ? 'sr' : 'aram') : '';
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
    const rows = Array.from({ length: last + 1 }, (_, m) => ({ m, deaths: 0, kills: 0 }));
    for (const e of list) {
      const r = rows[Math.min(last, Math.floor(e.s / 60))];
      if (e.kind === 'death') r.deaths++; else r.kills++;
    }
    return rows;
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

  const api = { SIZE, ARAM_SIZE, PHASES, ZONES, mapOf, toBlue, zoneOf, phaseOf, events, deaths, games, mainMap, inWindow, sum, summary, hotspot, perMinute, zonesBoth };
  if (node) module.exports = api;
  else root.MapMath = api;
})(typeof window !== 'undefined' ? window : this);
