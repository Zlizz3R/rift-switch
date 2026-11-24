// Click tests: the real window in jsdom (see harness.js), every feature clicked like a user would.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, sampleState, P } = require('./harness');

const tile = (app, i) => app.$(`#board .tile[data-id="${P(i)}"]`);
const lastCall = (app, ch) => app.called(ch).slice(-1)[0];
async function withApp(opts, fn) {
  const app = await boot(opts);
  try {
    await fn(app);
    assert.deepEqual(app.errors.map(String), [], 'no script errors');
  } finally { app.close(); }
}

// ---------- accounts page ----------
test('boots: every account is a tile, no count and no "click a tile" line', () => withApp({}, async (app) => {
  assert.equal(app.$$('#board .tile[data-id]').length, 4);
  assert.equal(app.$('#count'), null);
  assert.equal(app.$('[data-i18n="head.sub"]'), null);
  assert.ok(app.$('section.cat [data-cat-name], section.cat .cat-head'), 'categories are drawn');
}));

test('a click selects the tile and opens it in the detail panel', () => withApp({}, async (app) => {
  await app.click(tile(app, 3));
  assert.match(app.$('#detail').textContent, /Player3/);
  assert.ok(tile(app, 3).classList.contains('selected'));
}));

test('a double click asks and then switches', () => withApp({}, async (app) => {
  await app.click(tile(app, 3));
  await app.click(tile(app, 3));
  assert.ok(app.visible('#confirm'), 'confirmation shown');
  assert.ok(!app.visible('#confirmDanger'), 'no empty red bar in the switch question');
  await app.click('#confirmYes');
  assert.equal(lastCall(app, 'switch').args[0], P(3));
}));

test('the switch button in the detail panel switches; "Cancel" does nothing', () => withApp({}, async (app) => {
  await app.click(tile(app, 2));
  await app.click('#dSwitch');
  await app.click('#confirmNo');
  assert.equal(app.called('switch').length, 0);
  await app.click('#dSwitch');
  await app.click('#confirmYes');
  assert.equal(lastCall(app, 'switch').args[0], P(2));
}));

test('without "confirm switch" a double click switches right away', () => withApp({ state: sampleState({ settings: { ...sampleState().settings, confirmSwitch: false } }) }, async (app) => {
  await app.click(tile(app, 3));
  await app.click(tile(app, 3));
  assert.equal(lastCall(app, 'switch').args[0], P(3));
}));

// ---------- several at once ----------
test('Ctrl+click picks several tiles; the panel offers note / move / open with / remove; Esc clears', () => withApp({}, async (app) => {
  await app.click(tile(app, 1));
  await app.click(tile(app, 3), { ctrlKey: true });
  assert.match(app.$('#detail').textContent, /2 accounts selected/);
  assert.ok(tile(app, 1).classList.contains('picked') && tile(app, 3).classList.contains('picked'));
  assert.deepEqual(app.$$('#detail [data-m]').map((b) => b.dataset.m), ['note', 'move', 'open', 'remove', 'clear']);
  await app.key('Escape');
  assert.doesNotMatch(app.$('#detail').textContent, /accounts selected/);
}));

test('Shift+click picks a range in board order', () => withApp({}, async (app) => {
  const order = app.$$('#board .tile[data-id]').map((t) => t.dataset.id);
  await app.click(app.$(`#board .tile[data-id="${order[0]}"]`));
  await app.click(app.$(`#board .tile[data-id="${order[2]}"]`), { shiftKey: true });
  assert.equal(app.$$('#board .tile.picked').length, 3);
}));

test('picked tiles: move them all into a category with one save', () => withApp({}, async (app) => {
  await app.click(tile(app, 1));
  await app.click(tile(app, 3), { ctrlKey: true });
  await app.click('#detail [data-m="move"]');
  await app.click('#siteMenu [data-cat="c1"]');
  const list = lastCall(app, 'arrange').args[0];
  assert.equal(list.find((x) => x.puuid === P(1)).category, 'c1');
  assert.equal(list.find((x) => x.puuid === P(3)).category, 'c1');
}));

test('picked tiles: removing asks with the red warning, then removes each', () => withApp({}, async (app) => {
  await app.click(tile(app, 1));
  await app.click(tile(app, 3), { ctrlKey: true });
  await app.click('#detail [data-m="remove"]');
  assert.ok(app.visible('#confirmDanger'), 'red warning');
  await app.click('#confirmYes');
  assert.deepEqual(app.called('remove').map((c) => c.args[0]).sort(), [P(1), P(3)].sort());
}));

test('picked tiles: "open with" – op.gg multi-search first, other sites a tab each', () => withApp({}, async (app) => {
  await app.click(tile(app, 1));
  await app.click(tile(app, 2), { ctrlKey: true });
  await app.click('#detail [data-m="open"]');
  assert.equal(app.$$('#siteMenu [data-site]')[0].dataset.site, 'multi', 'multi-search first');
  await app.click('#siteMenu [data-site="multi"]');
  assert.deepEqual(lastCall(app, 'open-multi').args[1], ['Player1#EUW', 'Player2#EUW']);
  const before = app.called('open-external').length;
  await app.click('#detail [data-m="open"]');
  await app.click('#siteMenu [data-site="poro"]');
  assert.equal(app.called('open-external').length - before, 2, 'one tab per account');
}));

test('picked tiles: one note for all of them', () => withApp({}, async (app) => {
  await app.click(tile(app, 1));
  await app.click(tile(app, 3), { ctrlKey: true });
  await app.click('#detail [data-m="note"]');
  assert.ok(app.visible('#textBox'));
  app.$('#textIn').value = 'Main';
  await app.submit('#textForm');
  assert.deepEqual(app.called('note').map((c) => c.args).sort(), [[P(1), 'Main'], [P(3), 'Main']]);
}));

