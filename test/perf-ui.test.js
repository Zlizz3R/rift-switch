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

test('performance: one page – key figures, then champions, roles, play style and map; a champion opens the match history', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    assert.deepEqual(app.$$('#dashTabs [data-dt]').map(b => b.dataset.dt), ['stats', 'tags', 'mast', 'matches', 'lp', 'seasons']);
    assert.ok(app.$('[data-dt="stats"]').classList.contains('on'), 'Performance is the start page');
    await app.click('[data-dt="stats"]');
    await app.settle();
    assert.ok(app.visible('#dashPerf'));
    // every ranked queue of this season by default: 14 games (the ARAM game isn't ranked)
    assert.match(app.$('#perfLine').textContent, /^14 games · All ranked · Season \d{4}/);
    assert.ok(app.$('[data-pq="ranked"]').classList.contains('on'), '"All ranked" is on at first');
    assert.ok(!app.$('[data-pq="solo"]').classList.contains('on'));
    assert.match(app.$('.perf-strip .pf').textContent, /Games\s*14/);
    // no role table any more; the four cards
    assert.equal(app.$('.perf-table'), null);
    // the map right after the champions (top right on a wider window), then roles and play style
    assert.deepEqual(app.$$('#perfBody .perf-card').map(c => c.id), ['perfSec-champs', 'perfSec-map', 'perfSec-roles', 'perfSec-style']);
    assert.match(app.$('.pc-roles').textContent, /Mid ★/);
    // the role filter: one role – no roles card
    await app.click('[data-prole="jungle"]');
    assert.match(app.$('#perfLine').textContent, /^1 game · .*Jungle/);
    assert.equal(app.$('.pc-roles'), null);
    await app.click('[data-prole=""]');
    // a champion: every other card shows only its games – the list keeps all champions
    await app.click('.oc-row[data-pchamp="103"]');
    assert.ok(app.$('.oc-row[data-pchamp="103"]').classList.contains('on'));
    assert.match(app.$('#perfLine').textContent, /^4 games · .*Ahri/);
    assert.match(app.$('.perf-strip .pf.games').textContent, /Games\s*4/);
    assert.ok(app.$$('.oc-row').length > 2, 'the other champions stay in the list');
    assert.match(app.$('.pc-champs .oc-clear').textContent, /Ahri/);
    // again (or ✕): every champion
    await app.click('.pc-champs .oc-clear');
    assert.equal(app.$('.oc-row.on'), null);
    assert.match(app.$('#perfLine').textContent, /^14 games/);
    // ↗ on a row: those games in the match history
    await app.click('[data-pchampmh="103"]');
    await app.settle();
    assert.ok(app.visible('#viewMatches'));
    assert.equal(Number(app.w.eval('mh.f.champ')), 103);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('champions: "All" first, the top 8, then all of them, sortable; the tab is kept', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="stats"]');
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
    await app.click('#navAccounts');
    await app.click('#navDash');
    assert.ok(app.$('[data-dt="stats"]').classList.contains('on'), 'back on Performance');
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('play style: a radar against the lane opponent on the main role, the same values as bars', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="stats"]');
    await app.settle();
    assert.ok(app.$('#perfBody .pc-style svg.radar'));
    const bars = app.$$('.rd-bar');
    assert.equal(bars.length, 8);
    assert.match(bars[2].textContent, /Gold/);
    // 13 mid games with a lane opponent: farm has a value; 100 % = as good as him
    assert.match(bars[0].textContent, /Farm\s*CS per minute\s*±0 %/, 'each axis with its unit');
    assert.match(bars[0].title, /13 games/);
    assert.match(bars[0].title, /Minions and monsters killed per minute/, 'what exactly is measured');
    assert.match(app.$$('.rd-bar')[6].title, /gold at minute 15[\s\S]*ahead after the lane phase/);
    assert.equal(app.$('#perfBody .pc-style .coll-foot').textContent, "Each axis: your average against your lane opponents' average in the same games.");
    // the lane phase needs the gold per minute: none stored – dashed, no value (not 0)
    assert.ok(bars[6].classList.contains('few'));
    assert.match(app.$('.rd-head').textContent, /Mid \(main role\)/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('records: one mode only, with their scope ("bests in 14 stored Summoner\'s Rift games")', async () => {
  const app = await boot({ replies });
  try {
    await app.openMatches();
    await app.settle();
    assert.match(app.$('.mh-rec-scope').textContent, /Bests in 14 stored Summoner's Rift games/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('overview filter: queues one by one, accounts as chips for every tab (kept)', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="stats"]');
    await app.settle();
    assert.match(app.$('#perfLine').textContent, /^14 games · All ranked/);
    // from "All ranked" a queue: just that one – only the Solo/Duo games
    await app.click('[data-pq="solo"]');
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
    // the same choice on another tab – the chips sit in the head of every tab
    await app.click('[data-dt="tags"]');
    await app.click('[data-dt="stats"]');
    assert.match(app.$('#perfBody').textContent, /No games match/);
    await app.click('[data-dt="lp"]');
    assert.ok(app.visible('#ovAccs'));
    // "All" brings every account back
    await app.click('[data-dt="stats"]');
    await app.click('[data-ovacc=""]');
    assert.match(app.$('#perfLine').textContent, /^6 games/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('map: deaths, kills or both, by phase or minutes picked on the chart; the empty state without timelines', async () => {
  // the four Ahri games (Ahri is player 2) get a timeline: three deaths each – two before 10 minutes in the
  // top river – and one solo kill in the mid lane at minute 12
  const withKills = games.map(g => (g.players[2].champ === 103 && g.q === 420
    ? { ...g, kills: [[200, 7, 2, [8], 50, 98], [400, 7, 2, [], 52, 96], [1500, 7, 2, [], 74, 74], [730, 2, 7, [], 70, 72], [900, 3, 8, [2], 20, 120]] } : g));
  const app = await boot({ replies: { ...replies, 'matches-get': withKills } });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="stats"]');
    assert.match(app.$('.pc-map .perf-card-h').textContent, /^Map$/);
    await app.settle();
    assert.ok(app.visible('#dashPerf'), 'the Performance filter is there');
    const dots = cls => app.$$(`.dm-map .dm-dots.${cls} circle`).length;
    // Kills, Deaths, Assists – each on or off by itself; kills and deaths at first
    assert.deepEqual(app.$$('[data-mpk]').map(b => b.dataset.mpk), ['kill', 'death', 'assist']);
    assert.equal(dots('deaths'), 12);
    assert.equal(dots('kills'), 4);
    assert.equal(dots('assists'), 0, 'assists off at first');
    assert.ok(app.$('.mp-rows.k2'));
    // a zone row: the number first, the bar after it
    assert.equal(app.$('.mp-rows .mp-row:not(.head) .mp-cell').firstElementChild.tagName, 'B');
    // deaths only
    await app.click('[data-mpk="kill"]');
    assert.equal(dots('kills'), 0);
    assert.match(app.$('.dm-hots').textContent, /Before 10 min\s*100 % of the deaths: Top river \(8 of 8\)/);
    assert.match(app.$('.dm-side').textContent, /12 deaths in 4 games · 3\.0 per game · 33 % against two or more enemies/);
    // kills only: the four solo kills
    await app.click('[data-mpk="kill"]');
    await app.click('[data-mpk="death"]');
    assert.equal(dots('kills'), 4);
    assert.equal(dots('deaths'), 0);
    assert.match(app.$('.dm-side').textContent, /4 kills in 4 games · 1\.0 per game · 100 % without help/);
    // the last kind stays on
    await app.click('[data-mpk="kill"]');
    assert.ok(app.$('[data-mpk="kill"]').classList.contains('on'));
    // assists too
    await app.click('[data-mpk="assist"]');
    assert.equal(dots('assists'), 4);
    assert.match(app.$('.dm-side').textContent, /4 assists in 4 games · 1\.0 per game/);
    // all three: one table, three columns
    await app.click('[data-mpk="death"]');
    assert.ok(app.$('.mp-rows.k3'));
    assert.equal(dots('kills') + dots('deaths') + dots('assists'), 20);
    await app.click('[data-mpk="assist"]');
    assert.ok(app.$('.mp-rows.k2'));
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

test('performance: the key figures in one strip – wins and losses in colour, the traits on the right lead into the Traits tab; ARAM only: team share and its map', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.settle();
    assert.ok(app.visible('#dashPerf'), 'the Overview opens on Performance');
    const strip = app.$('#perfBody .perf-strip');
    assert.match(strip.querySelector('.pf.games').textContent, /Games\s*14/);
    assert.match(strip.querySelector('.pf.games i.w').textContent, /^\d+ W$/);
    assert.match(strip.querySelector('.pf.games i.l').textContent, /^\d+ L$/);
    assert.ok(strip.querySelector('.pf.wr .ov-ring'), 'the win rate as a ring');
    assert.ok(strip.querySelector('.pf.kda i.l'), 'the deaths in red');
    assert.equal(app.$('.trend'), null, 'no trend line any more');
    // the traits on the right: a click leads into the Traits tab
    assert.ok(strip.querySelector('.pf-traits .tchips'));
    await app.click('.pf-traits [data-ovgo="tags"]');
    assert.ok(app.$('[data-dt="tags"]').classList.contains('on'));
    assert.ok(app.visible('#dashTags'));
    // ARAM only: no lanes – the share of the team instead of roles and play style, ARAM's own map; no CS,
    // the damage share
    await app.click('[data-dt="stats"]');
    await app.click('[data-pq="aram"]');
    assert.deepEqual(app.$$('#perfBody .perf-card').map(c => c.id), ['perfSec-champs', 'perfSec-map', 'perfSec-share']);
    assert.equal(app.$('.pf.cs'), null);
    assert.ok(app.$('.pf.share'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('showcase: favourites from the collections in the head – pick, order, size, empty; kept as a setting', async () => {
  // skins read with the game data: [id, name, picture, rarity, legacy, year got]
  const colls = [{ puuid: 'p1', skins: [[103001, 'Dynasty Ahri', '/lol-game-data/assets/ahri1.jpg', 2, 1, 2019], [103015, 'K/DA Ahri', '/lol-game-data/assets/ahri15.jpg', 3, 0, 2024]], icons: [29, 7],
    wards: [[3, 'Poro Ward', '/lol-game-data/assets/w3.png']] }, { puuid: 'p2', skins: [[103001, 'Dynasty Ahri', '/lol-game-data/assets/ahri1.jpg']], emotes: [[4096, 'Thumbs up', '/lol-game-data/assets/e.png']] }];
  const app = await boot({ replies: { ...replies, collections: colls } });
  try {
    await app.click('#navDash');
    await app.settle();
    assert.ok(app.$('#ovShow').hidden, 'nothing chosen: no showcase, only the button');
    await app.click('#ovShowBtn [data-shedit]');
    await app.settle();
    assert.ok(!app.$('#showBox').hidden);
    // each skin once, across the accounts
    assert.equal(app.$$('.sh-grid .sh-pick').length, 2);
    // filters: a rarity, Legacy, the year it was got
    await app.click('[data-shrar="3"]');
    assert.deepEqual(app.$$('.sh-grid .sh-pick').map(b => b.dataset.shadd), ['skin:103015']);
    await app.click('[data-shrar=""]');
    await app.click('[data-shleg]');
    assert.deepEqual(app.$$('.sh-grid .sh-pick').map(b => b.dataset.shadd), ['skin:103001']);
    await app.click('[data-shleg]');
    assert.deepEqual([...app.$('#showYear').options].map(o => o.value), ['', '2024', '2019']);
    app.$('#showYear').value = '2024';
    app.$('#showYear').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    assert.deepEqual(app.$$('.sh-grid .sh-pick').map(b => b.dataset.shadd), ['skin:103015']);
    app.$('#showYear').value = '';
    app.$('#showYear').dispatchEvent(new app.w.Event('change', { bubbles: true }));
    assert.equal(app.$$('.sh-grid .sh-pick').length, 2);
    await app.click('[data-shadd="skin:103015"]');
    await app.click('[data-shkind="icon"]');
    await app.click('[data-shadd="icon:29"]');
    await app.click('[data-shkind="emote"]');
    await app.click('[data-shadd="emote:4096"]');
    const last = () => app.called('set-setting').filter(c => c.args[0] === 'showcase').pop().args[1];
    assert.deepEqual(last().items.map(x => x.k + x.id), ['skin103015', 'icon29', 'emote4096']);
    // the emote one place earlier, taken out with a second click, the size large
    await app.click('[data-shmove="2:-1"]');
    assert.deepEqual(last().items.map(x => x.id), [103015, 4096, 29]);
    await app.click('[data-shadd="emote:4096"]');
    await app.click('[data-shsize="3"]');
    assert.deepEqual(last(), { size: 3, items: [{ k: 'skin', id: 103015, n: 'K/DA Ahri', p: '/lol-game-data/assets/ahri15.jpg' }, { k: 'icon', id: 29, n: '', p: '' }] });
    await app.click('#showDone');
    assert.ok(app.$('#showBox').hidden);
    assert.ok(!app.$('#ovShow').hidden && app.$('#ovShow').classList.contains('s-3'));
    assert.equal(app.$$('#ovShow .shi').length, 2);
    assert.match(app.$('#ovShow .shi.k-skin').title, /K\/DA Ahri/);
    // empty again
    await app.click('#ovShowBtn [data-shedit]');
    await app.settle();
    await app.click('#showClear');
    assert.ok(app.$('#ovShow').hidden);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('own Overview: "Open with" in the head – op.gg multi-search for several accounts, one account its pages', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.settle();
    const row = app.$('#ovWho .pl-open');
    assert.ok(row, 'the row is there for the own accounts too');
    await app.click('#ovWho [data-ovsite="multi"]');
    assert.equal(app.called('open-multi').length, 1);
    // only one account chosen: no multi-search, its op.gg page
    app.w.eval(`ovOnly('${P(1)}')`);
    app.w.eval('renderOvHero()');
    assert.equal(app.$('#ovWho [data-ovsite="multi"]'), null);
    await app.click('#ovWho [data-ovsite="opgg"]');
    assert.match(app.called('open-external').pop().args[0], /op\.gg/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
