// Mastery across accounts: the table, milestones, the calibration and the play time estimate.
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
});

test('estimate: always a range over both point rates, ARAM makes it shorter', () => {
  const e = M.estimate(2200000);
  assert.equal(Math.round(e.gLow), Math.round(2200000 / R.pointsPerGame.after.high));
  assert.equal(Math.round(e.gHigh), Math.round(2200000 / R.pointsPerGame.before.low));
  assert.ok(e.hLow < e.hHigh);
  const m = (k) => R.minutes.sr[k] + R.overhead[k];
  assert.equal(Math.round(e.hHigh), Math.round((2200000 / R.pointsPerGame.before.low) * m('high') / 60));
  assert.ok(M.estimate(2200000, { aram: 1 }).hHigh < e.hHigh);
  // own readings replace the "after" rate
  const own = M.estimate(2200000, { ppg: 1500 });
  assert.equal(Math.round(own.gLow), Math.round(2200000 / 1500));
  assert.equal(own.ppg, 1500);
  assert.equal(M.estimate(0).hHigh, 0);
  assert.equal(M.roundNice(902), 900);
  assert.equal(M.roundNice(3080), 3100);
  assert.equal(M.roundNice(47.4), 47);
});

// [time, seconds, queue, champion, win, remake]
const game = (t, champ, o = {}) => [t, o.dur ?? 1800, o.q ?? 420, champ, true, !!o.remake];
test('calibration: points gained ÷ stored games between two readings, only with enough games', () => {
  const end = (i) => 1000 * i * 4000;     // readings after each block of games
  const hist = [{ at: 1, c: { 420: 1000 } }];
  const games = [];
  let pts = 1000;
  for (let i = 1; i <= 6; i++) {
    games.push(game(end(i) - 3000000, 420), game(end(i) - 2000000, 420));
    pts += 2400;
    hist.push({ at: end(i), c: { 420: pts } });
  }
  const c = M.calibrate(hist, games);
  assert.equal(c.games, 12);
  assert.equal(c.ppg, 1200);
  // too few games: nothing to calibrate with (the estimate uses the sourced numbers)
  assert.equal(M.calibrate(hist.slice(0, 3), games), null);
  assert.equal(M.calibrate([], []), null);
  // points without a stored game: the store missed one – that stretch is left out
  const gap = [...hist, { at: end(7), c: { 420: pts + 5000 } }];
  assert.equal(M.calibrate(gap, games).games, 12);
  // remakes never count
  assert.equal(M.calibrate(hist, games.map((g, i) => (i === 0 ? game(g[0], 420, { remake: true }) : g))).games, 11);
});

test('ARAM share and own game length', () => {
  const g = [game(1, 5), game(2, 5, { q: 450, dur: 1200 }), game(3, 7), game(4, 5, { remake: true })];
  assert.equal(M.aramShare(g, 5), 0.5);
  assert.equal(M.aramShare(g, 99), null);
  const len = M.avgMinutes(g);
  assert.equal(len.sr, 30);
  assert.equal(len.aram, 20);
  assert.equal(len.n, 3);
});
