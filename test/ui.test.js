// The window's own logic (rank math, match history filters, texts) and its link to the
// background part. The background part (Rust) has its own tests: cargo test in src-tauri.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RM = require('../ui/rankmath');
const i18n = require('../ui/i18n');
const MF = require('../ui/matchfilter');

const DAY = 86400000;
test('decay countdown on the tiles', () => {
  const now = 100 * DAY;
  const a = { puuid: 'a', solo: { tier: 'EMERALD' }, flex: { tier: 'DIAMOND' }, decay: { q: { flex: 28 }, at: now - 3 * DAY } };
  assert.deepEqual(RM.decayInfo(a, 'other', now), { days: 25, est: false, q: 'Flex' });
  assert.equal(RM.decayInfo(a, 'a', now).days, 28);                 // signed in: the fresh number
  assert.equal(RM.decayInfo({ solo: { tier: 'EMERALD' } }, null, now), null);   // below Diamond: no decay
  const est = RM.decayInfo({ solo: { tier: 'MASTER' }, lastPlayed: now - 4 * DAY }, null, now);
  assert.deepEqual(est, { days: 10, est: true, bank: 14, q: 'Solo/Duo' });
  assert.equal(RM.decayInfo({ solo: { tier: 'DIAMOND' }, lastPlayed: now - 90 * DAY }, null, now).days, 0);
});

test('rank score', () => {
  assert.equal(RM.rankScore({ tier: 'IRON', division: 'IV', lp: 0 }), 0);
  assert.equal(RM.rankScore({ tier: 'GOLD', division: 'I', lp: 50 }), 3 * 400 + 300 + 50);
  assert.ok(RM.rankScore({ tier: 'MASTER', lp: 10 }) > RM.rankScore({ tier: 'DIAMOND', division: 'I', lp: 99 }));
  assert.deepEqual(RM.scoreToRank(1550), { tier: 'GOLD', division: 'I' });
  assert.equal(RM.scoreToRank(3000).plus, true);
  assert.equal(RM.mmrScore, undefined, 'no MMR guess (Riot policy)');
});

test('every language has every text with the same placeholders', () => {
  const en = i18n.STRINGS.en;
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const [code] of i18n.LANGS) {
    const L = i18n.STRINGS[code];
    assert.ok(L, code);
    // left in English on purpose: the app's name, the Riot legal notice, the op.gg button
    const missing = Object.keys(en).filter(k => !(k in L) && !['live.allOpgg', 'app.name', 'legal.riot'].includes(k));
    assert.deepEqual(missing, [], code + ' is missing texts');
    for (const k of Object.keys(L)) if (k in en) assert.equal(ph(L[k]), ph(en[k]), `${code} ${k}`);
  }
});

test('match history filters, sorting and summary', () => {
  const now = 100 * DAY;
  const game = (id, daysAgo, k, d, a, win, extra = {}) => ({ id: String(id), t: now - daysAgo * DAY, dur: 1800, owners: ['me'],
    players: [{ puuid: 'me', champ: extra.champ || 1, k, d, a, cs: 180, dmg: 20000 + k * 1000, win, multi: extra.multi || 1 }, { puuid: 'x', k: 0, d: 0, a: 0 }],
    remake: !!extra.remake });
  const games = [game(1, 0.1, 10, 2, 5, true), game(2, 3, 2, 9, 1, false, { champ: 7 }), game(3, 20, 15, 0, 3, true, { multi: 5 }),
    game(4, 40, 4, 4, 4, false), game(5, 1, 0, 0, 0, false, { remake: true })];
  assert.deepEqual(MF.filterGames(games, { range: '7' }, now).map(g => g.id), ['1', '5', '2']);
  assert.deepEqual(MF.filterGames(games, { result: 'win' }, now).map(g => g.id), ['1', '3']);
  assert.deepEqual(MF.filterGames(games, { result: 'loss' }, now).map(g => g.id), ['2', '4']);   // remake is neither
  assert.deepEqual(MF.filterGames(games, { champ: 7 }, now).map(g => g.id), ['2']);
  assert.deepEqual(MF.filterGames(games, { minKills: 10 }, now).map(g => g.id), ['1', '3']);
  assert.deepEqual(MF.filterGames(games, { maxDeaths: '2', minKda: '' }, now).map(g => g.id), ['1', '5', '3']);
  assert.deepEqual(MF.filterGames(games, { minMulti: 5 }, now).map(g => g.id), ['3']);
  assert.equal(MF.filterGames(games, { sort: 'kda' }, now)[0].id, '3');        // 0 deaths = perfect, first
  assert.equal(MF.filterGames(games, { sort: 'deaths' }, now)[0].id, '2');
  const s = MF.summarize(games);
  assert.equal(s.games, 4);                                                   // remake left out
  assert.equal(s.winrate, 50);
  assert.equal(s.records.kills.p.k, 15);
  assert.equal(s.pentas, 1);
  assert.deepEqual(s.streak, { win: true, n: 1 });
  assert.equal(MF.summarize([]), null);
});

