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
    await app.click(`#board .tile[data-id="${P(2)}"]`);
    // the panel's Login button: a small menu – edit the login, copy its name or password
    await app.click('#detail [data-d="login"]');
    assert.ok(app.$('#siteMenu [data-lg="edit"]'));
    await app.click('#siteMenu [data-pcopy="user"]');
    assert.deepEqual(last(app, 'copy-login').args, [P(2), 'user', null]);
    assert.match(app.$('#toast').textContent, /Login name copied/);
    // no Windows Hello: the app password is asked, then it is copied
    await app.click('#detail [data-d="login"]');
    await app.click('#siteMenu [data-pcopy="pass"]');
    assert.ok(app.visible('#passBox'));
    app.$('#passIn').value = 'apppassword';
    await app.submit('#passForm');
    assert.deepEqual(last(app, 'copy-login').args, [P(2), 'pass', 'apppassword']);
    assert.match(app.$('#toast').textContent, /Password copied/);
    // with Windows Hello (said no): nothing copied, no error note
    passReply = { ok: false, denied: true };
    const before = app.$('#toast').textContent;
    await app.click('#detail [data-d="login"]');
    await app.click('#siteMenu [data-pcopy="pass"]');
    assert.equal(app.$('#toast').textContent, before);
  });
});

test('panel: no copy buttons for an account without a saved login', () => {
  const st = sampleState();
  st.accounts[2].hasCred = false;
  return withApp({ state: st }, async (app) => {
    await app.click(`#board .tile[data-id="${P(3)}"]`);
    await app.click('#detail [data-d="login"]');
    assert.equal(app.$('[data-pcopy]'), null);
    assert.ok(app.$('#siteMenu [data-lg="edit"]'));
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
    await app.openMatches();
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
    const row = app.$('.pc-champs .oc-row:not(.all)');
    assert.match(row.textContent, /Twisted Fate[\s\S]*1 game(?!s)/);
    assert.doesNotMatch(row.textContent, /1 games/);
    assert.equal(row.querySelector('.oc-name b').title, 'Twisted Fate');
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
    await app.openMatches();
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
    await app.click(`#board .tile[data-id="${P(2)}"]`);
    const viaApp = async () => {
      await app.click('#detail [data-d="login"]');
      await app.click('#siteMenu [data-pcopy="pass"]');
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

test('match details: every player\'s augments (ARAM: Mayhem, Arena) in a column of their own, right of the gold', () => {
  const g = mhGame(5, 2400, { v: 7 });
  g.players.forEach((p, i) => { p.aug = [100 + i, 200 + i]; });
  const augments = {};
  for (let i = 0; i < 10; i++) { augments[100 + i] = ['/a.png', 'Aug A' + i, 'gold']; augments[200 + i] = ['/b.png', 'Aug B' + i, 'prismatic']; }
  const replies = {
    matches: { index: [[g.id, g.t, g.q, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [g],
    'mh-assets': { items: {}, spells: {}, perks: {}, styles: {}, augments },
  };
  return withApp({ replies }, async (app) => {
    await app.openMatches();
    await app.click(app.$('.mh-row .mh-meta'));
    await app.settle();
    assert.ok(app.$('.pg-table.with-aug'), 'the table gets the column');
    assert.match(app.$('.pg-cols').textContent, /Gold\s*Augments/);
    const rows = app.$$('.pg-row');
    assert.equal(rows.length, 10);
    for (const r of rows) assert.equal(r.querySelectorAll('.pg-aug .aug').length, 2);
    assert.equal(rows[6].querySelector('.pg-aug .aug').title, 'Aug A6', 'the other players\' augments too');
    assert.equal(app.$('.pg-items .aug'), null, 'not under the items any more');
  });
});

test('match history: the placement (MVP or #n) and score in the folded row; items and augments in places of their own', () => {
  const won = mhGame(1, 2400, { v: 7 });
  Object.assign(won.players[0], { k: 12, d: 0, a: 9, dmg: 45000, aug: [101, 102], multi: 2 });
  const lost = mhGame(2, 420, { v: 7 });
  lost.players.forEach((p) => { p.win = p.team === 200; });
  Object.assign(lost.players[0], { k: 0, d: 9, a: 1, dmg: 4000, gold: 5000 });
  const lite = { ...mhGame(3, 420), lite: true, players: [mhGame(3, 420).players[0]] };
  const games = [won, lost, lite];
  const replies = {
    matches: { index: games.map((g) => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': (ids) => games.filter((g) => ids.includes(g.id)),
  };
  return withApp({ replies }, async (app) => {
    await app.openMatches();
    const row = (id) => app.$(`.mh-row[data-gid="${id}"]`);
    assert.equal(row('1').querySelector('.mh-pl').firstChild.textContent, 'MVP');
    assert.ok(row('1').querySelector('.mh-pl').classList.contains('mvp'));
    assert.match(row('1').querySelector('.mh-pl b').textContent, /^(10|\d)\.\d$/, 'with the score');
    assert.match(row('2').querySelector('.mh-pl').firstChild.textContent, /^#\d+$/, 'the worst of the losers: a number');
    assert.equal(row('3').querySelector('.mh-pl'), null, 'a game from a list only: no placement');
    // items, augments and badges each in a place of its own – the items hold only the seven items
    const r1 = row('1');
    assert.equal(r1.querySelectorAll('.mh-items > *').length, 7);
    assert.equal(r1.querySelectorAll('.mh-aug-col .aug').length, 2);
    assert.match(r1.querySelector('.mh-badges').textContent, /MVP\s*[\d.]+\s*Double Kill/);
    assert.equal(row('2').querySelector('.mh-aug-col').children.length, 0, 'no augments: the place stays empty');
  });
});

test('match details: the score over the game – two players\' curves from 0 to 10, the pair shared with Compare', () => {
  const g = mhGame(6, 420, { v: 7, mode: 'CLASSIC' });
  // a timeline: 21 frames of gold and CS; player 0 kills player 5 early and often
  g.gold = Array.from({ length: 21 }, (_, m) => g.players.map((p, i) => 500 + m * (i === 0 ? 450 : 350)));
  g.csm = Array.from({ length: 21 }, (_, m) => g.players.map(() => m * 7));
  g.kills = Array.from({ length: 6 }, (_, k) => [120 + k * 150, 0, 5, [1], 50, 50]);
  Object.assign(g.players[0], { k: 6, d: 0, a: 2 });
  Object.assign(g.players[5], { k: 0, d: 6, a: 0 });
  Object.assign(g.players[1], { a: 10 });
  const replies = {
    matches: { index: [[g.id, g.t, g.q, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [g],
  };
  return withApp({ replies }, async (app) => {
    await app.openMatches();
    await app.click(app.$('.mh-row .mh-meta'));
    await app.settle();
    const plot = app.$('.mh-det .sc-plot');
    assert.ok(plot, 'the score section is open with the players');
    const a = plot.dataset.a.split(',').map(Number), b = plot.dataset.b.split(',').map(Number);
    assert.equal(a.length, 20, 'minute 1 … 19 and the end');
    assert.ok(a.every(v => v >= 0 && v <= 10) && b.every(v => v >= 0 && v <= 10));
    assert.ok(a[a.length - 1] > b[b.length - 1], 'me above the player I killed');
    // the last point is the score under the placement
    const myEm = app.$$('.mh-det .pg-row')[0].querySelector('.pg-pl em').textContent;
    assert.equal(a[a.length - 1].toFixed(1), myEm);
    assert.match(app.$('.mh-det .sc-end').textContent, new RegExp(myEm.replace('.', '\\.')));
    // another player in the score's own picker: the pair changes, Compare follows
    const sel = app.$('.mh-det [data-sec="score"] + .det-body [data-cmp="1"]');
    sel.value = '2';
    sel.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.equal(app.$('.mh-det [data-sec="score"] + .det-body [data-cmp="0"]').value, '0', 'the first one stays');
    assert.equal(app.$('.mh-det [data-sec="score"] + .det-body [data-cmp="1"]').value, '2');
    // hovering any player's number: a small window with that player's score and curve
    const hover = (el, type = 'mouseover') => el.dispatchEvent(new app.w.MouseEvent(type, { bubbles: true }));
    const pop = app.$('#scPop');
    for (const k of [0, 5, 7]) {
      const badge = app.$$('.mh-det .pg-row')[k].querySelector('.pg-pl');
      hover(badge);
      assert.equal(pop.hidden, false, 'every player');
      assert.equal(pop.querySelector('.sp-head em').textContent, badge.querySelector('em').textContent, 'the same score');
      assert.ok(pop.querySelector('.sp-plot polyline'), 'with the curve');
      assert.ok(pop.querySelectorAll('.sp-phases span').length >= 2, 'early, mid game …');
      hover(badge, 'mouseout');
      assert.equal(pop.hidden, true);
    }
    // the number in the game's row too
    hover(app.$('.mh-row .mh-pl'));
    assert.equal(pop.hidden, false);
    assert.match(pop.querySelector('.sp-foot').textContent, /MVP|#\d+ of 10/);
    assert.deepEqual(app.errors.map(String), []);
  });
});

test('match details: Columns – the figures of the table chosen by the user (up to five, kept)', () => {
  const g = mhGame(5, 420, { v: 7 });
  g.players.forEach((p, i) => { p.x = { taken: 10000 + i, heal: 1000 * i }; });
  const replies = {
    matches: { index: [[g.id, g.t, g.q, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [g],
  };
  return withApp({ replies }, async (app) => {
    await app.openMatches();
    await app.click(app.$('.mh-row .mh-meta'));
    await app.settle();
    const heads = () => app.$$('.pg-cols > span').slice(7).map(s => s.textContent);
    assert.deepEqual(heads(), ['Damage dealt', 'Damage taken', 'Gold']);
    await app.click('[data-pgcols]');
    assert.equal(app.$('#pgColMenu').hidden, false);
    await app.click('#pgColMenu [data-pgcol="heal"]');
    assert.deepEqual(heads(), ['Damage dealt', 'Damage taken', 'Gold', 'Healing']);
    assert.equal(app.w.localStorage.getItem('rs.pgCols'), JSON.stringify(['dmg', 'taken', 'gold', 'heal']));
    assert.equal(app.$$('.pg-row')[3].querySelectorAll('.pg-b')[3].querySelector('b').textContent, '3k');
    // a figure the game doesn't have (no objectives stored): "–" in every row
    await app.click('#pgColMenu [data-pgcol="obj"]');
    assert.equal(app.$$('.pg-row')[0].querySelectorAll('.pg-b')[4].textContent, '–');
    // five at most: the others can't be picked
    assert.ok(app.$('#pgColMenu [data-pgcol="cc"]').disabled);
    // gold off, then back to the default
    await app.click('#pgColMenu [data-pgcol="gold"]');
    assert.deepEqual(heads(), ['Damage dealt', 'Damage taken', 'Healing', 'Objective damage']);
    await app.click('#pgColMenu [data-pgcol=""]');
    assert.deepEqual(heads(), ['Damage dealt', 'Damage taken', 'Gold']);
    // a click elsewhere closes it
    await app.click('.pg-cols');
    assert.equal(app.$('#pgColMenu').hidden, true);
  });
});

test('match history: Arena (queue 1750, mode CHERRY) says "Arena" and shows its six teams by placing', () => {
  // 18 players, six teams of three: placings 1–6, the top three win
  const players = Array.from({ length: 18 }, (_, i) => ({ puuid: i === 0 ? P(1) : `x${i}`, name: 'N' + i, tag: 'EUW', team: i < 9 ? 100 : 200, champ: i + 1,
    lvl: 18, k: 3, d: 2, a: 4, cs: 10, gold: 9000, dmg: 20000, vis: 0, items: [0, 0, 0, 0, 0, 0, 0], spells: [4, 32], place: Math.floor(i / 3) + 1, win: i < 9 }));
  const games = [{ id: '1', t: Date.now() - 3600000, dur: 1400, q: 1750, mode: 'CHERRY', remake: false, v: 7, players }];
  const replies = {
    matches: { index: games.map((g) => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': (ids) => games.filter((g) => ids.includes(g.id)),
  };
  return withApp({ replies }, async (app) => {
    await app.openMatches();
    assert.deepEqual(app.$$('.mh-row .mh-q').map((x) => x.textContent), ['Arena']);
    await app.click(app.$('.mh-row .mh-meta'));
    await app.settle();
    const heads = app.$$('.mh-det .pg-head');
    assert.equal(heads.length, 6, 'six teams, not red and blue');
    assert.deepEqual(heads.map((h) => h.querySelector('.pg-side').textContent), ['Place 1', 'Place 2', 'Place 3', 'Place 4', 'Place 5', 'Place 6']);
    assert.ok(heads[0].classList.contains('win') && heads[3].classList.contains('loss'));
    assert.equal(app.$$('.mh-det .pg-row').length, 18);
  });
});
