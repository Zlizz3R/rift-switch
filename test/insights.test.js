// Live, more (ui/insights.js): premades, meetings, the record against a champion, damage mix, tag changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../ui/insights');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
let nextId = 1;
// a game with named players on given slots (0–4 blue, 5–9 red)
function game(slots = {}, o = {}) {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: `x${nextId}-${i}`, team: i < 5 ? 100 : 200, champ: 100 + i, pos: POS[i % 5], win: i < 5,
    k: 1, d: 1, a: 1, cs: i % 5 === 4 ? 20 : 150, spells: i % 5 === 1 ? [11, 4] : [4, 14], items: i % 5 === 4 ? [3877] : [], x: { phys: 1000, magic: 0, true: 0 } }));
  for (const [i, p] of Object.entries(slots)) players[i] = { ...players[i], ...p };
  return { id: String(nextId++), t: o.t || Date.now() - nextId * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', players, ...o };
}

test('premades: 2 earlier games in the same team; 1 is a hint; linked pairs make one party', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const games = [
    game({ 0: { puuid: 'a' }, 1: { puuid: 'b' } }), game({ 0: { puuid: 'a' }, 3: { puuid: 'b' } }),   // a+b twice together
    game({ 1: { puuid: 'b' }, 2: { puuid: 'c' } }), game({ 0: { puuid: 'b' }, 4: { puuid: 'c' } }),   // b+c twice → a, b, c one party
    game({ 0: { puuid: 'd' }, 6: { puuid: 'e' } }),                                                    // d vs e once: a hint
  ];
  const pairs = I.together(games, ids, 'now');
  assert.deepEqual(I.parties(pairs, ids).map(p => p.sort()), [['a', 'b', 'c']]);
  const once = I.onceMet(pairs);
  assert.equal(once.length, 1);
  assert.deepEqual([once[0].a, once[0].b, once[0].same], ['d', 'e', false]);
  // the current game itself never counts
  const cur = game({ 0: { puuid: 'd' }, 1: { puuid: 'e' } });
  assert.equal(I.together([cur], ids, cur.id).size, 0);
});

test('do I know them: the last meeting, as team or enemy, with wins', () => {
  const g1 = game({ 0: { puuid: 'me', win: true }, 5: { puuid: 'z', champ: 85 } }, { t: Date.now() - 2 * 86400000 });
  const g2 = game({ 0: { puuid: 'me2', win: false }, 1: { puuid: 'z', champ: 103, win: false } }, { t: Date.now() - 3600000 });
  const m = I.meetings([g1, g2], ['me', 'me2'], 'z');
  assert.equal(m.n, 2);
  assert.equal(m.last.g, g2);
  assert.equal(m.last.same, true);
  assert.deepEqual(m.against, { n: 1, w: 1 });
  assert.equal(I.meetings([g1], ['me'], 'nobody'), null);
  assert.equal(I.daysAgo(Date.now()), 0);
});

test('damage mix: the player\'s own games, else the champion, else its damage type', () => {
  const magic = { x: { phys: 0, magic: 2000, true: 0 } };
  const games = [1, 2, 3].map(() => game({ 0: { puuid: 'p1', champ: 7, ...magic } }));
  const mix = I.damageMix([{ puuid: 'p1', champ: 7 }, { puuid: 'p2', champ: 101 }, { puuid: 'p3', champ: 555 }, { puuid: 'p4', champ: 556 }], games, { 555: 'kMagic' });
  assert.deepEqual(mix.per.map(x => x.src), ['player', 'champ', 'type', null]);
  assert.equal(mix.known, 3);
  assert.ok(Math.abs(mix.ap - 2 / 3) < 1e-9);
  assert.ok(Math.abs(mix.ad - 1 / 3) < 1e-9);
});

test('tag changes: new, gone, level up/down, value; "too little data" is no change', () => {
  const before = [{ id: 'farm', state: 'met', level: 'great', value: 8.1 }, { id: 'kda', state: 'met', level: 'great', value: 3.2 },
    { id: 'hotStreak', state: 'met', value: 3, color: 'good' }, { id: 'vision', state: 'few', n: 9, need: 10 }];
  const after = [{ id: 'farm', state: 'met', level: 'master', value: 9.6 }, { id: 'kda', state: 'met', level: 'great', value: 3.0 },
    { id: 'hotStreak', state: 'not', value: 0, color: 'good' }, { id: 'vision', state: 'met', level: 'great', value: 1.1 }];
  const d = I.tagDiff(before, after);
  const by = Object.fromEntries(d.map(x => [x.id, x]));
  assert.equal(by.vision.kind, 'new');
  assert.equal(by.vision.dir, 1);
  assert.equal(by.hotStreak.kind, 'gone');
  assert.equal(by.hotStreak.dir, -1);
  assert.equal(by.farm.kind, 'level');
  assert.equal(by.farm.dir, 1);
  assert.equal(by.kda.kind, 'value');
  assert.equal(by.kda.dir, -1);
  assert.deepEqual(I.tagDiff(before, before), []);
});

test('whose lane: counts per champion and role, every enemy on its own lane', () => {
  // champion 100 always top, 101 jungle (Smite), 102 mid, 103 bot, 104 support – 3 games
  const games = [game(), game(), game()];
  const c = I.roleCounts(games);
  assert.equal(c.get(101).get('jungle'), 3);
  // a champion played both top and mid: mid is taken by a surer one, so he goes top
  c.set(500, new Map([['mid', 6], ['top', 4]]));
  const g = I.guessLanes([500, 102, 101, 999], c);
  const by = Object.fromEntries(g.map(x => [x.champ, x]));
  assert.equal(by[102].role, 'mid');
  assert.equal(by[500].role, 'top');
  assert.equal(by[500].share, 0.4);
  assert.equal(by[101].role, 'jungle');
  // never seen: some free lane, no share
  assert.ok(['bot', 'support'].includes(by[999].role));
  assert.equal(by[999].share, null);
  assert.equal(new Set(g.map(x => x.role)).size, 4);
  // a position already known wins
  assert.equal(I.guessLanes([102], c, { 102: 'support' })[0].role, 'support');
});
