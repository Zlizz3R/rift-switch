// Small extras in the real window (harness.js): a random skin in champion select, League's
// language in Tools, appear offline in the settings, copying a saved login from the panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, sampleState, P } = require('./harness');

const last = (app, ch) => app.called(ch).slice(-1)[0];
async function withApp(opts, fn) {
  const app = await boot(opts);
  try {
    await fn(app);
    assert.deepEqual(app.errors.map(String), [], 'no script errors');
  } finally { app.close(); }
}

test('champion select: "Random skin" picks one and says which (with its chroma); without a champion it says so', () => {
  const live = { clientUp: true, phase: 'ChampSelect', region: 'EUW', me: P(1),
    champSelect: { myPosition: 'middle', hiddenNames: true, allies: [], team: [{ championId: 103, position: 'middle', me: true }], enemies: [] } };
  let reply = { ok: true, skin: 'K/DA Ahri', chroma: 'Ruby' };
  return withApp({ replies: { live, champions: [{ id: 103, name: 'Ahri' }], 'random-skin': () => reply } }, async (app) => {
    await app.click('#navLive');
    await new Promise((r) => setTimeout(r, 100));
    app.w.eval('renderLive(true)');
    await app.settle();
    assert.ok(app.$('#rndSkin'), 'the button is in the helper during champion select');
    await app.click('#rndSkin');
    assert.equal(app.called('random-skin').length, 1);
    assert.match(app.$('#toast').textContent, /Skin: K\/DA Ahri \(Ruby\)/);
    reply = { ok: false, why: 'noChamp' };
    await app.click('#rndSkin');
    assert.match(app.$('#toast').textContent, /Pick your champion first/);
  });
});

test('champion select: no random skin button outside champion select', () => withApp({ replies: { live: { clientUp: true, phase: 'Lobby', me: P(1) } } }, async (app) => {
  await app.click('#navLive');
  await app.settle();
  assert.equal(app.$('#rndSkin'), null);
}));

test('tools: League\'s language – the list by name, the current one chosen; League open: a note', () => {
  let setReply = { ok: false, why: 'leagueOpen' };
  return withApp({ replies: { 'client-language': { current: 'de_DE', list: ['en_US', 'de_DE', 'fr_FR'], found: true }, 'client-language-set': () => setReply } }, async (app) => {
    await app.click('#navTools');
    await app.settle();
    const sel = app.$('#clientLang');
    assert.equal(sel.options.length, 3);
    assert.equal(sel.value, 'de_DE');
    await app.type(sel, 'fr_FR');
    await app.click('#clientLangSet');
    assert.deepEqual(last(app, 'client-language-set').args, ['fr_FR']);
    assert.match(app.$('#toast').textContent, /Close League first/);
    setReply = { ok: true };
    await app.click('#clientLangSet');
    assert.match(app.$('#toast').textContent, /League starts in .+ next time/);
  });
});

test('settings: Load by itself after a login is a switch that is saved; appear offline is gone (Riot\'s policies)', () => withApp({}, async (app) => {
  assert.equal(app.$('[data-setting="appearOffline"]'), null);
  const box = app.$('[data-setting="autoLoad"]');
  assert.ok(box);
  box.checked = false;
  box.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await app.settle();
  assert.deepEqual(last(app, 'set-setting').args, ['autoLoad', false]);
}));

test('panel: copy the login name, the password after Windows Hello – or the app password without it', () => {
  let passReply = { ok: false, noHello: true };
  const st = sampleState({ hasLock: true });
  return withApp({ state: st, replies: { 'copy-login': (id, what, pass) => (what === 'user' ? { ok: true } : pass ? { ok: true } : passReply) } }, async (app) => {
    app.w.openProfile(P(2));
    await app.settle();
    await app.click('[data-pcopy="user"]');
    assert.deepEqual(last(app, 'copy-login').args, [P(2), 'user', null]);
    assert.match(app.$('#toast').textContent, /Login name copied/);
    // no Windows Hello: the app password is asked, then it is copied
    await app.click('[data-pcopy="pass"]');
    assert.ok(app.visible('#passBox'));
    app.$('#passIn').value = 'apppassword';
    await app.submit('#passForm');
    assert.deepEqual(last(app, 'copy-login').args, [P(2), 'pass', 'apppassword']);
    assert.match(app.$('#toast').textContent, /Password copied/);
    // with Windows Hello (said no): nothing copied, no error note
    passReply = { ok: false, denied: true };
    const before = app.$('#toast').textContent;
    await app.click('[data-pcopy="pass"]');
    assert.equal(app.$('#toast').textContent, before);
  });
});

