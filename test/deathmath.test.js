// Overview → Deaths (deathmath.js): where you die, seen from the blue side, by game phase.
const test = require('node:test');
const assert = require('node:assert/strict');
const DM = require('../ui/deathmath.js');

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