test('a box drawn over the board picks every tile it touches', () => withApp({}, async (app) => {
  const { w } = app;
  // tiles 1-3 side by side, 200 px wide
  app.$$('#board .tile[data-id]').forEach((t, i) => (t.getBoundingClientRect = () => ({ left: i * 220, right: i * 220 + 200, top: 0, bottom: 200, width: 200, height: 200 })));
  const m = (type, x, y, target) => (target || w.document).dispatchEvent(new w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  m('mousedown', 5, 5, app.$('#board'));
  m('mousemove', 230, 190);   // all of tile 1, 10 px of tile 2, nothing of tile 3
  const hits = app.$$('.tile.box-hit').map((t) => t.dataset.id);
  assert.equal(hits.length, 2, 'shown while dragging');
  assert.ok(app.$('.select-box'));
  m('mouseup', 230, 190);
  await app.settle();
  assert.equal(app.$('.select-box'), null);
  assert.match(app.$('#detail').textContent, /2 accounts selected/);
}));

test('tiles: a PBE account shows the test server box instead of "Unranked"; a penalty shows its time left', () => {
  const st = sampleState();
  st.accounts[1].region = 'PBE';
  st.accounts[1].solo = null; st.accounts[1].flex = null;
  st.accounts[2].penalties = { at: Date.now(), list: [{ code: 'PlayerTimedRestriction', until: Date.now() + 5 * 60000 }] };
  st.accounts[0].lowPrio = { games: 2, perGame: 60, at: Date.now() };
  return withApp({ state: st }, async (app) => {
    const pbe = tile(app, 2);
    assert.ok(pbe.querySelector('.pbe-box'), 'test server box');
    assert.doesNotMatch(pbe.textContent, /Unranked/);
    const pen = tile(app, 3).querySelector('.tile-pen');
    assert.ok(pen, 'penalty on the tile');
    assert.match(pen.textContent, /Penalty/);
    assert.match(pen.textContent, /[45]:\d\d left/);
    const low = tile(app, 1).querySelector('.tile-pen');
    assert.match(low.textContent, /Low priority\s*2 games · 1 min each/, 'games and minutes, no countdown');
    assert.equal(tile(app, 4).querySelector('.tile-pen'), null);
  });
});

test('the board draws before views.js has loaded (the first state can come that early)', async () => {
  const st = sampleState();
  st.accounts[2].lowPrio = { games: 1, perGame: 60, at: Date.now() };
  st.accounts[1].region = 'PBE';
  const app = await boot({ state: st, upTo: 'renderer.js' });
  try {
    assert.deepEqual(app.errors.map(String), []);
    assert.equal(app.$$('#board .tile[data-id]').length, 4);
    assert.ok(app.$('.tile-pen') && app.$('.pbe-box'));
  } finally { app.close(); }
});

test('logging in shows every step; hide keeps it away, cancel stops it', () => withApp({}, async (app) => {
  const st = app.S.state;
  await app.push({ ...st, switching: { id: P(2), n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: 'signin', detail: 'typing' } });
  assert.ok(app.visible('#swBox'));
  const li = app.$$('#swSteps li');
  assert.equal(li.length, 5);
  assert.deepEqual(li.map((x) => x.className), ['done', 'done', 'now', '', '']);
  assert.match(li[2].textContent, /Entering the login/);
  assert.match(app.$('#swName').textContent, /Player2/);
  await app.click('#swHide');
  assert.ok(!app.visible('#swBox'), 'hidden for this login');
  await app.push({ ...st, switching: { id: P(2), n: 2, steps: ['play', 'launch'], step: 'play', detail: '' } });
  assert.ok(app.visible('#swBox'), 'the next login shows again');
  await app.click('#swCancel');
  assert.equal(app.called('cancel-switch').length, 1);
}));

// ---------- drag & drop ----------
test('dragging shows a line before/after the tile and slides the tile in there', () => withApp({}, async (app) => {
  const { w } = app;
  const ev = (type, el, x) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = { effectAllowed: '', setData() {} };
    e.clientX = x;
    el.dispatchEvent(e);
  };
  ev('dragstart', tile(app, 1), 0);
  await app.settle();   // the board is drawn again (drop zones): measure the new tile
  tile(app, 3).getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 100 });
  ev('dragover', tile(app, 3), 250);
  assert.ok(tile(app, 3).classList.contains('ins-after'), 'line after the tile');
  ev('dragover', tile(app, 3), 120);
  assert.ok(tile(app, 3).classList.contains('ins-before'), 'line before the tile');
  ev('drop', tile(app, 3), 250);
  await app.settle();
  const order = lastCall(app, 'arrange').args[0].map((x) => x.puuid);
  assert.ok(order.indexOf(P(1)) === order.indexOf(P(3)) + 1, 'dropped right after tile 3');
}));

// ---------- adding ----------
test('add: a Riot ID alone is enough; a half login is refused', () => withApp({ replies: { 'add-saved': { ok: true, noLogin: true, found: true, puuid: P(9) } } }, async (app) => {
  await app.click('#addAcc');
  app.$('#addUser').value = 'onlyuser';
  await app.submit('#addForm');
  assert.equal(app.called('add-saved').length, 0, 'user without password: not sent');
  assert.match(app.$('#toast').textContent, /.+/);
  app.$('#addUser').value = '';
  app.$('#addRiotId').value = 'https://op.gg/summoners/euw/Faker-KR1';
  await app.submit('#addForm');
  assert.deepEqual(lastCall(app, 'add-saved').args[0], { riotId: 'https://op.gg/summoners/euw/Faker-KR1', u: '', p: '' });
}));

test('add: with a login it is saved with user and password', () => withApp({}, async (app) => {
  await app.click('#addAcc');
  app.$('#addUser').value = 'me';
  app.$('#addPass').value = 'pw';
  await app.submit('#addForm');
  assert.deepEqual(lastCall(app, 'add-saved').args[0], { riotId: '', u: 'me', p: 'pw' });
}));

// ---------- login details ----------
test('login details: a known Riot ID shows read-only; a saved login without one can get it', () => withApp({ replies: { 'get-cred-user': 'me' } }, async (app) => {
  await app.click(tile(app, 1));
  await app.click('#detail [data-d="login"]');
  assert.ok(app.visible('#credBox'));
  assert.equal(app.$('#credRiotId').value, 'Player1#EUW');
  assert.ok(app.$('#credRiotId').readOnly);
  await app.click('#credCancel');
  await app.click(tile(app, 4));
  await app.click('#detail [data-d="login"]');
  assert.equal(app.$('#credRiotId').readOnly, false);
  app.$('#credRiotId').value = 'New#EUW';
  app.$('#credPass').value = 'pw';
  await app.submit('#credForm');
  assert.equal(lastCall(app, 'set-cred').args[1].riotId, 'New#EUW');
}));

test('login details: the eye shows the saved password after Windows confirms', () => withApp({ replies: { 'get-cred-user': 'me', 'reveal-pass': { ok: true, p: 'Müller€' } } }, async (app) => {
  await app.click(tile(app, 1));
  await app.click('#detail [data-d="login"]');
  await app.click('[data-eye="credPass"]');
  assert.equal(lastCall(app, 'reveal-pass').args[0], P(1));
  assert.equal(app.$('#credPass').value, 'Müller€');
  assert.equal(app.$('#credPass').type, 'text');
}));

