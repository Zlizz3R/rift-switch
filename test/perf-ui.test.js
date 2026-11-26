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
    assert.match(app.$('#perfLine').textContent, /^14 games · Solo\/Duo \+ Flex · Season \d{4}/);
    assert.match(app.$('.perf-bar .pk').textContent, /Games\s*14/);
    const roles = app.$$('.perf-table tr.pr-role');
    assert.deepEqual(roles.map(r => r.querySelector('[data-prow]').dataset.prow), ['jungle', 'mid']);
    assert.equal(roles.reduce((s, r) => s + Number(r.children[1].textContent), 0), 14);
    // unfold mid: its champions, Ahri first
    await app.click('[data-prow="mid"]');
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
    await app.click('[data-pq=""]');
    assert.ok(app.$('[data-prow="none"]'));
    // a champion row: its games on top of the match history (every filter off, like "pentakills first")
    await app.click('[data-pq="solo"]');
    await app.click('[data-pq="flex"]');
    assert.ok(app.$('[data-prow="mid"]').closest('tr').classList.contains('open'), 'an unfolded role stays open');
    await app.click('tr.pr-champ[data-ppin="mid|103"]');
    await app.settle();
    assert.ok(app.visible('#viewMatches'));
    assert.equal(app.$('#mhChamp').value, '');
    assert.match(app.$('.mh-sec.pin').textContent, /Mid · Ahri · 4/);
    // the role row's figures: all its games
    await app.click('#navDash');
    await app.settle();
    app.$('tr.pr-role[data-ppin="jungle|"] td:nth-child(2)').click();
    await app.settle();
    assert.match(app.$('.mh-sec.pin').textContent, /Jungle · 1/);
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
    assert.match(bars[0].textContent, /Farm\s*±0 %/);
    assert.match(bars[0].title, /13 games/);
    // the lane phase needs the gold per minute: none stored – dashed, no value (not 0)
    assert.ok(bars[5].classList.contains('few'));
    assert.match(app.$('.rd-head').textContent, /Mid \(main role\)/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('records: one mode only, with their scope ("bests in 14 stored Summoner\'s Rift games")', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navMatches');
    await app.settle();
    assert.match(app.$('.mh-rec-scope').textContent, /Bests in 14 stored Summoner's Rift games/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('overview filter: queues one by one, accounts as chips for every tab (kept)', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="champs"]');
    await app.settle();
    assert.match(app.$('#perfLine').textContent, /^14 games · Solo\/Duo \+ Flex/);
    // Flex off: only the Solo/Duo games
    await app.click('[data-pq="flex"]');
    assert.match(app.$('#perfLine').textContent, /^5 games · Solo\/Duo ·/);
    // ARAM on as well
    await app.click('[data-pq="aram"]');
    assert.match(app.$('#perfLine').textContent, /^6 games · Solo\/Duo \+ ARAM/);
    // the accounts like the match history's chips: from "All" a click picks just that account
    assert.ok(app.visible('#ovAccs'));
    await app.click(`[data-ovacc="${P(2)}"]`);
    assert.match(app.$('#perfBody').textContent, /No games match/);
    assert.ok(app.$(`[data-ovacc="${P(2)}"]`).classList.contains('on'));
    assert.ok(!app.$(`[data-ovacc="${P(1)}"]`).classList.contains('on'));
    assert.ok(!app.$('[data-ovacc=""]').classList.contains('on'));
    // the same choice on another tab; the LP history shows it in its own chips (no second bar)
    await app.click('[data-dt="stats"]');
    assert.match(app.$('#perfBody').textContent, /No games match/);
    await app.click('[data-dt="lp"]');
    assert.ok(!app.visible('#ovAccs'));
    // "All" brings every account back
    await app.click('[data-dt="champs"]');
    await app.click('[data-ovacc=""]');
    assert.match(app.$('#perfLine').textContent, /^6 games/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('map: deaths, kills or both, by phase or minutes picked on the chart; the empty state without timelines', async () => {
  // the four Ahri games (Ahri is player 2) get a timeline: three deaths each – two before 10 minutes in the
  // top river – and one solo kill in the mid lane at minute 12
  const withKills = games.map(g => (g.players[2].champ === 103 && g.q === 420
    ? { ...g, kills: [[200, 7, 2, [8], 50, 98], [400, 7, 2, [], 52, 96], [1500, 7, 2, [], 74, 74], [730, 2, 7, [], 70, 72]] } : g));
  const app = await boot({ replies: { ...replies, 'matches-get': withKills } });
  try {
    await app.click('#navDash');
    assert.match(app.$('[data-dt="map"]').textContent, /^Map$/);
    await app.click('[data-dt="map"]');
    await app.settle();
    assert.ok(app.visible('#dashPerf'), 'the Performance filter is there');
    const dots = cls => app.$$(`.dm-map .dm-dots.${cls} circle`).length;
    assert.equal(dots('deaths'), 12);
    assert.equal(dots('kills'), 0, 'deaths only at first');
    assert.match(app.$('.dm-hots').textContent, /Before 10 min\s*100 % of the deaths: Top river \(8 of 8\)/);
    assert.match(app.$('.dm-side').textContent, /12 deaths in 4 games · 3\.0 per game · 33 % against two or more enemies/);
    // kills: the four solo kills
    await app.click('[data-mpk="kills"]');
    assert.equal(dots('kills'), 4);
    assert.equal(dots('deaths'), 0);
    assert.match(app.$('.dm-side').textContent, /4 kills in 4 games · 1\.0 per game · 100 % without help/);
    // both: one table with both per zone
    await app.click('[data-mpk="both"]');
    assert.equal(dots('kills') + dots('deaths'), 16);
    assert.ok(app.$('.mp-rows.both'));
    // a phase
    await app.click('[data-dmph="late"]');
    assert.equal(dots('deaths'), 4);
    assert.equal(dots('kills'), 0, 'the kills are at minute 12');
    // minutes picked on the chart: press and let go on minute 12 → only the kills
    await app.click('[data-dmph="all"]');
    app.$('.mc-svg [data-mcm="12"]').dispatchEvent(new app.w.MouseEvent('mousedown', { bubbles: true }));
    app.w.document.dispatchEvent(new app.w.MouseEvent('mouseup', { bubbles: true }));
    await app.settle();
    assert.equal(dots('kills'), 4);
    assert.equal(dots('deaths'), 0);
    assert.match(app.$('.dm-phases').textContent, /Minute 12–13/);
    // only the newest games: the last 2 of the four Ahri games (and the jungle game in between) → 2 timelines
    await app.click('[data-dmph="all"]');
    app.$('#perfLast').value = '10';
    app.$('#perfLast').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.match(app.$('#perfLine').textContent, /^10 games · .* · Last 10 games/);
    // an own number: the field shows, 2 → the two newest ranked games (both Ahri games with a timeline)
    app.$('#perfLast').value = 'own';
    app.$('#perfLast').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.ok(app.visible('#perfLastN'));
    app.$('#perfLastN').value = '2';
    app.$('#perfLastN').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.equal(dots('deaths'), 6, 'three deaths in each of the two newest games');
    assert.match(app.$('#perfLine').textContent, /^2 games · .* · Last 2 games/);
    assert.equal(app.w.localStorage.getItem('rs.perfLast'), '2', 'kept for the next start');
    // back to all games; own dates: a day without games → nothing
    app.$('#perfLast').value = '0';
    app.$('#perfLast').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    app.$('#perfRange').value = 'custom';
    app.$('#perfRange').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.ok(app.visible('#perfDates'));
    app.$('#perfFrom').value = '2001-01-01';
    app.$('#perfFrom').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    app.$('#perfTo').value = '2001-01-02';
    app.$('#perfTo').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.match(app.$('#perfBody').textContent, /No games match/);
    app.$('#perfTo').value = '';
    app.$('#perfTo').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.equal(dots('deaths'), 12, 'open end: every game since then');
    // a role without timelines: the empty state
    await app.click('[data-prole="jungle"]');
    assert.match(app.$('#perfBody').textContent, /No deaths or kills with a place yet/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
