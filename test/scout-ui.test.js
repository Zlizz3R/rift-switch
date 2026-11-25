// Live → the ten players of a game as cards (scout-view.js) in the real window (harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, sampleState } = require('./harness');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const now = Date.now();
// a game from e1's match list: e1 plays Jax on top (blue side, slot 0)
const player = (team, i, o = {}) => ({ puuid: `x${team}${i}`, name: 'N' + i, tag: 'EUW', team, champ: 200 + i, pos: POS[i], win: team === 100,
  k: 5, d: 2, a: 6, cs: i === 4 ? 30 : 210, gold: 9000, dmg: 20000, vis: 20, lvl: 14, items: i === 4 ? [3877] : [0], spells: i === 1 ? [11, 4] : [4, 14], ...o });
const e1Games = Array.from({ length: 8 }, (_, i) => {
  const players = [...POS.map((_, j) => player(100, j)), ...POS.map((_, j) => player(200, j))];
  players[0] = { ...players[0], puuid: 'e1', champ: 24, win: i < 6 };
  players.slice(5).forEach(p => (p.win = i >= 6));
  return { id: String(900 + i), t: now - (i + 2) * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 4, players };
});
const card = (puuid, name, champ, position, o = {}) => ({ puuid, gameName: name, tagLine: 'EUW', championId: champ, position, iconId: 1, level: 120,
  solo: { tier: 'GOLD', division: 'II', lp: 40, wins: 30, losses: 25 }, flex: null, ...o });
const inGame = {
  queueId: 420,
  // scrambled order: the board puts them on their positions
  teamOne: [card('a4', 'Sup', 412, 'UTILITY'), card(P(1), 'Me', 103, 'MIDDLE'), card('a2', 'Jg', 64, 'JUNGLE'), card('a5', 'Tp', 86, 'TOP'), card('a3', 'Ad', 222, 'BOTTOM')],
  teamTwo: [card('e1', 'Enemy Top', 24, 'TOP', { solo: { tier: 'DIAMOND', division: 'I', lp: 10, wins: 50, losses: 40 } }), card('e2', 'Enemy Jg', 266, 'JUNGLE'),
    card('e3', 'Enemy Mid', 238, 'MIDDLE'), card('e4', 'Enemy Ad', 51, 'BOTTOM'), card('e5', 'Enemy Sup', 117, '')],
};

test('live board: ten cards on their positions, tags from the player\'s games, short / exact, progress', async () => {
  const st = sampleState();
  st.scout = { of: 9, listed: 9, done: 40, total: 120, running: false, players: { e1: [8, 8], e2: [3, 16] } };
  const app = await boot({ state: st, replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame },
    'scout-games': { e1: { games: e1Games, mastery: { 24: 312000, 103: 1000 } } },
    champions: [{ id: 24, name: 'Jax' }, { id: 103, name: 'Ahri' }],
  } });
  try {
    await app.click('#navLive');
    await app.settle();
    await app.settle();
    const rows = app.$$('.sc-row');
    assert.equal(rows.length, 2);
    const cards = rows.map(r => [...r.querySelectorAll('.sc-card')]);
    assert.deepEqual(cards.map(r => r.length), [5, 5]);
    // blue side on top, Top · Jungle · Mid · Bot · Support – lane opponents face each other
    assert.deepEqual(cards[0].map(c => c.dataset.sc), ['a5', 'a2', P(1), 'a3', 'a4']);
    assert.deepEqual(cards[1].map(c => c.dataset.sc), ['e1', 'e2', 'e3', 'e4', 'e5']);
    // no position from the client: guessed, and shown as such
    assert.ok(cards[1][4].querySelector('.sc-pos.guess'));
    assert.ok(!cards[1][0].querySelector('.sc-pos.guess'));
    // the enemy top: Jax, 6 of 8 games won on him, mastery, the rank band (on the edge facing blue)
    const e1 = cards[1][0];
    assert.match(e1.textContent, /Jax/);
    assert.match(e1.textContent, /312,000 mastery/);
    assert.match(e1.querySelector('.sc-rings').textContent, /75%/);
    assert.match(e1.style.getPropertyValue('--rk'), /#/);
    assert.ok(e1.classList.contains('bot') && e1.classList.contains('ranked') && e1.querySelector('.sc-rkband'));
    assert.match(e1.querySelector('.sc-rkband').title, /Solo\/Duo: Diamond I/);
    assert.ok(cards[0].every(x => x.classList.contains('top')) && cards[1].every(x => x.classList.contains('bot')));
    assert.match(e1.querySelector('.sc-tags').textContent, /Great with Jax/);
    // only one win rate on the card: the one on this champion
    assert.equal(e1.querySelectorAll('.sc-ring b').length, 1);
    // progress: game details of all of them, and per card
    assert.match(app.$('.sc-prog').textContent, /Game details · 40 \/ 120 games/);
    assert.match(app.$('.sc-prog b').textContent, /33 %/);
    assert.equal(app.$('.sc-prog .bar i').style.width, '33%');
    assert.ok(app.$('.sc-card[data-sc="e2"] .sc-bar'));
    assert.ok(!e1.querySelector('.sc-bar'));
    // the game runs: it goes on, slower – and says so
    await app.push({ ...st, scout: { ...st.scout, running: true, done: 60 } });
    app.w.eval('renderLive(true)');   // the app re-renders on "scout-changed" (throttled to 2.5 s)
    await app.settle();
    assert.ok(app.$('.sc-prog.slow'));
    assert.match(app.$('.sc-prog').textContent, /loading slower so it stays smooth · Game details · 60 \/ 120 games/);
    assert.equal(app.$('.sc-prog .bar i').style.width, '50%');
    // tags: exact – the numbers in the chip, kept as a setting
    await app.click('[data-sctags="1"]');
    assert.deepEqual(app.called('set-setting').map(c => c.args).pop(), ['tagsLong', true]);
    assert.match(app.$('.sc-card[data-sc="e1"] .sc-tags').textContent, /75 % win rate with Jax in 8 games/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('live without a game: no board, the page as before', async () => {
  const app = await boot({ replies: { live: { clientUp: true, phase: 'Lobby', me: P(1) } } });
  try {
    await app.click('#navLive');
    await app.settle();
    assert.equal(app.$$('.sc-card').length, 0);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