test('login details: without Windows Hello the app password is asked', () => withApp({
  state: sampleState({ hasLock: true }),
  replies: { 'get-cred-user': 'me', 'reveal-pass': (id, pass) => (pass ? { ok: true, p: 'secret' } : { ok: false, noHello: true }) },
}, async (app) => {
  await app.click(tile(app, 1));
  await app.click('#detail [data-d="login"]');
  await app.click('[data-eye="credPass"]');
  assert.ok(app.visible('#passBox'), 'app password asked');
  app.$('#passIn').value = '1234';
  await app.submit('#passForm');
  assert.equal(lastCall(app, 'reveal-pass').args[1], '1234');
  assert.equal(app.$('#credPass').value, 'secret');
}));

test('login details: cancelling Windows Hello leaves the field empty', () => withApp({ replies: { 'get-cred-user': 'me', 'reveal-pass': { ok: false } } }, async (app) => {
  await app.click(tile(app, 1));
  await app.click('#detail [data-d="login"]');
  await app.click('[data-eye="credPass"]');
  assert.equal(app.$('#credPass').value, '');
  assert.equal(app.$('#credPass').type, 'password');
}));

// ---------- settings ----------
test('settings: groups are closed; one opens at a time; arrows survive a language change', () => withApp({}, async (app) => {
  await app.click('#navSettings');
  const heads = app.$$('.set-g');
  assert.ok(heads.length >= 5);
  assert.equal(app.$$('.set-g.open').length, 0);
  await app.click(heads[0]);
  await app.click(heads[2]);
  assert.deepEqual(app.$$('.set-g.open').map((h) => heads.indexOf(h)), [2]);
  assert.match(heads[2].textContent, /Privacy & Security/);
  await app.push({ ...app.S.state, settings: { ...app.S.state.settings, lang: 'de' } });
  assert.ok(app.$$('.set-g .chev').length === heads.length, 'arrows still there');
  assert.match(app.$$('.set-g')[2].textContent, /Privatsphäre & Sicherheit/);
}));

test('settings: switches send their setting', () => withApp({}, async (app) => {
  await app.click('#navSettings');
  for (const cb of app.$$('[data-setting]')) {
    cb.checked = !cb.checked;
    cb.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await app.settle();
    assert.equal(lastCall(app, 'set-setting').args[0], cb.dataset.setting);
  }
}));

test('settings: the seal switch only with an app lock, and asks the app password', () => withApp({}, async (app) => {
  assert.ok(!app.visible('#sealBtn'));
  await app.push(sampleState({ hasLock: true }));
  await app.click('#navSettings');
  assert.ok(app.$('#sealBtn').hidden === false);
  await app.click('#sealBtn');
  app.$('#passIn').value = '1234';
  await app.submit('#passForm');
  assert.deepEqual(lastCall(app, 'lock').args.slice(0, 2), ['seal', '1234']);
}));

test('settings: app lock set / now / off', () => withApp({}, async (app) => {
  await app.click('#lockBtn');
  app.$('#passIn').value = 'abcd';
  app.$('#passAgain').value = 'abcd';
  await app.submit('#passForm');
  assert.deepEqual(lastCall(app, 'lock').args.slice(0, 2), ['set', 'abcd']);
  await app.push(sampleState({ hasLock: true }));
  await app.click('#lockNow');
  assert.deepEqual(lastCall(app, 'lock').args.slice(0, 1), ['now']);
  await app.click('#lockOff');
  app.$('#passIn').value = 'abcd';
  await app.submit('#passForm');
  assert.deepEqual(lastCall(app, 'lock').args.slice(0, 2), ['off', 'abcd']);
}));

test('a locked app asks for the password and sends it', () => withApp({ state: sampleState({ locked: true, hasLock: true, accounts: [] }), replies: { unlock: true } }, async (app) => {
  assert.ok(app.visible('#passBox'));
  app.$('#passIn').value = '1234';
  await app.submit('#passForm');
  assert.equal(lastCall(app, 'unlock').args[0], '1234');
}));

// ---------- help ----------
test('every "?" opens its help page; Esc closes it', () => withApp({}, async (app) => {
  for (const topic of ['tools', 'live', 'mh']) {
    await app.click(`[data-help="${topic}"]`);
    assert.ok(app.visible('#helpBox'), topic);
    assert.ok(app.$$('#helpBody h3').length >= 2, topic + ' has sections');
    await app.key('Escape');
    assert.ok(!app.visible('#helpBox'));
  }
}));

// ---------- live page ----------
test('live page: only real penalties, with time left; a queue wait shows in the title bar', () => withApp({}, async (app) => {
  const st = sampleState({ live: { clientUp: true, puuid: P(1), phase: 'Lobby', waits: [{ code: 'LowPriorityQueue', until: Date.now() + 120000 }] } });
  st.accounts[0].penalties = { at: Date.now(), list: [{ code: 'LowPriorityQueue', until: Date.now() + 120000 }, { code: 'Unknown', until: 0 }, { code: 'GameVersionMissing', until: 0 }] };
  await app.push(st);
  assert.match(app.$('#live').textContent, /Wait \d:\d\d/);
  await app.click('#navLive');
  const rows = app.$$('.pen-row');
  assert.equal(rows.length, 1, 'Unknown / GameVersionMissing are no penalties');
  assert.match(rows[0].textContent, /left/);
  await app.click('[data-help="helper"]');
  assert.ok(app.visible('#helpBox'));
}));

test('live page after a game: the last game with both teams, MVP / ACE, bars with the best = 100 %; opens in the match history', () => {
  const pl = (i) => ({ puuid: i === 0 ? P(1) : 'x' + i, name: 'N' + i, tag: 'EUW', team: i < 5 ? 100 : 200, win: i < 5, champ: i + 1, lvl: 12, k: i, d: 2, a: 3, cs: 150 + i,
    gold: 9000 + i * 100, dmg: 10000 + i * 1000, vis: 20, spells: [4, 14], keystone: 8112, sub: 8300, items: [3031, 0, 0, 0, 0, 0, 3340], x: { taken: 20000 + i * 500 } });
  const game = { id: '77', t: Date.now() - 40 * 60000, dur: 1800, q: 420, players: Array.from({ length: 10 }, (_, i) => pl(i)),
    teams: [{ id: 100, towers: 8, bans: [157, 238] }, { id: 200, towers: 3, bans: [] }] };
  const st = sampleState({ live: { clientUp: true, puuid: P(1), phase: 'EndOfGame', waits: [] } });
  return withApp({ state: st, replies: { live: { clientUp: true, phase: 'EndOfGame' }, matches: { index: [['77', game.t, 420, P(1)]], waiting: 0 }, 'matches-get': [game] } }, async (app) => {
    await app.click('#navLive');
    await new Promise((r) => setTimeout(r, 60));
    await app.settle();
    assert.ok(app.$('.pg-card'), 'the card shows');
    const rows = app.$$('.pg-row');
    assert.equal(rows.length, 10);
    assert.ok(rows[0].classList.contains('me'), 'my own row is marked');
    assert.equal(app.$$('.pg-pl.mvp').length, 1);
    assert.ok(rows.slice(0, 5).some((r) => r.querySelector('.pg-pl.mvp')), 'MVP is on the winning side');
    assert.ok(rows.slice(5).some((r) => r.querySelector('.pg-pl.ace')), 'ACE is on the losing side');
    assert.equal(app.$$('.pg-bans img').length, 2);
    assert.doesNotMatch(app.$('#liveBody').textContent, /Nothing going on/i);
    // the best damage (the last player) fills its bar
    const widths = app.$$('.pg-bar.red i').map((i) => i.style.width);
    assert.equal(widths[widths.length - 1], '100%');
    await app.click('#pgOpen');
    assert.equal(app.w.eval('view'), 'matches');
  });
});

