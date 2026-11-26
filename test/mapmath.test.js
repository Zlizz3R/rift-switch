// Overview → Map (mapmath.js): where you die, seen from the blue side, by game phase.
const test = require('node:test');
const assert = require('node:assert/strict');
const DM = require('../ui/mapmath.js');

// a game: me at index 0 (team 100) or 5 (team 200); deaths [second, x, y, assists]
let gid = 1;
function game(team, deaths, over = {}) {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: i === (team === 100 ? 0 : 5) ? 'me' : 'p' + i, team: i < 5 ? 100 : 200, champ: 1 + i }));
  const me = team === 100 ? 0 : 5, enemy = team === 100 ? 6 : 1;
  const kills = deaths.map(([s, x, y, as = []]) => [s, enemy, me, as, x, y]);
  // someone else's death and one without a place: not mine / not counted
  kills.push([100, me, enemy, [], 70, 70], [200, enemy, me, []]);
  return { id: String(gid++), t: 1, dur: 1800, q: 420, remake: false, players, kills, ...over };
}
const parts = games => games.map(g => ({ g, p: g.players.find(p => p.puuid === 'me') }));

test('deaths: zones from the blue side – a red-side game mirrored, top lane stays top lane', () => {
  assert.deepEqual(DM.toBlue(10, 100, 100), [10, 100]);
  // red: its base (133, 133) becomes bottom left, its top lane (10, 100) still top
  assert.deepEqual(DM.toBlue(133, 133, 200), [15, 15]);
  assert.equal(DM.zoneOf(...DM.toBlue(10, 100, 200)), 'top');
  assert.equal(DM.zoneOf(15, 15), 'baseOwn');
  assert.equal(DM.zoneOf(133, 133), 'baseEnemy');
  assert.equal(DM.zoneOf(50, 98), 'riverTop');
  assert.equal(DM.zoneOf(98, 50), 'riverBot');
  assert.equal(DM.zoneOf(40, 70), 'jungleOwn');
  assert.equal(DM.zoneOf(108, 78), 'jungleEnemy');
  // a red jungler dying in the red jungle died in his own jungle
  assert.equal(DM.zoneOf(...DM.toBlue(108, 78, 200)), 'jungleOwn');
});

test('deaths: by phase, the top zone named only when it stands out', () => {
  // 6 early deaths: 4 in the top river (one to 2 enemies), 2 top lane; 1 late in the enemy base
  const g1 = game(100, [[120, 50, 98, [2]], [200, 50, 98], [300, 52, 96], [400, 10, 100], [500, 10, 110], [1500, 130, 130]]);
  const g2 = game(200, [[150, 50, 98]]);   // red: the river is the mirror's axis – top river stays top river
  const s = DM.summary(parts([g1, g2]));
  assert.equal(s.games, 2);
  assert.equal(s.all.n, 7);
  assert.equal(s.all.perGame, 3.5);
  assert.equal(s.early.n, 6);
  assert.deepEqual(s.early.zones[0], { zone: 'riverTop', n: 4, share: 4 / 6 });
  assert.deepEqual(DM.hotspot(s.early), s.early.zones[0]);
  assert.equal(DM.hotspot(s.late), null, 'one death is not a hot spot');
  assert.equal(s.late.zones[0].zone, 'baseEnemy');
  assert.equal(s.early.outnumbered, 1 / 6);
  // other players' deaths and deaths without a place don't count
  assert.equal(DM.deaths(parts([g1])).length, 6);
  // remakes and games without a timeline don't count as games
  assert.equal(DM.summary(parts([game(100, [[60, 10, 100]], { remake: true }), { ...game(100, []), kills: undefined }])).all.n, 0);
});

test('map: kills next to deaths, a window of minutes, per minute and per zone', () => {
  // me (blue, index 0): two kills (one solo in the mid lane at 3:00, one with help in the enemy jungle at 12:30)
  // and one death in the top river at 5:00; red side games are mirrored the same way
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: i === 0 ? 'me' : 'p' + i, team: i < 5 ? 100 : 200, champ: 1 + i }));
  const g = { id: 'm1', t: 1, dur: 1800, q: 420, remake: false, players,
    kills: [[180, 0, 6, [], 74, 74], [750, 0, 7, [1, 2], 108, 78], [300, 6, 0, [7], 50, 98], [400, 1, 8, [], 30, 30]] };
  const ev = DM.events([{ g, p: players[0] }]);
  assert.deepEqual(ev.map(e => [e.kind, e.zone, e.s]), [['kill', 'mid', 180], ['kill', 'jungleEnemy', 750], ['death', 'riverTop', 300]]);
  assert.equal(ev[0].solo, true);
  assert.equal(ev[1].solo, false);
  assert.equal(ev[2].enemies, 2);
  // minutes 0–5: the solo kill only (the death at 5:00 is minute 5, outside [0, 5))
  assert.deepEqual(ev.filter(e => DM.inWindow(e, 0, 5)).map(e => e.s), [180]);
  assert.deepEqual(ev.filter(e => DM.inWindow(e, 5, null)).map(e => e.s), [750, 300]);
  // per minute up to the last event
  const pm = DM.perMinute(ev);
  assert.equal(pm.length, 13);
  assert.deepEqual([pm[3], pm[5], pm[12]], [{ m: 3, deaths: 0, kills: 1 }, { m: 5, deaths: 1, kills: 0 }, { m: 12, deaths: 0, kills: 1 }]);
  // both per zone: every zone with something, shares per kind
  const z = DM.zonesBoth(ev);
  assert.deepEqual(z.map(r => [r.zone, r.deaths, r.kills]).sort(), [['jungleEnemy', 0, 1], ['mid', 0, 1], ['riverTop', 1, 0]]);
  assert.equal(z.find(r => r.zone === 'mid').kShare, 0.5);
  const ks = DM.sum(ev.filter(e => e.kind === 'kill'), 1);
  assert.equal(ks.solo, 0.5);
});

test('map: only Summoner\'s Rift – ARAM\'s one lane (and Arena) would all count as mid lane', () => {
  const rift = game(100, [[300, 10, 100]]);
  const aram = game(100, [[300, 74, 74], [400, 70, 78]], { q: 450 });
  const arena = game(100, [[300, 74, 74]], { q: 1700 });
  const ev = DM.events(parts([rift, aram, arena]));
  assert.deepEqual(ev.filter(e => e.kind === 'death').map(e => e.zone), ['top']);
  assert.equal(DM.games(parts([rift, aram, arena])).length, 1);
});
