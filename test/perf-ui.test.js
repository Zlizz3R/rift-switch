// Overview → Performance and Champions in the real window (harness.js): the filter, the key
// figures, the role table, the op.gg-style list and the jump to the match history.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const player = (team, i, o = {}) => ({ puuid: `x${team}${i}`, name: 'N' + i, tag: 'EUW', team, champ: 200 + i, pos: POS[i], win: team === 100,
  k: 2, d: 3, a: 4, cs: i === 4 ? 30 : 200, gold: 9000, dmg: 15000, vis: 20, lvl: 14, items: i === 4 ? [3877, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0],
  spells: i === 1 ? [11, 4] : [4, 14], keystone: 0, sub: 0, ...o });
const now = Date.now();
// ten champions on mid (one game each, the first one four times), one game as jungle, one ARAM
const games = [];
const add = (id, q, me, at = 2, mode = 'CLASSIC') => {
  const players = [...POS.map((_, i) => player(100, i)), ...POS.map((_, i) => player(200, i))];
  players[at] = { ...players[at], puuid: P(1), ...me };
  games.push({ id: String(id), t: now - id * 3600000, dur: 1800, q, mode, remake: false, v: 3, players });
};
for (let i = 0; i < 4; i++) add(100 + i, 420, { champ: 103, k: 8, d: 1, a: 6 });
for (let c = 0; c < 9; c++) add(200 + c, 440, { champ: 1 + c });
add(300, 420, { champ: 64 }, 1);
add(400, 450, { champ: 22 }, 2, 'ARAM');
const replies = {
  matches: { index: games.map(g => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
  'matches-get': games,
  champions: [{ id: 103, name: 'Ahri' }, { id: 64, name: 'Lee Sin' }],
};

test('performance: key figures and roles add up, a role unfolds, a champion opens the match history', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="stats"]');
    await app.settle();
    assert.ok(app.visible('#dashPerf'));
    // ranked of this season by default: 14 games (the ARAM game isn't ranked)
    assert.match(app.$('#perfLine').textContent, /^14 games · Ranked \(Solo \+ Flex\) · Season \d{4}/);
    assert.match(app.$('.perf-bar .pk').textContent, /Games\s*14/);
    const roles = app.$$('.perf-table tr.pr-role');
    assert.deepEqual(roles.map(r => r.dataset.prow), ['jungle', 'mid']);
    assert.equal(roles.reduce((s, r) => s + Number(r.children[1].textContent), 0), 14);
    // unfold mid: its champions, Ahri first
    await app.click('tr[data-prow="mid"]');
    const champRows = app.$$('tr.pr-champ');
    assert.equal(champRows.length, 10);
    assert.match(champRows[0].textContent, /Ahri\s*4/);
    // under 5 games the win rate is grey
    assert.ok(champRows[0].children[2].classList.contains('muted'));
    // the role filter
    await app.click('[data-prole="jungle"]');
    assert.match(app.$('#perfLine').textContent, /^1 game · .*Jungle/);
    await app.click('[data-prole=""]');
    // all queues: ARAM shows up as "no lane"
    app.$('#perfQueue').value = 'all';
    app.$('#perfQueue').dispatchEvent(new app.w.Event('change'));
    assert.ok(app.$('tr[data-prow="none"]'));
    // a champion: the match history with this champion and the same queues
    app.$('#perfQueue').value = 'ranked';
    app.$('#perfQueue').dispatchEvent(new app.w.Event('change'));
    assert.ok(app.$('tr[data-prow="mid"]').classList.contains('open'), 'an unfolded role stays open');
    await app.click('tr.pr-champ[data-pchamp="103"]');
    await app.settle();
    assert.ok(app.visible('#viewMatches'));
    assert.equal(app.$('#mhChamp').value, 'Ahri');
    assert.ok(app.$('[data-mhq="solo"]').classList.contains('on') && app.$('[data-mhq="flex"]').classList.contains('on'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('champions: "All" first, the top 8, then all of them, sortable; the tab is kept', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="champs"]');
    await app.settle();
    const rows = app.$$('.oc-row');
    assert.equal(rows.length, 9);                       // "All" + top 8
    assert.match(rows[0].textContent, /All[\s\S]*14 games/);
    assert.match(rows[1].textContent, /Ahri[\s\S]*CS 200 \(6\.7\)[\s\S]*14\.00:1 KDA[\s\S]*8\.0 \/ 1\.0 \/ 6\.0[\s\S]*4 games/);
    assert.match(rows[2].textContent, /1 game\b/);
    await app.click('[data-pall]');
    assert.equal(app.$$('.oc-row').length, 12);         // All + 11 champions
    await app.click('[data-csort="kda"]');
    assert.match(app.$$('.oc-row')[1].textContent, /Ahri/);
    assert.deepEqual(app.called('set-setting').map(c => c.args[1]).pop(), { dash: 'champs' });
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('play style: a radar against the lane opponent on the main role, the same values as bars', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="style"]');
    await app.settle();
    assert.ok(app.$('#perfBody svg.radar'));
    const bars = app.$$('.rd-bar');
    assert.equal(bars.length, 7);
    // 13 mid games with a lane opponent: farm has a value; 100 % = as good as him
    assert.match(bars[0].textContent, /Farm\s*100 %/);
    assert.match(bars[0].title, /13 games/);
    // the lane phase needs the gold per minute: none stored – dashed, no value (not 0)
    assert.ok(bars[5].classList.contains('few'));
    assert.match(app.$('.rd-head').textContent, /Mid \(main role\)/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