test('match history: own date range, both days included', () => {
  const at = (y, m, d, h) => new Date(y, m - 1, d, h).getTime();
  const g = (id, t) => ({ id, t, dur: 1800, owners: ['me'], players: [{ puuid: 'me', k: 1, d: 1, a: 1, cs: 1, dmg: 1, win: true }] });
  const games = [g('a', at(2026, 11, 1, 23)), g('b', at(2026, 11, 3, 0)), g('c', at(2026, 11, 5, 23)), g('d', at(2026, 11, 6, 0))];
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-03', to: '2026-11-05' }).map(x => x.id), ['c', 'b']);
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-05', to: '2026-11-03' }).map(x => x.id), ['c', 'b']);
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-05', to: '' }).map(x => x.id), ['d', 'c']);
  assert.equal(MF.dayStart('bad'), null);
});

test('multikills: games counted by their biggest multikill', () => {
  const g = (id, multi) => ({ id, t: id, dur: 1800, owners: ['me'], players: [{ puuid: 'me', k: 1, d: 1, a: 1, cs: 1, dmg: 1, win: true, multi }] });
  const s = MF.summarize([g(1, 5), g(2, 5), g(3, 4), g(4, 2), g(5, 0), g(6, 6)]);
  assert.deepEqual(s.multis, { 2: 1, 3: 0, 4: 1, 5: 3 });
});

test('every call of the window exists in the background part', () => {
  const ui = path.join(__dirname, '..', 'ui');
  const shim = fs.readFileSync(path.join(ui, 'tauri-api.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
  // api.x used anywhere in the window -> defined in the shim
  const used = new Set();
  for (const f of fs.readdirSync(ui).filter(f => f.endsWith('.js') && f !== 'tauri-api.js'))
    for (const m of fs.readFileSync(path.join(ui, f), 'utf8').matchAll(/\bapi\.(\w+)/g)) used.add(m[1]);
  for (const k of used) assert.match(shim, new RegExp('\\b' + k + ':'), 'api.' + k + ' missing in tauri-api.js');
  // every channel the shim calls -> handled in main.rs dispatch
  for (const m of shim.matchAll(/call\('([\w-]+)'/g)) assert.ok(main.includes('"' + m[1] + '"'), m[1] + ' not handled in main.rs');
});

test('in-game overlay: team lead and lanes from the numbers the app sends', () => {
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'ui');
  const html = fs.readFileSync(path.join(dir, 'overlay.html'), 'utf8').replace(/<script src="overlay.js"><\/script>/, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(dir, 'overlay.js'), 'utf8'));
  const d = dom.window.document;
  assert.equal(d.getElementById('ov').hidden, true, 'nothing before the first numbers');
  dom.window.update({ mine: 14725, theirs: 12435, lanes: [{ pos: 'top', diff: 965 }, { pos: 'sup', diff: 0 }, { pos: 'mid', diff: -550 }] });
  assert.equal(d.getElementById('ov').hidden, false);
  assert.equal(d.getElementById('ovDiff').textContent, '▲ 2.3k');
  assert.ok(d.getElementById('ovDiff').classList.contains('up'));
  assert.deepEqual([...d.querySelectorAll('.ov-lane')].map((x) => x.textContent), ['TOP +965', 'SUP ±0', 'MID −550']);
  dom.window.update({ mine: 1000, theirs: 1500, lanes: [] });
  assert.ok(d.getElementById('ovDiff').classList.contains('down'));
  assert.equal(d.querySelectorAll('.ov-lane').length, 0, 'ARAM: team only');
});
