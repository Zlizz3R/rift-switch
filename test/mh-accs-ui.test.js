// Match history: accounts as chips like the queues (the real window, harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');

const player = (i, puuid, o = {}) => ({ puuid: puuid || 'x' + i, name: 'N' + i, tag: 'EUW', team: i < 5 ? 100 : 200, champ: 10 + i, pos: '', win: i < 5,
  k: 2, d: 3, a: 4, cs: 150, gold: 9000, dmg: 15000, vis: 20, lvl: 14, items: [0, 0, 0, 0, 0, 0, 0], spells: [4, 14], ...o });
const game = (id, owner, hoursAgo) => ({ id: String(id), t: Date.now() - hoursAgo * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 4,
  players: [player(0, owner), ...Array.from({ length: 9 }, (_, i) => player(i + 1))] });
const games = [game(1, P(1), 1), game(2, P(2), 2), game(3, P(3), 3)];
const index = games.map(g => [g.id, g.t, 420, g.players[0].puuid]);

test('match history: accounts as chips – from "All" one, then more, none = all again', async () => {
  const app = await boot({ replies: {
    // the app filters one account itself
    matches: (f) => ({ index: f && f.puuid ? index.filter(r => r[3] === f.puuid) : index, waiting: 0, clientUp: true }),
    'matches-get': games,
  } });
  try {
    await app.click('#navMatches');
    await app.settle();
    const rows = () => app.$$('.mh-row').map(r => r.dataset.gid).sort();
    assert.deepEqual(rows(), ['1', '2', '3']);
    assert.ok(!app.$('#mhAccount'), 'no drop-down any more');
    assert.ok(app.$('[data-mhaccs=""]').classList.contains('on'));
    // from "All": just this one
    await app.click(`[data-mhaccs="${P(2)}"]`);
    await app.settle();
    assert.deepEqual(rows(), ['2']);
    assert.equal(app.called('matches').pop().args[0].puuid, P(2));
    // another one added: both
    await app.click(`[data-mhaccs="${P(1)}"]`);
    await app.settle();
    assert.deepEqual(rows(), ['1', '2']);
    assert.ok(!app.$('[data-mhaccs=""]').classList.contains('on'));
    // both off again: all
    await app.click(`[data-mhaccs="${P(1)}"]`);
    await app.click(`[data-mhaccs="${P(2)}"]`);
    await app.settle();
    assert.deepEqual(rows(), ['1', '2', '3']);
    assert.ok(app.$('[data-mhaccs=""]').classList.contains('on'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
