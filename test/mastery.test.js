// Mastery across accounts: the table, milestones and the play time estimate.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../ui/mastmath');
const R = require('../ui/playtime-rules');

test('table: points add up over accounts, levels stay per account, the best account is marked', () => {
  const rows = M.masteryTable([
    { puuid: 'a', champs: { 420: [1800000, 161], 74: [200000, 22] } },
    { puuid: 'b', champs: { 420: [400000, 40], 1: [0, 0] } },
    { puuid: 'c', champs: {} },
  ]);
  assert.equal(rows.length, 2);              // a champion with 0 points is no row
  assert.equal(rows[0].id, 420);
  assert.equal(rows[0].total, 2200000);
  assert.equal(rows[0].n, 2);
  assert.equal(rows[0].best, 'a');
  assert.deepEqual(rows[0].accs.b, { pts: 400000, lvl: 40 });
  assert.equal(rows[1].total, 200000);
  assert.deepEqual(M.masteryTable(null), []);
});

test('milestones: the highest one reached', () => {
  assert.equal(M.milestone(99999), 0);
  assert.equal(M.milestone(100000), 100000);
  assert.equal(M.milestone(2214330), 2000000);
  assert.equal(M.milestone(5000000), 5000000);
  assert.equal(M.milestone(12000000), 10000000);
});

test('estimate: points ÷ 600 × minutes per game, one number', () => {
  const e = M.estimate(2200000);
  assert.equal(R.pointsPerGame, 600);
  assert.equal(M.pointsPerGame(), 600);
  assert.equal(e.games, 2200000 / 600);
  // 28.5 min in the game + 7 for queue, champ select, loading and the post-game screen
  assert.equal(e.hours, (2200000 / 600) * (28.5 + 7) / 60);     // ≈ 2,170 h
  assert.equal(M.roundNice(e.hours), 2200);
  // ARAM is shorter; half ARAM: the mean of both lengths
  assert.ok(M.estimate(2200000, { aram: 1 }).hours < e.hours);
  assert.equal(M.estimate(850, { aram: 0.5 }).mins, (28.5 + 20) / 2 + 7);
  // the account's own game length once it has enough games
  const own = [...Array(10)].map((_, i) => game(i, 5, { dur: 2100 }));
  assert.equal(M.gameMinutes(M.avgMinutes(own)).sr, 35);
  assert.equal(M.gameMinutes(M.avgMinutes(own.slice(0, 9))).sr, 28.5);
  assert.equal(M.estimate(0).hours, 0);
  assert.equal(M.roundNice(902), 900);
  assert.equal(M.roundNice(3080), 3100);
  assert.equal(M.roundNice(47.4), 47);
});

// [time, seconds, queue, champion, win, remake]
function game(t, champ, o = {}) { return [t, o.dur ?? 1800, o.q ?? 420, champ, true, !!o.remake]; }

test('ARAM share and own game length', () => {
  const g = [game(1, 5), game(2, 5, { q: 450, dur: 1200 }), game(3, 7), game(4, 5, { remake: true })];
  assert.equal(M.aramShare(g, 5), 0.5);
  assert.equal(M.aramShare(g, 99), null);
  const len = M.avgMinutes(g);
  assert.equal(len.sr, 30);
  assert.equal(len.aram, 20);
  assert.equal(len.n, 3);
});

