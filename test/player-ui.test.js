// The player page (player-view.js) in the real window: any player's games, key figures, roles,
// champions, traits, recent games, the games with you, "open with" – and Live's trait tiers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');
const Tags = require('../ui/tags');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const now = Date.now();
// 12 lite games of player "x1" from his match list: mid, Ahri (103), 9 wins
const lite = Array.from({ length: 12 }, (_, i) => ({ id: String(800 + i), t: now - (i + 1) * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 0, lite: true,
  k: `${800 + i}:0.900`, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1', team: 100, champ: 103, pos: 'mid', win: i < 9, k: 8, d: 2, a: 6, cs: 270, dmg: 25000, vis: 20, spells: [4, 14] }] }));
const info = { puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', iconId: 7, level: 412, solo: { tier: 'CHALLENGER', division: 'I', lp: 1400, wins: 300, losses: 200 }, flex: null };

test('player page: rank, key figures, roles, champions, traits and the recent games of any player', async () => {
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: lite, info, mastery: { 103: 1500000 }, progress: { listed: true, done: 3, total: 12 } }),
    champions: [{ id: 103, name: 'Ahri' }],
    'open-external': true,
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', region: 'EUW' })`);
    await app.settle();
    await new Promise((r) => setTimeout(r, 30));
    await app.settle();
    assert.ok(app.visible('#viewPlayer'));
    const head = app.$('#plHead').textContent;
    assert.match(head, /Faker/);
    assert.match(head, /#KR1/);
    assert.match(head, /Level 412/);
    assert.match(head, /Challenger/);
    // the details still loading
    assert.match(app.$('#plHead .pl-prog').textContent, /3 \/ 12/);
    const body = app.$('#plBody').textContent;
    assert.match(body, /12 games known/);
    assert.match(app.$('.pl-figs').textContent, /75 %/);           // 9 of 12
    assert.match(app.$('.pl-figs').textContent, /7\.00/);           // (8 + 6) / 2
    assert.match(app.$$('.pl-role')[0].textContent, /Mid[\s\S]*100 %/);
    // the points under the name, then games, win rate, KDA
    assert.match(app.$('.pl-champ').textContent, /Ahri[\s\S]*1,500,000 pts[\s\S]*12 games[\s\S]*75 %/);
    assert.match(body, /Ahri OTP/, 'traits from his games');
    assert.equal(app.$$('.pl-game').length, 12);
    assert.ok(app.$('.pl-game.win') && app.$('.pl-game.loss'));
    assert.match(body, /Never in one of your stored games/);
    await app.click('[data-plsite="opgg"]');
    const ext = app.called('open-external').pop();
    assert.match(String(ext.args[0]), /op\.gg\/lol\/summoners\/euw\/Faker-KR1/);
    // all games / ranked
    await app.click('[data-plq="all"]');
    assert.ok(app.$('[data-plq="all"]').classList.contains('on'));
    assert.doesNotMatch(app.$('#dashTags') ? '' : app.$('#plBody').innerHTML, /\b(pl|tags?)\.[a-zA-Z]+\b(?![^<]*>)/, 'no text key without a translation');
    // the Overview's own views for this player: Performance (no accounts column, no jumps into the own
    // match history), Champions, Play style, Map – a role filter on them
    assert.deepEqual(app.$$('[data-pltab]').map(b => b.textContent), ['Overview', 'Performance', 'Champions', 'Play style', 'Map']);
    await app.click('[data-pltab="stats"]');
    assert.ok(app.$('#plBody .perf-bar'), 'the key figures');
    const heads = app.$$('#plBody .perf-table th').map(th => th.textContent);
    assert.ok(!heads.some(h => /Accounts/.test(h)), heads.join('|'));
    assert.equal(app.$('#plBody [data-ppin]'), null);
    await app.click('#plBody [data-prow="mid"]');
    assert.ok(app.$('#plBody .pr-champ'), 'a role unfolds into its champions');
    await app.click('[data-pltab="champs"]');
    assert.match(app.$('#plBody .oc-list').textContent, /Ahri[\s\S]*75 %/);
    assert.equal(app.$('#plBody [data-pchamp]'), null);
    await app.click('[data-pltab="style"]');
    assert.ok(app.$('#plBody .rd-head'));
    await app.click('[data-pltab="map"]');
    assert.match(app.$('#plBody').textContent, /No deaths or kills with a place yet/, 'lite games have no timeline');
    await app.click('[data-plrole="top"]');
    assert.match(app.$('#plBody').textContent, /No games match/);
    await app.click('[data-pltab="overview"]');
    assert.ok(app.$('.pl-figs'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('player page: the window sends the keys of the games it holds; "player-changed" loads again', async () => {
  let n = 0;
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: n++ ? [] : lite, info, mastery: null, progress: { listed: true, done: 12, total: 12 } }),
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1' })`);
    await app.settle();
    await app.emit('player-changed', { puuid: 'x1', progress: { listed: true, done: 12, total: 12 } });
    await new Promise((r) => setTimeout(r, 2200));
    await app.settle();
    const calls = app.called('player-games');
    assert.ok(calls.length >= 2);
    assert.deepEqual([...calls[calls.length - 1].args[1]].sort(), lite.map(g => g.k).sort());
    assert.equal(app.$$('.pl-game').length, 12, 'still there after a reply without games');
    // loaded: no progress bar
    assert.equal(app.$('#plHead .pl-prog'), null);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('trait tiers: what to act on first, background last; another champion\'s trait is background', () => {
  assert.equal(Tags.tierOf({ id: 'gankVictim' }), 1);
  assert.equal(Tags.tierOf({ id: 'fbVictim' }), 1);
  assert.equal(Tags.tierOf({ id: 'autofill', live: true }), 1);
  assert.equal(Tags.tierOf({ id: 'earlyFarm', level: 'great' }), 2);
  assert.equal(Tags.tierOf({ id: 'deaths', level: 'weak' }), 1);
  assert.equal(Tags.tierOf({ id: 'deaths', level: 'great' }), 2);
  assert.equal(Tags.tierOf({ id: 'mastery', champ: 420 }, { champ: 420 }), 3);
  // a millionaire on Illaoi while playing Yorick: background
  assert.equal(Tags.tierOf({ id: 'otp', champ: 420 }, { champ: 83 }), 3);
  assert.equal(Tags.tierOf({ id: 'otp', champ: 83 }, { champ: 83 }), 1);
  // one role only, and he got that role: background
  assert.equal(Tags.tierOf({ id: 'oneRole' }, { position: 'top', main: 'top' }), 3);
  assert.equal(Tags.tierOf({ id: 'smallPool' }), 3);
});

test('player search: suggestions from your games, Enter opens; an unknown Riot ID is looked up through the client', async () => {
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: lite, info, mastery: null, progress: { listed: true, done: 12, total: 12 } }),
    'find-player': (q) => (String(q).toLowerCase() === 'caps#euw' ? { puuid: 'x2', gameName: 'Caps', tagLine: 'EUW', region: 'EUW' } : null),
  } });
  try {
    const inp = app.$('#plSearch');
    assert.ok(inp && /Name#Tag/.test(inp.placeholder));
    app.w.eval(`scv.own = [{ id: '1', t: 1, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1' }, { puuid: 'x3', name: 'Fakeman', tag: 'EUW' }, { puuid: '${P(1)}', name: 'Me', tag: 'EUW' }] },
      { id: '2', t: 2, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1' }] }]`);
    await app.type(inp, 'fak');
    const sug = app.$$('.pl-sug');
    assert.equal(sug.length, 2);
    // most games with you first
    assert.match(sug[0].textContent, /Faker#KR12 games with you/);
    await app.key('ArrowDown', inp);
    assert.ok(app.$$('.pl-sug')[0].classList.contains('on'));
    await app.key('Enter', inp);
    await app.settle();
    assert.ok(app.visible('#viewPlayer'));
    assert.match(app.$('#plHead').textContent, /Faker/);
    assert.equal(inp.value, '');
    assert.equal(app.called('find-player').length, 0, 'known: no lookup');
    // somebody never met: through the client
    await app.type(inp, 'Caps#EUW');
    assert.equal(app.$$('.pl-sug').length, 0);
    await app.key('Enter', inp);
    await app.settle();
    assert.deepEqual(app.called('find-player').pop().args, ['Caps#EUW']);
    assert.equal(app.called('player-games').pop().args[0], 'x2');
    // not found: a message
    await app.type(inp, 'Nobody#X');
    await app.key('Enter', inp);
    await app.settle();
    assert.match(app.$('#toast').textContent, /No player “Nobody#X” found/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
