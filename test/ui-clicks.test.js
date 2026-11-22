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
  st.accounts[2].penalties = { at: Date.now(), list: [{ code: 'LeaverBusterLowPriorityQueue', until: Date.now() + 5 * 60000 }] };
  return withApp({ state: st }, async (app) => {
    const pbe = tile(app, 2);
    assert.ok(pbe.querySelector('.pbe-box'), 'test server box');
    assert.doesNotMatch(pbe.textContent, /Unranked/);
    const pen = tile(app, 3).querySelector('.tile-pen');
    assert.ok(pen, 'penalty on the tile');
    assert.match(pen.textContent, /Low priority/);
    assert.match(pen.textContent, /[45]:\d\d left/);
    assert.equal(tile(app, 1).querySelector('.tile-pen'), null);
  });
});

test('the board draws before views.js has loaded (the first state can come that early)', async () => {
  const st = sampleState();
  st.accounts[2].penalties = { at: Date.now(), list: [{ code: 'LeaverBusterLowPriorityQueue', until: Date.now() + 60000 }] };
  st.accounts[1].region = 'PBE';
  const app = await boot({ state: st, upTo: 'renderer.js' });
  try {
    assert.deepEqual(app.errors.map(String), []);
    assert.equal(app.$$('#board .tile[data-id]').length, 4);
    assert.ok(app.$('.tile-pen') && app.$('.pbe-box'));
  } finally { app.close(); }
});

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
  assert.equal(app.$$('.det-table').length, 2, 'players open at first');
  assert.equal(app.$('.det-h2h'), null, 'other sections folded');
  assert.deepEqual(app.$$('.det-g').map((h) => h.dataset.sec), ['players', 'h2h', 'compare'], 'no gold section without a timeline');
  await app.click('[data-sec="h2h"]');
  assert.ok(app.$('.det-h2h'), 'lane vs lane opens');
  assert.ok(app.$('.mh-det'), 'a section head does not close the game');
  await app.click('[data-sec="players"]');
  assert.equal(app.$$('.det-table').length, 0, 'players fold');
  await app.click(app.$('.mh-row .mh-meta'));
  assert.equal(app.$('.mh-det'), null, 'closes again');
}));

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

// ---------- everything clickable ----------
test('every button of every page can be clicked without a script error', () => withApp({ replies: mhReplies([game(1)]) }, async (app) => {
  const skip = '#close, #toTray, #min, #updBtn, #supportBtn, #navCoffee, #exportBtn, #importBtn';
  for (const nav of ['#navAccounts', '#navLive', '#navMatches', '#navTools', '#navSettings']) {
    await app.click(nav);
    for (const b of app.$$('button:not([hidden])').filter((b) => !b.matches(skip) && !b.closest('[hidden]'))) {
      await app.click(b);
      // close whatever opened
      for (const o of app.$$('.overlay:not([hidden])')) o.hidden = true;
    }
  }
}));