test('champ select helper: one counters page per enemy ranks the pool; pre-load scans the pool; enemy picks are clickable', () => {
  const champs = [{ id: 1, name: 'Garen' }, { id: 2, name: 'Darius' }, { id: 3, name: 'Illaoi' }, { id: 4, name: 'Malphite' }, { id: 5, name: "Cho'Gath" }];
  // counterstats: who does well against <enemy>
  const pages = {
    Darius: [{ name: 'Garen', wr: 48, rating: 4.1 }, { name: 'Illaoi', wr: 53, rating: 5.2 }],
    Malphite: [{ name: 'Garen', wr: 51, rating: 5.0 }],
    Garen: [{ name: 'Darius', wr: 52 }, { name: 'Malphite', wr: 49 }],
    Illaoi: [{ name: 'Darius', wr: 47 }, { name: "Cho'Gath", wr: 50 }],
  };
  const st = sampleState();
  st.settings.champPool = [1, 3];
  return withApp({ state: st, replies: { champions: champs, counters: (enemy) => ({ ok: true, list: pages[enemy] || [] }) } }, async (app) => {
    await app.click('#navLive');
    assert.match(app.$('.helper').textContent, /My champion pool/);
    assert.equal(app.$$('.h-chip').length, 2);
    await app.type('#hEnemy', 'Darius');
    await new Promise((r) => setTimeout(r, 100));
    await app.settle();
    assert.deepEqual(app.called('counters').map((c) => c.args[0]), ['Darius'], 'one request for the whole pool');
    assert.deepEqual(app.$$('.h-res b').map((x) => x.textContent), ['Illaoi', 'Garen'], 'best first');
    assert.match(app.$('.helper').textContent, /Best picks against Darius/);
    await app.click('#hPre');
    await new Promise((r) => setTimeout(r, 200));
    await app.settle();
    const asked = app.called('counters').map((c) => c.args[0]);
    for (const n of ['Garen', 'Illaoi', 'Malphite', "Cho'Gath"]) assert.ok(asked.includes(n), 'pre-load reaches ' + n);
    assert.equal(asked.filter((n) => n === 'Darius').length, 1, 'nothing asked twice');
  });
});

test('champ select helper: "who are you playing against?" shows the enemy picks, a click chooses one', () => {
  const champs = [{ id: 1, name: 'Garen' }, { id: 2, name: 'Darius' }, { id: 4, name: 'Malphite' }];
  const st = sampleState();
  st.settings.champPool = [1];
  const live = { clientUp: true, phase: 'ChampSelect', region: 'EUW', me: 'x',
    champSelect: { myPosition: 'top', hiddenNames: true, allies: [], enemies: [{ championId: 2, position: 'jungle' }, { championId: 4, position: 'mid' }, { championId: 0 }] } };
  return withApp({ state: st, replies: { champions: champs, live, counters: () => ({ ok: true, list: [{ name: 'Garen', wr: 50 }] }) } }, async (app) => {
    await app.click('#navLive');
    await new Promise((r) => setTimeout(r, 100));
    await app.settle();
    assert.match(app.$('.helper').textContent, /Who are you playing against\?/);
    assert.equal(app.$$('.h-pick').length, 2, 'only champions already picked');
    await app.click('[data-hpick="4"]');
    assert.equal(app.$('#hEnemy').value, 'Malphite');
    assert.ok(app.$('[data-hpick="4"]').classList.contains('on'));
  });
});

test('champ select helper: Riot hides the enemy positions – the enemy who plays my lane most is guessed and chosen', () => {
  const champs = [{ id: 1, name: 'Garen' }, { id: 2, name: 'Darius' }, { id: 4, name: 'Malphite' }, { id: 5, name: 'Ahri' }];
  const st = sampleState();
  st.settings.champPool = [1];
  st.settings.lane = 'top';
  const share = { Darius: 88, Malphite: 40, Ahri: 2 };
  const live = { clientUp: true, phase: 'ChampSelect', region: 'EUW', me: 'x',
    champSelect: { myPosition: 'top', hiddenNames: true, allies: [], enemies: [{ championId: 4, position: '' }, { championId: 2, position: '' }, { championId: 5, position: '' }] } };
  return withApp({ state: st, replies: { champions: champs, live, counters: (n) => ({ ok: true, share: share[n], list: [{ name: 'Garen', wr: 50 }] }) } }, async (app) => {
    await app.click('#navLive');
    await new Promise((r) => setTimeout(r, 200));
    await app.settle();
    assert.ok(app.$('[data-hpick="2"] .h-guess'), 'Darius marked as the likely laner');
    assert.equal(app.$$('.h-guess').length, 1);
    assert.equal(app.$('#hEnemy').value, 'Darius', 'and chosen');
    await app.click('[data-hpick="4"]');
    await new Promise((r) => setTimeout(r, 50));
    await app.settle();
    assert.equal(app.$('#hEnemy').value, 'Malphite', 'a click wins over the guess');
  });
});

// ---------- tools ----------
test('tools: every card runs its tool', () => withApp({}, async (app) => {
  await app.click('#navTools');
  for (const b of app.$$('[data-tool]')) {
    await app.click(b);
    assert.equal(lastCall(app, 'tool').args[0], b.dataset.tool);
  }
}));

