// Logic of the main process: accounts, settings, secrets, backup, tray menu, store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const acc = require('../src/core/accounts');
const settings = require('../src/core/settings');
const secrets = require('../src/core/secrets');
const backup = require('../src/core/backup');
const menu = require('../src/core/menu');
const store = require('../src/core/store');

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const tr = (k, v) => k + (v ? JSON.stringify(v) : '');

test('ids and logins', () => {
  assert.ok(acc.isId(P1));
  assert.ok(acc.isId('new-' + P1));
  assert.ok(!acc.isId('../etc'));
  assert.ok(!acc.isId(null));
  assert.ok(acc.isPlaceholder('new-' + P1));
  assert.deepEqual(acc.validCred({ u: ' me ', p: 'pw' }), { u: 'me', p: 'pw' });
  assert.equal(acc.validCred({ u: 'me', p: '' }), null);
  assert.equal(acc.maskLogin('zlizzer'), 'zl•••r');
  assert.equal(acc.maskLogin('ab'), 'a•••');
  assert.equal(acc.maskLogin(''), '•••');
});

test('normal games: a short answer never lowers the count', () => {
  const prev = { count: 8, sample: 50, hasRanked: false };
  const short = acc.bestNormals(prev, { count: 2, sample: 5, hasRanked: false, at: 9 });
  assert.equal(short.count, 8);
  assert.equal(short.at, 9);
  assert.equal(acc.bestNormals(prev, { count: 9, sample: 50, hasRanked: false }).count, 9);
  // once a ranked game was seen it stays seen
  assert.equal(acc.bestNormals({ count: 1, sample: 50, hasRanked: true }, { count: 1, sample: 50, hasRanked: false }).hasRanked, true);
});

test('ranked games are merged by id, newest first, max 300', () => {
  const a = { rankedGames: [{ id: 1, t: 1 }] };
  acc.mergeRankedGames(a, [{ id: 2, t: 5 }, { id: 1, t: 1, win: true }]);
  assert.deepEqual(a.rankedGames.map(g => g.id), [2, 1]);
  assert.equal(a.rankedGames[1].win, true);
  acc.mergeRankedGames(a, Array.from({ length: 400 }, (_, i) => ({ id: 100 + i, t: 100 + i })));
  assert.equal(a.rankedGames.length, 300);
});

test('upsert keeps old ranks, real win/loss and records LP changes once', () => {
  const list = [];
  acc.upsertInto(list, { puuid: P1, solo: { tier: 'GOLD', division: 'II', lp: 10, wins: 5, losses: 5, wl: true } }, 1);
  // another account's view: losses unknown -> keep the last real numbers
  acc.upsertInto(list, { puuid: P1, solo: { tier: 'GOLD', division: 'II', lp: 30, wins: 7, losses: 0, wl: false } }, 2);
  assert.equal(list[0].solo.losses, 5);
  assert.equal(list[0].solo.wlStale, true);
  assert.equal(list[0].solo.lp, 30);
  // empty refresh keeps the rank
  acc.upsertInto(list, { puuid: P1, level: 40 }, 3);
  assert.equal(list[0].solo.lp, 30);
  assert.equal(list[0].history.length, 2);   // 10 LP, 30 LP – the third call changed nothing
});

test('settings are validated', () => {
  const L = ['en', 'de'];
  assert.deepEqual(settings.cleanSetting('autoPlay', 'yes', L), { ok: true, value: true });
  assert.deepEqual(settings.cleanSetting('uiScale', '999', L), { ok: true, value: '100' });
  assert.deepEqual(settings.cleanSetting('lang', 'xx', L), { ok: true, value: 'en' });
  assert.deepEqual(settings.cleanSetting('theme', 'pink', L), { ok: true, value: 'system' });
  assert.deepEqual(settings.cleanSetting('lockHash', 'x', L), { ok: false });
  assert.deepEqual(settings.cleanSetting('__proto__', {}, L), { ok: false });
  assert.deepEqual(settings.cleanSetting('champPool', [1, '2', -1, 5000, 1.5], L).value, [1, 2]);
  assert.deepEqual(settings.cleanSetting('tile', { icon: false, 'bad key': true, x: 'str' }, L).value, { icon: false });
  const merged = settings.mergeSettings({ autostart: true, lang: 'de' }, { autostart: false, lang: 'xx', autoAccept: 1 }, L);
  assert.equal(merged.autostart, true);      // machine-specific: never imported
  assert.equal(merged.lang, 'de');           // unknown language ignored
  assert.equal(merged.autoAccept, true);
});

test('sealed logins open only with the right password', () => {
  const box = secrets.sealSecrets({ logins: [{ u: 'a', p: 'b' }] }, 'correct horse');
  assert.deepEqual(secrets.openSecrets(box, 'correct horse'), { logins: [{ u: 'a', p: 'b' }] });
  assert.equal(secrets.openSecrets(box, 'wrong'), null);
  assert.equal(secrets.openSecrets({ ...box, data: box.data.slice(0, -4) + 'AAAA' }, 'correct horse'), null);  // tampered
  assert.equal(secrets.openSecrets(null, 'x'), null);
  assert.ok(!JSON.stringify(box).includes('"b"'));
});

