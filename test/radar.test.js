// Play style against the lane opponent (ui/radar.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Rd = require('../ui/radar');
const St = require('../ui/stats');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
let gid = 1;
function game(me = {}, opp = {}, o = {}) {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: `p${gid}-${i}`, team: i < 5 ? 100 : 200, champ: 1 + i, pos: POS[i % 5], win: i < 5,
    k: 2, d: 4, a: 4, cs: i % 5 === 4 ? 30 : 210, dmg: 18000, vis: 30, spells: i % 5 === 1 ? [11, 4] : [4, 14], items: i % 5 === 4 ? [3877] : [], x: { turretDmg: 3000 } }));
  players[2] = { ...players[2], puuid: 'me', ...me };
  players[7] = { ...players[7], ...opp };
  return { id: String(gid++), t: gid, dur: 1800, q: 420, mode: 'CLASSIC', owners: ['me'], players, ...o };
}
const rows = games => St.byParticipation(games).filter(x => x.p.puuid === 'me');

test('radar: own value ÷ lane opponent, averaged; deaths the other way round; too few games = no value', () => {
  const games = Array.from({ length: 10 }, () => game({ cs: 240, d: 2 }, { cs: 200, d: 4 }));
  const r = Object.fromEntries(Rd.radar(rows(games)).map(a => [a.id, a]));
  assert.ok(Math.abs(r.farm.ratio - 1.2) < 1e-9);
  assert.equal(r.surv.ratio, 2);                      // half the deaths = 200 %
  assert.equal(r.farm.n, 10);
  assert.ok(Math.abs(r.farm.mine - 8) < 1e-9 && Math.abs(r.farm.theirs - 200 / 30) < 1e-9);
  assert.equal(r.lane.ratio, null);                   // no gold per minute stored
  assert.equal(r.lane.n, 0);
  // 9 games: no value, not 0
  assert.equal(Rd.radar(rows(games.slice(0, 9)))[0].ratio, null);
  // ARAM (no lanes) doesn't count
  const aram = Array.from({ length: 12 }, () => game({}, {}, { mode: 'ARAM', q: 450 }));
  assert.equal(Rd.radar(rows(aram))[0].n, 0);
});