// ---------- match history ----------
function game(id, over = {}) {
  const pl = (i) => ({ puuid: i === 0 ? P(1) : 'x' + i + '-0000-0000-0000-000000000000'.slice(0, 33), name: 'N' + i, tag: 'EUW', team: i < 5 ? 100 : 200, champ: i + 1, lvl: 15,
    k: i, d: 2, a: 3, cs: 150, gold: 10000 + i * 100, dmg: 20000, vis: 20, items: [1, 0, 0, 0, 0, 0, 3340], spells: [4, 14], keystone: 8112, sub: 8300,
    win: i < 5, multi: i === 0 ? 5 : 0, pos: ['top', 'jungle', 'mid', 'bot', 'support'][i % 5], x: { taken: 15000, wards: 9 } });
  return { id: String(id), t: Date.now() - id * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 3,
    players: Array.from({ length: 10 }, (_, i) => pl(i)), teams: [{ id: 100, towers: 5 }, { id: 200, towers: 2 }], ...over };
}
const mhReplies = (games) => ({
  matches: { index: games.map((g) => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
  'matches-get': (ids) => games.filter((g) => ids.includes(g.id)),
  'mh-storage': { bytes: 4096, games: games.length },
});

test('match history: games load once (index, then only missing ones); blue left', () => withApp({ replies: mhReplies([game(1), game(2)]) }, async (app) => {
  await app.click('#navMatches');
  assert.equal(app.$$('.mh-row').length, 2);
  assert.deepEqual(lastCall(app, 'matches-get').args[0].sort(), ['1', '2']);
  const before = app.called('matches-get').length;
  await app.emit('matches-changed');
  await new Promise((r) => setTimeout(r, 1300));
  await app.settle();
  assert.equal(app.called('matches-get').length, before, 'nothing fetched twice');
  const firstName = app.$('.mh-row .mh-c.nm.l');
  assert.equal(firstName.textContent, 'N0', 'blue side (100) on the left');
  assert.match(app.$('#mhStoreText').textContent, /4 KB · 2 games/);
}));

test('match history: a click opens the details (not on a name); names open "open with"', () => withApp({ replies: mhReplies([game(1)]) }, async (app) => {
  await app.click('#navMatches');
  await app.click(app.$('.mh-row .mh-c.nm'));
  assert.equal(app.$('.mh-det'), null, 'name click does not open details');
  assert.ok(app.visible('#siteMenu'));
  await app.click(app.$('.mh-row .mh-kda') || app.$('.mh-row .mh-meta'));
  assert.ok(app.$('.mh-det'), 'details open');
  assert.equal(app.$$('.mh-det .pg-row').length, 10, 'players open at first, as the post-game table');
  assert.ok(app.$('.mh-det .pg-pl.mvp') && app.$('.mh-det .pg-pl.ace'), 'MVP and ACE');
  const lanes = app.$$('.mh-det .pg-lane');
  assert.equal(lanes.length, 10, 'a lane factor for everyone with a position');
  assert.ok(lanes[0].classList.contains('down') && lanes[5].classList.contains('up'), 'top N0 (0 kills) lost his lane to N5');
  assert.equal(app.$('.det-h2h'), null, 'other sections folded');
  assert.deepEqual(app.$$('.det-g').map((h) => h.dataset.sec), ['players', 'h2h', 'compare'], 'no gold section without a timeline');
  await app.click('[data-sec="h2h"]');
  assert.ok(app.$('.det-h2h'), 'lane vs lane opens');
  assert.ok(app.$('.mh-det'), 'a section head does not close the game');
  await app.click('[data-sec="players"]');
  assert.equal(app.$$('.mh-det .pg-row').length, 0, 'players fold');
  await app.click(app.$('.mh-row .mh-meta'));
  assert.equal(app.$('.mh-det'), null, 'closes again');
}));

test('positions: Riot\'s wrong guesses are fixed (Smite = jungle, support item = support); the lane factor compares the right players', () => withApp({}, async (app) => {
  const g = game(1);
  const [top, jgl, mid, bot, sup] = g.players.slice(0, 5);
  // Riot said: both top and jungler "top", bot "support" and support "bot"
  jgl.pos = 'top'; jgl.spells = [4, 11];
  bot.pos = 'support'; sup.pos = 'bot'; sup.items = [3867, 0, 0, 0, 0, 0, 3364]; sup.cs = 30;
  const ro = app.w.gameRoles(g);
  assert.equal(ro.get(top), 'top');
  assert.equal(ro.get(jgl), 'jungle');
  assert.equal(ro.get(mid), 'mid');
  assert.equal(ro.get(bot), 'bot');
  assert.equal(ro.get(sup), 'support');
  assert.equal(app.w.pgOpponent(g, top), g.players[5], 'top against the enemy top, not the jungler');
  assert.ok(app.w.pgLane(g, top).mult >= 0.6 && app.w.pgLane(g, top).mult <= 1.4);
  assert.equal(app.w.gameRoles({ ...g, mode: 'ARAM' }), null, 'no positions in ARAM');
}));

test('match history: the lists above show 5, "+5" five more, "less" back to 5', () => {
  const games = Array.from({ length: 12 }, (_, k) => { const g = game(k + 1); g.players[0].champ = 100 + k; return g; });
  return withApp({ replies: mhReplies(games) }, async (app) => {
    await app.click('#navMatches');
    const champs = () => app.$$('[data-mhchamp]').length;
    assert.equal(champs(), 5);
    assert.equal(app.$('[data-mhmore="champ"]').textContent, 'Show more (5)');
    await app.click('[data-mhmore="champ"]');
    assert.equal(champs(), 10);
    assert.equal(app.$('[data-mhmore="champ"]').textContent, 'Show more (2)');
    await app.click('[data-mhmore="champ"]');
    assert.equal(champs(), 12);
    assert.equal(app.$('[data-mhmore="champ"]'), null, 'nothing more to show');
    await app.click('[data-mhless="champ"]');
    assert.equal(champs(), 5);
    assert.equal(app.$('[data-mhless="champ"]'), null);
  });
});

test('match details: two freely chosen players compared, with their gold over time', () => withApp({ replies: mhReplies([game(1, { v: 3, gold: Array.from({ length: 20 }, (_, m) => Array.from({ length: 10 }, (_, i) => 500 + m * 400 + i * 10)) })]) }, async (app) => {
  await app.click('#navMatches');
  await app.click(app.$('.mh-row .mh-meta'));
  await app.click('[data-sec="compare"]');
  const sel = app.$$('[data-cmp]');
  assert.equal(sel.length, 2);
  assert.notEqual(sel[0].value, sel[1].value, 'two different players at first');
  assert.ok(app.$$('.cmp-row').length >= 8, 'many stats');
  assert.ok(app.$('.cmp-chart'), 'gold over time');
  await app.type(sel[1], '9');
  assert.equal(app.$$('[data-cmp]')[1].value, '9', 'kept after the change');
  assert.ok(app.$('.mh-det'), 'still open');
}));

test('match history: multikill chip pins those games; the bin deletes after the red warning', () => withApp({ replies: mhReplies([game(1), game(2, { players: game(2).players.map((p) => ({ ...p, multi: 0 })) })]) }, async (app) => {
  await app.click('#navMatches');
  await app.click('[data-pin="5"]');
  assert.ok(app.$('.mh-sec.pin'));
  await app.click('#mhClear');
  assert.ok(app.visible('#confirmDanger'));
  await app.click('#confirmYes');
  assert.equal(app.called('mh-clear').length, 1);
}));

test('match history: every filter control works without errors', () => withApp({ replies: mhReplies([game(1), game(2), game(30)]) }, async (app) => {
  await app.click('#navMatches');
  for (const v of ['today', '7', '30', '90', 'custom', 'all']) await app.type('#mhRange', v);
  for (const b of app.$$('[data-mhr]')) await app.click(b);
  for (const b of app.$$('[data-mhq]')) await app.click(b);
  // queues add up; "All" clears them
  await app.click('[data-mhq=""]');
  await app.click('[data-mhq="solo"]');
  await app.click('[data-mhq="classic"]');
  assert.equal(lastCall(app, 'matches').args[0].queue, 'solo,classic');
  await app.click('[data-mhq="solo"]');
  assert.equal(lastCall(app, 'matches').args[0].queue, 'classic');
  await app.click('[data-mhq=""]');
  assert.equal(lastCall(app, 'matches').args[0].queue, null);
  await app.click('#mhAdvBtn');
  for (const id of ['#mhMinK', '#mhMaxD', '#mhMinKda']) await app.type(id, '1');
  for (const v of ['new', 'kda', 'kills', 'deaths', 'dmg', 'cs', 'long']) await app.type('#mhSort', v);
  await app.click('#mhReset');
  assert.equal(app.$$('.mh-row').length, 3);
}));

test('match history: "load older games" shows its progress, and waits until a game is over', () => withApp({ replies: { ...mhReplies([game(1)]), 'matches-more': { ok: false, inGame: true } } }, async (app) => {
  await app.click('#navMatches');
  await app.click('#mhMore');
  assert.match(app.$('#toast').textContent, /Not during a game/);
}));

test('match history: progress on the button while everything loads', () => withApp({ replies: { ...mhReplies([game(1)]), matches: { ...mhReplies([game(1)]).matches, loadingOlder: true, older: [12, 40] } } }, async (app) => {
  await app.click('#navMatches');
  assert.equal(app.$('#mhMore').textContent, 'Loading 12 / 40 …');
  assert.ok(app.$('#mhMore').disabled);
}));

// ---------- adding many accounts ----------
test('bulk add: paste a list, see what was understood, add everything into a category', () => {
  let n = 0;
  const state = sampleState();
  const added = () => { const id = 'new-' + (++n); state.accounts.push({ puuid: id, placeholder: true, gameName: 'x' + n, tagLine: '', note: '' }); return { ok: true, puuid: id }; };
  return withApp({ state, replies: { 'add-saved': added } }, async (app) => {
    await app.click('#addAcc');
    await app.click('#optBulk');
    assert.ok(!app.$('#bulkBox').hidden);
    await app.type('#bulkText', 'one:pw1\ntwo--Two#EUW--pw2\nthree;pw3;;main\nfour\none:dup');
    assert.equal(app.$$('.bk-row').length, 5);
    assert.equal(app.$$('.bk-row.bad').length, 2);
    assert.equal(app.$('#bulkGo').textContent, 'Add 3');
    await app.type('#bulkCat', 'c1');
    await app.click('#bulkGo');
    assert.deepEqual(app.called('add-saved').map(c => c.args[0]), [
      { riotId: '', u: 'one', p: 'pw1' }, { riotId: 'Two#EUW', u: 'two', p: 'pw2' }, { riotId: '', u: 'three', p: 'pw3' }]);
    assert.deepEqual(app.called('note').map(c => c.args), [['new-3', 'main']]);
    const moved = app.called('arrange').pop().args[0].filter(x => x.category === 'c1').map(x => x.puuid);
    assert.ok(['new-1', 'new-2', 'new-3'].every(id => moved.includes(id)));
    assert.ok(app.$('#bulkBox').hidden);
    assert.match(app.$('#toast').textContent, /3 accounts added, 2 lines skipped/);
  });
});

// ---------- layouts and keyboard ----------
test('layouts: tiles, small tiles and a list – the list rows work like tiles', () => withApp({}, async (app) => {
  await app.click('[data-layout="list"]');
  assert.deepEqual(lastCall(app, 'set-setting').args, ['layout', 'list']);
  assert.equal(app.$$('#board .grid.list .tile.row').length, 4);
  assert.match(app.$(`.tile.row[data-id="${P(2)}"]`).textContent, /Gold II/);
  await app.click(app.$(`.tile.row[data-id="${P(2)}"] .c-name`));
  assert.ok(app.$(`.tile.row[data-id="${P(2)}"]`).classList.contains('selected'));
  await app.click('[data-layout="compact"]');
  assert.equal(app.$$('#board .grid.compact .tile').length, 4);
}));

test('keyboard: pages, search, arrow keys, Enter logs in, ? lists the shortcuts', () => withApp({}, async (app) => {
  const press = async (key, o = {}) => { app.d.body.dispatchEvent(new app.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o })); await app.settle(); };
  await press('2', { ctrlKey: true });
  assert.ok(!app.$('#viewDash').hidden);
  await press('f', { ctrlKey: true });
  assert.ok(!app.$('#viewAccounts').hidden);
  assert.equal(app.d.activeElement, app.$('#search'));
  app.$('#search').blur();
  await press('ArrowRight');
  const first = app.$('#board .tile.selected').dataset.id;
  await press('ArrowRight');
  const second = app.$('#board .tile.selected').dataset.id;
  assert.notEqual(first, second);
  await press('Enter');
  await app.click('#confirmYes');
  assert.deepEqual(lastCall(app, 'switch').args, [second]);
  await press('a', { ctrlKey: true });
  assert.equal(app.$$('#board .tile.picked').length, 4);
  await press('?');
  assert.ok(!app.$('#helpBox').hidden);
  assert.match(app.$('#helpBody').textContent, /Ctrl\+Shift\+N/);
}));

