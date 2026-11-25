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

test('settings: appear offline is a switch that is saved', () => withApp({}, async (app) => {
  const box = app.$('[data-setting="appearOffline"]');
  assert.ok(box);
  box.checked = true;
  box.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await app.settle();
  assert.deepEqual(last(app, 'set-setting').args, ['appearOffline', true]);
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
