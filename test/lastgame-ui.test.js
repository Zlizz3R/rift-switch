// "Last game": the compact game row on the Live page and in the account panel (the real window, see harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');

const player = (i, o = {}) => ({ puuid: 'x' + i, name: 'N' + i, tag: 'EUW', team: i < 5 ? 100 : 200, champ: 10 + i, pos: '', win: i < 5,
  k: 2, d: 3, a: 4, cs: 150, gold: 9000, dmg: 15000, vis: 20, lvl: 14, items: [0, 0, 0, 0, 0, 0, 0], spells: [4, 14], keystone: 0, sub: 0, ...o });
// 13 hours ago: no post-game overview any more (it stays up to 12 h), so Live shows the small row
const game = { id: '4242', t: Date.now() - 13 * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 3,
  players: [player(0, { puuid: P(1), champ: 420, k: 7, d: 0, a: 9, cs: 240 }), ...Array.from({ length: 9 }, (_, i) => player(i + 1))] };
const replies = {
  matches: { index: [['4242', game.t, 420, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
  'matches-get': [game],
};

test('last game: the panel and the Live page show the same compact row; a click opens it in the match history', async () => {
  const app = await boot({ replies: { ...replies, live: { clientUp: true, phase: 'Lobby', me: P(1) } } });
  try {
    await app.click(`#board .tile[data-id="${P(1)}"]`);
    await app.settle();
    const inPanel = app.$('#detail .d-last .mh-short');
    assert.ok(inPanel, 'the panel shows the last game');
    assert.match(inPanel.textContent, /Victory|Win/);
    assert.match(inPanel.textContent, /7 \/ 0 \/ 9/);
    assert.match(inPanel.textContent, /Perfect/);           // 0 deaths
    assert.match(inPanel.textContent, /8\.0 CS\/min/);
    await app.click('#navLive');
    await app.settle();
    const onLive = app.$('#liveBody .mh-short');
    assert.ok(onLive, 'Live shows the last game when no game is on');
    assert.equal(onLive.outerHTML, inPanel.outerHTML, 'identical at both places');
    // a click: the match history with this game opened
    await app.click(onLive);
    await app.settle();
    assert.ok(app.visible('#viewMatches'));
    assert.ok(app.$('.mh-row[data-gid="4242"].open'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