// ---------- collection ----------
test('collection: numbers per account, a search finds champions, skins and shards on every account', () => withApp({ replies: {
  'load-all': { ok: true, champs: 162, skins: 87, games: 12 },
  champions: [{ id: 103, name: 'Ahri' }, { id: 22, name: 'Ashe' }, { id: 1, name: 'Annie' }],
  collections: [
    { puuid: P(1), at: 1, champs: [103, 22], skins: [[103001, 'Dynasty Ahri']], shards: [['c', 1, 2, 'Annie'], ['s', 103015, 1, 'Arcade Ahri']] },
    { puuid: P(2), at: 1, champs: [1], skins: [], shards: [] },
  ] } }, async (app) => {
  await app.click('#navColl');
  assert.ok(!app.$('#viewColl').hidden);
  const row = app.$(`.coll-table tr[data-cacc="${P(1)}"]`);
  assert.deepEqual([...row.querySelectorAll('td')].slice(1, 5).map(td => td.textContent), ['2', '1', '2', '1']);
  // not read yet: its own row with what to do
  assert.match(app.$(`.coll-table tr.unread[data-cacc="${P(3)}"]`).textContent, /Not read yet/);
  // "Load": the signed-in account, everything at once
  await app.click('#collRead');
  assert.equal(app.called('load-all').length, 1);
  assert.match(app.$('#toast').textContent, /162 champions, 87 skins, 12 new games/);
  await app.type('#collSearch', 'ahri');
  assert.equal(app.$$('.coll-acc').length, 1);
  assert.deepEqual(app.$$('.coll-acc .cl-chip').map(x => x.className.split(' ')[1]).sort(), ['champ', 'skin', 'skinShard']);
  await app.type('#collSearch', 'annie');
  assert.equal(app.$$('.coll-acc').length, 2);   // P1 has a shard, P2 owns her
  await app.click('[data-ck="shard"]');
  assert.equal(app.$$('.coll-acc').length, 1);
  assert.match(app.$('.coll-acc').textContent, /×2/);
  await app.type('#collSearch', 'zed');
  assert.match(app.$('#collBody').textContent, /None of your accounts/);
}));