test('app lock', () => {
  const lock = secrets.makeLock('1234');
  assert.ok(secrets.lockMatches(lock, '1234'));
  assert.ok(!secrets.lockMatches(lock, '12345'));
  assert.ok(!secrets.lockMatches(lock, null));
  assert.ok(!secrets.lockMatches(null, '1234'));
  assert.notEqual(secrets.makeLock('1234').salt, lock.salt);
});

test('export / import round trip; this PC wins', () => {
  const state = {
    accounts: [{ puuid: P1, gameName: 'A', note: 'main', category: 'c1', hasCred: true, solo: { tier: 'GOLD' } },
      { puuid: 'new-' + P2, placeholder: true, gameName: 'x•••' }],
    categories: [{ id: 'c1', name: 'Mains' }], settings: { autostart: true, lang: 'de', uiScale: '110' },
  };
  const file = backup.buildExport(state, null, 5);
  assert.equal(file.accounts.length, 1);          // placeholders only travel inside sealed logins
  assert.equal(file.accounts[0].hasCred, undefined);
  assert.equal(file.settings.autostart, undefined);
  assert.ok(backup.checkFile(JSON.parse(JSON.stringify(file))));
  assert.equal(backup.checkFile({ app: 'other', accounts: [] }), null);

  const here = { accounts: [{ puuid: P1, note: '', gameName: 'A' }], categories: [], settings: { lang: 'en' } };
  const r = backup.applyImport(here, { ...file, accounts: [...file.accounts, { puuid: '../evil' }, { puuid: P2, gameName: 'B', note: 'x'.repeat(50) }] }, { langs: ['en', 'de'] });
  assert.deepEqual(r, { added: 1, updated: 1 });
  assert.equal(here.accounts[0].note, 'main');     // gap filled
  assert.equal(here.accounts[1].note.length, 24);
  assert.equal(here.categories[0].id, 'c1');
  assert.equal(here.settings.lang, 'de');

  const logins = backup.loginsToRestore(here, [
    { puuid: P1, u: 'a', p: 'b' },
    { puuid: 'new-' + P1, u: 'c', p: 'd', placeholder: true, gameName: 'c•••' },
    { puuid: 'bad', u: 'e', p: 'f' }, { puuid: P2, u: '', p: 'x' }]);
  assert.deepEqual(logins.map(l => l.puuid), [P1, 'new-' + P1]);
  assert.ok(here.accounts.some(a => a.puuid === 'new-' + P1 && a.placeholder));
});

test('tray menu and jump list follow streamer mode and the lock', () => {
  const state = { active: P1, categories: [{ id: 'c1', name: 'Smurfs' }], settings: {},
    accounts: [{ puuid: P1, gameName: 'Main', tagLine: 'EUW', solo: { tier: 'DIAMOND', division: 'II' } },
      { puuid: P2, gameName: 'Smurf', tagLine: 'EUW', category: 'c1' }] };
  const items = menu.accountItems(state, { locked: false, tr });
  assert.equal(items[0].label.startsWith('Main#EUW'), true);
  assert.equal(items[0].checked, true);
  assert.ok(items.some(x => x.type === 'header' && x.label === 'Smurfs'));
  assert.deepEqual(menu.accountItems(state, { locked: true, tr }).map(x => x.type), ['locked', 'separator']);
  state.settings = { streamer: true };
  assert.ok(!menu.accountItems(state, { locked: false, tr })[0].label.includes('Main'));
  assert.equal(menu.jumpTasks(state, { locked: true, tr, program: 'x' }).length, 0);
  assert.equal(menu.jumpTasks(state, { locked: false, tr, program: 'x' })[0].arguments, '--switch=' + P1);
  assert.equal(menu.switchArg(['app.exe', '--switch=' + P2], state.accounts), P2);
  assert.equal(menu.switchArg(['--switch=' + '3'.repeat(36)], state.accounts), null);
});

test('store: migrations, damaged file kept, atomic write', () => {
  const s = store.normalizeState({ settings: { sort: 'custom', autoPlay: false } });
  assert.equal(s.settings.sort, 'level');
  assert.equal(s.settings.autoPlay, true);
  assert.deepEqual(s.accounts, []);
  assert.equal(store.normalizeState({ settings: { sort: 'name', sortLevelDefault: true } }).settings.sort, 'name');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-'));
  const file = path.join(dir, 'accounts.json');
  store.writeAtomic(file, JSON.stringify({ accounts: [{ puuid: P1 }] }));
  assert.equal(store.readState(file).accounts[0].puuid, P1);
  fs.writeFileSync(file, '{ broken');
  const errors = [];
  assert.deepEqual(store.readState(file, w => errors.push(w)).accounts, []);
  assert.deepEqual(errors, ['load']);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('accounts.damaged-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Riot IDs: invisible direction marks from copying are removed', () => {
  assert.deepEqual(acc.parseRiotId('\u2066Zlizz3Rnotpbe\u2069#\u2066187\u2069'), { gameName: 'Zlizz3Rnotpbe', tagLine: '187' });
  assert.deepEqual(acc.parseRiotId(' Name With Space#EUW '), { gameName: 'Name With Space', tagLine: 'EUW' });
  assert.equal(acc.parseRiotId('NoTag'), null);
  assert.equal(store.normalizeState({ accounts: [{ gameName: '\u2066A\u2069', tagLine: '\u2066187\u2069' }] }).accounts[0].tagLine, '187');
});
