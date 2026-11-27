// Key figures in one place (ui/stats.js) – and the match history summary built on it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const St = require('../ui/stats');
const MF = require('../ui/matchfilter');
const GAMES = require('./fixtures/stat-games');

const p = (o) => ({ puuid: 'me', team: 100, k: 0, d: 0, a: 0, cs: 0, dmg: 0, vis: 0, win: true, ...o });
const g = (players, o = {}) => ({ id: o.id || '1', t: 1, dur: 1800, q: 420, owners: o.owners || ['me'], players, ...o });

test('the summary gives the same numbers as before stats.js (snapshot)', () => {
  const s = MF.summarize(GAMES, 1000);
  const strip = (x) => x && { id: x.g.id };
  const now = { ...s, records: Object.fromEntries(Object.entries(s.records).map(([k, v]) => [k, strip(v)])) };
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'summary-before.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(now)), before);
});

test('no games: nothing, not zeros', () => {
  assert.equal(St.aggregate([]), null);
  assert.equal(St.aggregate(St.byGame([])), null);
  assert.equal(MF.summarize([]), null);
  assert.equal(St.winPct(0, 0), null);
});

test('KDA = (K + A) / max(1, D); 0 deaths is "perfect", not infinite', () => {
  assert.equal(St.kda(4, 2, 6), 5);
  assert.equal(St.kda(4, 0, 6), 10);
  const one = St.perGame(g([p({ k: 4, d: 0, a: 6 }), p({ puuid: 'x', k: 1 })]), p({ k: 4, d: 0, a: 6 }));
  assert.equal(one.perfect, true);
  assert.equal(one.kda, 10);
  // over several games: the sums
  const ag = St.aggregate(St.byGame([g([p({ k: 2, d: 1, a: 2 })], { id: 'a' }), g([p({ k: 4, d: 3, a: 0 })], { id: 'b' })]));
  assert.equal(ag.kda, 2);
  assert.deepEqual(ag.avg, { k: 3, d: 2, a: 1 });
});

test('missing team kills: KP is unknown (null), never 0 %, and left out of the average', () => {
  const noKills = g([p({ k: 0, a: 0 }), p({ puuid: 'x', k: 0 })], { id: 'a' });
  assert.equal(St.kp(noKills, noKills.players[0]), null);
  const withKills = g([p({ k: 2, a: 1 }), p({ puuid: 'x', k: 4 })], { id: 'b' });
  assert.equal(St.kp(withKills, withKills.players[0]), 0.5);
  const ag = St.aggregate(St.byGame([noKills, withKills]));
  assert.equal(ag.kp, 0.5);
  assert.equal(ag.kpN, 1);
  // vision missing in a game: averaged over the games that have it
  const noVis = g([p({ vis: undefined })], { id: 'c' });
  assert.equal(St.visMin(noVis, noVis.players[0]), null);
});

test('remakes count nowhere', () => {
  const remake = g([p({ k: 9 })], { id: 'r', dur: 200 });
  const flagged = g([p({ k: 9 })], { id: 'f', remake: true });
  const real = g([p({ k: 1, d: 1 })], { id: 'ok' });
  assert.equal(St.isRemake(remake), true);
  assert.equal(St.byGame([remake, flagged, real]).length, 1);
  assert.equal(St.aggregate(St.byGame([remake, real])).k, 1);
});

test('one game, two own accounts: once as a game, twice as performance', () => {
  const both = g([p({ puuid: 'o1', k: 2, d: 1 }), p({ puuid: 'o2', k: 6, d: 1 }), p({ puuid: 'x', team: 200, win: false })], { id: 'duo', owners: ['o1', 'o2'] });
  const solo = g([p({ puuid: 'o1', k: 4, d: 2 })], { id: 'solo', owners: ['o1'] });
  const games = St.byGame([both, solo]);
  assert.equal(games.length, 2);                      // each game once (its first own account)
  const parts = St.byParticipation([both, solo]);
  assert.equal(parts.length, 3);                      // every own account's part
  const ag = St.aggregate(parts);
  assert.equal(ag.n, 3);
  assert.equal(ag.games, 2);                          // still two games
  assert.equal(ag.k, 12);
  // grouped per account
  const by = St.groupBy(parts, (x) => x.p.puuid);
  assert.equal(by.get('o1').n, 2);
  assert.equal(by.get('o2').k, 6);
});

test('damage share and per-minute figures', () => {
  const x = g([p({ dmg: 3000, cs: 240, vis: 30 }), p({ puuid: 'y', dmg: 1000 }), p({ puuid: 'e', team: 200, dmg: 9000 })], { dur: 1800 });
  const s = St.perGame(x, x.players[0]);
  assert.equal(s.dmgShare, 0.75);
  assert.equal(s.csMin, 8);
  assert.equal(s.dmgMin, 100);
  assert.equal(s.visMin, 1);
});

test('a lite game (one player from a match list): no team figures, Riot\'s position, no lane opponent', () => {
  const p = { puuid: 'a', team: 100, k: 4, d: 2, a: 6, cs: 180, dmg: 15000, pos: 'mid', spells: [4, 14], win: true };
  const g = { id: '1', dur: 1800, q: 420, mode: 'CLASSIC', lite: true, players: [p] };
  const Stats = St;
  const x = Stats.perGame(g, p);
  assert.equal(x.kp, null);
  assert.equal(x.dmgShare, null);
  assert.equal(Stats.role(g, p), 'mid');
  assert.equal(Stats.role(g, { ...p, spells: [11, 4] }), 'jungle');
  assert.equal(Stats.laneOpponent(g, p), null);
});

test('the window\'s store: a game packed small reads the same (places per minute, kills, Riot IDs)', () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: 'p' + i, name: 'Name', tag: 'EUW', team: i < 5 ? 100 : 200, k: 1, d: 1, a: 1 }));
  const g = { id: 'x', dur: 600, players, at: Array.from({ length: 11 }, (_, m) => players.map((_, i) => (i === 3 && m === 4 ? null : [m * 10 + i, 140 - m]))),
    kills: [[90, 0, 5, [], 70, 70], [130, 1, 6, [2, 3], 30, 20]] };
  const plain = JSON.parse(JSON.stringify(g));
  const p = St.packGame(g);
  assert.ok(!Array.isArray(p.at), 'the places are one typed array');
  for (let m = 0; m < 11; m++) for (let i = 0; i < 10; i++) assert.deepEqual(St.posAt(p, m, i), St.posAt(plain, m, i));
  assert.equal(St.posAt(p, 4, 3), null);
  assert.equal(St.posAt(p, 11, 0), null, 'past the end');
  assert.deepEqual(St.placeAt(p, 2, 150), St.placeAt(plain, 2, 150));
  assert.deepEqual(p.kills[0][3], []);
  assert.deepEqual(p.kills[1][3], [2, 3]);
  assert.equal(St.packGame(p), p, 'once is enough');
  assert.equal(St.packGame({ id: 'y', players: [] }).id, 'y', 'a game without places');
});