// ---------- safeguards around logging in ----------
test('a locked account asks before logging in, even with the question switched off', () => {
  const st = sampleState();
  st.settings.confirmSwitch = false;
  st.accounts[1].penalties = { at: 1, list: [{ code: 'LEAVER_BUSTER', until: Date.now() + 3600000 }] };
  st.accounts[2].lowPrio = { games: 2, perGame: 300, at: 1 };
  return withApp({ state: st }, async (app) => {
    await app.click(tile(app, 2));
    await app.click(tile(app, 2));
    assert.ok(!app.$('#confirm').hidden);
    assert.match(app.$('#confirm').textContent, /penalty/);
    await app.click('#confirmNo');
    assert.equal(app.called('switch').length, 0);
    await app.click(tile(app, 3));
    await app.click(tile(app, 3));
    assert.match(app.$('#confirm').textContent, /Low priority queue: 2 games/);
    await app.click('#confirmYes');
    assert.deepEqual(lastCall(app, 'switch').args, [P(3)]);
  });
});

test('sign-in waiting for a code or captcha: what to do by hand, and a button to the Riot Client', () => withApp({}, async (app) => {
  await app.push({ ...app.S.state, login: { name: 'Player2', stage: 'check' } });
  assert.ok(!app.$('#loginBox').hidden);
  assert.ok(!app.$('#loginManual').hidden);
  assert.equal(app.$$('#loginSteps li').length, 3);
  await app.click('#loginRc');
  assert.equal(app.called('show-riot-client').length, 1);
  await app.push({ ...app.S.state, login: { name: 'Player2', stage: 'typing' } });
  assert.ok(app.$('#loginManual').hidden);
}));