test('panel: no copy buttons for an account without a saved login', () => {
  const st = sampleState();
  st.accounts[2].hasCred = false;
  return withApp({ state: st }, async (app) => {
    app.w.openProfile(P(3));
    await app.settle();
    assert.equal(app.$('[data-pcopy]'), null);
  });
});

// a custom game on the ARAM map (Riot's queue 3270) and a real ARAM game
function mhGame(id, q, over = {}) {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: i === 0 ? P(1) : `x${i}`, name: 'N' + i, tag: 'EUW', team: i < 5 ? 100 : 200, champ: i + 1,
    lvl: 15, k: 3, d: 2, a: 4, cs: 60, gold: 9000, dmg: 20000, vis: 5, items: [0, 0, 0, 0, 0, 0, 0], spells: [4, 32], win: i < 5 }));
  return { id: String(id), t: Date.now() - id * 3600000, dur: 1300, q, mode: 'KIWI', remake: false, v: 6, players, ...over };
}

test('match history: a custom game on the ARAM map says "Custom" and has its own filter', () => {
  const games = [mhGame(1, 3270, { custom: true }), mhGame(2, 2400)];
  const replies = {
    matches: { index: games.map((g) => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': (ids) => games.filter((g) => ids.includes(g.id)),
  };
  return withApp({ replies }, async (app) => {
    await app.click('#navMatches');
    const labels = app.$$('.mh-row .mh-q').map((x) => x.textContent);
    assert.deepEqual(labels, ['Custom', 'ARAM']);
    assert.ok(app.$('[data-mhq="custom"]'), 'a Custom filter');
    await app.click('[data-mhq="custom"]');
    assert.equal(last(app, 'matches').args[0].queue, 'custom');
  });
});

test('player page: one game is "1 game", long names fit on one line', () => {
  const lite = [{ id: '900', t: Date.now() - 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 0, lite: true, k: '900:0.900',
    players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1', team: 100, champ: 4, pos: 'mid', win: true, k: 5, d: 1, a: 5, cs: 200, dmg: 20000, vis: 10, spells: [4, 14] }] }];
  const info = { puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', iconId: 7, level: 300, solo: null, flex: null };
  return withApp({ replies: { 'player-games': () => ({ ids: ['900'], games: lite, info, mastery: null, progress: { listed: true, done: 1, total: 1 } }),
    champions: [{ id: 4, name: 'Twisted Fate' }] } }, async (app) => {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', region: 'EUW' })`);
    await app.settle();
    await new Promise((r) => setTimeout(r, 30));
    await app.settle();
    const row = app.$('.ovc-champs .scr');
    assert.match(row.textContent, /Twisted Fate[\s\S]*1 game(?!s)/);
    assert.doesNotMatch(row.textContent, /1 games/);
    assert.equal(row.querySelector('.scr-n b').title, 'Twisted Fate');
  });
});

test('replay: right after "download" the client may still say "download" – the bar keeps downloading and asks again', () => {
  const games = [mhGame(1, 420)];
  let answers = ['download', 'download', 'downloading'];
  const replies = {
    matches: { index: games.map((g) => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': (ids) => games.filter((g) => ids.includes(g.id)),
    replay: (id, action) => ({ state: action === 'state' && answers.length === 3 ? 'download' : answers.shift() || 'downloading', progress: 30 }),
  };
  return withApp({ replies }, async (app) => {
    await app.click('#navMatches');
    await app.click(app.$('.mh-row .mh-meta'));
    await app.settle();
    assert.match(app.$('.rp-bar').textContent, /Download replay/);
    await app.click('[data-rpact="download"]');
    await app.settle();
    // the client said "download" again: still downloading, no button back
    assert.match(app.$('.rp-bar').textContent, /Downloading/);
    assert.equal(app.$('[data-rpact="download"]'), null);
    await new Promise((r) => setTimeout(r, 3300));
    await app.settle();
    assert.match(app.$('.rp-bar').textContent, /Downloading … 30 %/);
    assert.ok(app.called('replay').length >= 3, 'it went on asking');
  });
});

test('panel: copying with the app password – a wrong one says so, any other failure says it could not copy', () => {
  let reply = { ok: false, denied: true };
  return withApp({ state: sampleState({ hasLock: true }), replies: { 'copy-login': (id, what, pass) => (pass ? reply : { ok: false, noHello: true }) } }, async (app) => {
    app.w.openProfile(P(2));
    await app.settle();
    const viaApp = async () => {
      await app.click('[data-pcopy="pass"]');
      app.$('#passIn').value = 'apppassword';
      await app.submit('#passForm');
    };
    await viaApp();
    assert.match(app.$('#toast').textContent, /Wrong password/);
    reply = { ok: false, failed: true };
    await viaApp();
    assert.match(app.$('#toast').textContent, /Couldn't copy it/);
  });
});