test('signed in as another account than picked: a red note with both names', () => withApp({}, async (app) => {
  await app.emit('toast', { key: 'login.wrong', vars: { got: 'Other#EUW', want: 'Player2#EUW' }, err: true });
  assert.match(app.$('#toast').textContent, /Signed in as Other#EUW – not Player2#EUW/);
  assert.ok(app.$('#toast').classList.contains('err'));
}));

// ---------- export, diagnostics, what's new, data sources ----------
test('export: a clear choice – without logins, or with logins under their own password', () => withApp({ replies: { 'data-export': { ok: true, n: 3 } } }, async (app) => {
  await app.click('#exportBtn');
  assert.ok(app.visible('#expBox'));
  assert.match(app.$('#expBox').textContent, /Never in the file/);
  await app.click('[data-exp="plain"]');
  assert.deepEqual(lastCall(app, 'data-export').args, [null]);
  await app.click('#exportBtn');
  await app.click('[data-exp="logins"]');
  assert.ok(app.visible('#passBox'));
  app.$('#passIn').value = app.$('#passAgain').value = 'longpassword';
  await app.submit('#passForm');
  assert.deepEqual(lastCall(app, 'data-export').args, ['longpassword']);
  await app.click('#exportBtn');
  await app.click('[data-exp="cancel"]');
  assert.equal(app.called('data-export').length, 2);
}));

test('diagnostics, what\'s new and the data sources', () => withApp({ state: sampleState({ version: '1.2.0' }), replies: { diagnostics: { ok: true } } }, async (app) => {
  await app.click('#navTools');
  await app.click('#toolDiag');
  assert.equal(app.called('diagnostics').length, 1);
  assert.match(app.$('#toast').textContent, /Diagnostics saved/);
  await app.click('#notesBtn');
  assert.ok(app.visible('#notesBox'));
  assert.match(app.$('#notesBody').textContent, /Version 1\.2\.0 · installed/);
  assert.deepEqual(lastCall(app, 'set-setting').args, ['seenVersion', '1.2.0']);
  await app.click('#notesClose');
  await app.click('#sourcesBtn');
  assert.match(app.$('#helpBody').textContent, /CommunityDragon/);
}));

// ---------- live page ----------
test('live page: stands at once, even while the client and the champion list still answer', () => withApp({ replies: { live: () => new Promise(() => {}), champions: () => new Promise(() => {}) } }, async (app) => {
  await app.click('#navLive');
  assert.ok(!app.$('#viewLive').hidden);
  assert.match(app.$('#liveBody').textContent, /Loading/);
  assert.ok(app.$('#liveBody .helper'), 'the champ select helper is there right away');
}));

// ---------- app behaviour ----------
test('app behaviour: "start minimized" only together with "start with Windows"', () => withApp({}, async (app) => {
  const box = k => app.$(`[data-setting="${k}"]`);
  assert.ok(box('startMinimized').disabled, 'needs "Start with Windows"');
  await app.push({ ...app.S.state, settings: { ...app.S.state.settings, autostart: true } });
  assert.ok(!box('startMinimized').disabled);
  box('updateCheck').checked = false;
  box('updateCheck').dispatchEvent(new app.w.Event('change', { bubbles: true }));
  assert.deepEqual(lastCall(app, 'set-setting').args, ['updateCheck', false]);
}));

test('login interrupted by another window: hands-off hint while typing, then a clear message and "Log in again"', () => withApp({}, async (app) => {
  await app.click(tile(app, 2));
  await app.click(tile(app, 2));
  await app.click('#confirmYes');
  await app.push({ ...app.S.state, switching: { id: P(2), n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: 'signin', detail: 'typing' } });
  assert.ok(app.visible('#swHint'));
  await app.push({ ...app.S.state, switching: { id: P(2), n: 1, steps: ['close', 'client', 'signin', 'play', 'launch'], step: 'play', detail: 'update' } });
  assert.match(app.$('#swSteps').textContent, /League is updating/);
  await app.push({ ...app.S.state, switching: null, login: { name: 'Player2', stage: 'failed', msgKey: 'af.lostfocus' } });
  assert.equal(app.$('#loginTitle').textContent, 'Login interrupted');
  assert.match(app.$('#loginText').textContent, /Please don't click anything/);
  assert.ok(app.visible('#loginRetry'));
  await app.click('#loginRetry');
  assert.equal(app.called('dismiss-login').length, 1);
  await app.click('#confirmYes');
  assert.equal(app.called('switch').length, 2);
}));

test('first start: asked once whether to start with Windows – "quietly in the tray" switches both on', () => {
  const st = sampleState();
  st.settings.askedStart = false;
  return withApp({ state: st }, async (app) => {
    await new Promise(r => app.w.setTimeout(r, 500));
    await app.settle();
    assert.ok(app.visible('#startBox'));
    await app.click('[data-first="tray"]');
    assert.ok(!app.visible('#startBox'));
    const set = app.called('set-setting').map(c => c.args);
    assert.deepEqual(set.slice(-3), [['autostart', true], ['startMinimized', true], ['askedStart', true]]);
  });
});

// ---------- overview page ----------
function dashReplies() {
  const now = Date.now(), D = 86400000;   // Player3 also plays Ranked 5v5 (see dashState)
  const r = (tier, division, lp) => ({ tier, division, lp });
  return {
    dashboard: [
      { puuid: P(1), history: [{ t: now - 40 * D, solo: r('GOLD', 'IV', 50) }, { t: now - 20 * D, solo: r('GOLD', 'III', 20) }, { t: now - 2 * D, solo: r('GOLD', 'II', 0) }],
        games: [{ id: 1, t: now - 3 * D, q: 'solo', win: true }, { id: 2, t: now - 2 * D, q: 'solo', win: true }, { id: 3, t: now - D, q: 'solo', win: false }] },
      { puuid: P(2), history: [{ t: now - 25 * D, solo: r('SILVER', 'I', 80) }], games: [{ id: 4, t: now - 5 * D, q: 'solo', win: true }] },
      { puuid: P(3), history: [], games: [] },
    ],
  };
}
function dashState() {
  const st = sampleState();
  st.accounts[2].r5 = { tier: 'SILVER', division: 'II', lp: 40, wins: 3, losses: 2, wl: true };
  return st;
}
test('overview: every account in one LP chart, the period in numbers, a goal per account', () => withApp({ state: dashState(), replies: dashReplies() }, async (app) => {
  await app.click('#navDash');
  assert.ok(!app.$('#viewDash').hidden);
  assert.equal(app.$$('.dash-chip').length, 3);
  assert.equal(app.$$('.dash-chart path.acc').length, 3);
  assert.equal(app.$$('.dash-table tbody tr').length, 3);
  // 30 days: Player1 3 games 2–1, from Gold IV 50 (the last record before the period) to Gold II 10 = +160
  const row = app.$(`tr[data-dacc="${P(1)}"]`);
  assert.match(row.textContent, /2–1/);
  assert.match(row.textContent, /67 %/);
  assert.match(row.textContent, /\+160/);
  assert.match(row.textContent, /G4 → G2/);
  assert.match(app.$('.dash-stats').textContent, /4/);   // 4 ranked games together
  // a chip hides that account's line
  await app.click(`[data-dchip="${P(2)}"]`);
  assert.equal(app.$$('.dash-chart path.acc').length, 2);
  // goal: saved and shown with the LP left
  await app.type(`select[data-goal="${P(1)}"]`, 'PLATINUM:IV');
  assert.deepEqual(app.called('goal').pop().args, [P(1), { tier: 'PLATINUM', division: 'IV' }, 'solo']);
  assert.match(app.$(`tr[data-dacc="${P(1)}"]`).textContent, /190 LP to go/);
  // 7 days: only the last games count
  await app.click('[data-dd="7"]');
  assert.match(app.$(`tr[data-dacc="${P(2)}"]`).textContent, /1–0/);
  // queues freely combined: Solo/Duo + Ranked 5v5 (Player3 has one) – a line per account and queue
  await app.click('[data-dd="30"]');
  await app.click('[data-dq="r5"]');
  assert.ok(app.$('[data-dq="solo"]').classList.contains('on') && app.$('[data-dq="r5"]').classList.contains('on'));
  assert.equal(app.$$('.dash-table tbody tr').length, 4);
  assert.match(app.$('.dash-table').textContent, /Ranked 5v5/);
  assert.ok(app.$('.dash-chart path[stroke-dasharray="2 4"]'), 'Ranked 5v5 drawn dotted');
  // its own goal per queue
  await app.type(`select[data-goal="${P(3)}"][data-gq="r5"]`, 'GOLD:I');
  assert.deepEqual(app.called('goal').pop().args, [P(3), { tier: 'GOLD', division: 'I' }, 'r5']);
  // Solo/Duo off: only Ranked 5v5 left; the last queue can't be switched off
  await app.click('[data-dq="solo"]');
  assert.equal(app.$$('.dash-table tbody tr').length, 1);
  await app.click('[data-dq="r5"]');
  assert.ok(app.$('[data-dq="r5"]').classList.contains('on'));
  // Flex alone: nobody has a Flex rank
  await app.click('[data-dq="flex"]');
  await app.click('[data-dq="r5"]');
  assert.match(app.$('#dashBody').textContent, /No ranked data yet/);
  // a row opens the profile
  await app.click('[data-dq="solo"]');
  await app.click('[data-dq="flex"]');
  await app.click(app.$(`tr[data-dacc="${P(1)}"] td`));
  assert.ok(!app.$('#profileBox').hidden);
}));

// ---------- everything clickable ----------
test('every button of every page can be clicked without a script error', () => withApp({ replies: mhReplies([game(1)]) }, async (app) => {
  const skip = '#close, #toTray, #min, #updBtn, #supportBtn, #navCoffee, #exportBtn, #importBtn';
  for (const nav of ['#navAccounts', '#navDash', '#navLive', '#navMatches', '#navTools', '#navSettings']) {
    await app.click(nav);
    for (const b of app.$$('button:not([hidden])').filter((b) => !b.matches(skip) && !b.closest('[hidden]'))) {
      await app.click(b);
      // close whatever opened
      for (const o of app.$$('.overlay:not([hidden])')) o.hidden = true;
    }
  }
}));
