// Click tests for mastery across accounts and the shared "Load" button (the real window, see harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');

const tile = (app, i) => app.$(`#board .tile[data-id="${P(i)}"]`);
const lastCall = (app, ch) => app.called(ch).slice(-1)[0];
async function withApp(opts, fn) {
  const app = await boot(opts);
  try {
    await fn(app);
    assert.deepEqual(app.errors.map(String), [], 'no script errors');
  } finally { app.close(); }
}

test('overview → mastery: points over all accounts, split per account, sorting, search, the tab is kept', () => withApp({ replies: {
  champions: [{ id: 420, name: 'Illaoi' }, { id: 6, name: 'Urgot' }],
  masteries: [
    { puuid: P(1), at: 1700000000000, champs: { 420: [1800000, 161], 6: [50000, 9] } },
    { puuid: P(2), at: 1700000000000, champs: { 420: [414330, 40] } },
  ] } }, async (app) => {
  await app.click('#navDash');
  assert.ok(app.visible('#dashSum'), 'the Overview opens on At a glance');
  await app.click('[data-dt="mast"]');
  assert.ok(app.visible('#dashMast'));
  // the biggest champion up top: the sum of both accounts, 2M milestone
  const card = app.$('.mast-card');
  assert.match(card.textContent, /Illaoi/);
  assert.match(card.textContent, /2,214,330/);
  assert.match(card.textContent, /2M/);
  assert.match(card.textContent, /2 accounts/);
  assert.match(card.textContent, /≈ [\d,]+ h/);             // one number, no range
  // on top: all points together and the play time behind them
  const tot = app.$('.mast-totals').textContent;
  assert.match(tot, /Mastery points \(all accounts\)\s*[\d,]{7,}/);
  assert.match(tot, /Play time \(approx\.\)\s*≈ [\d,]+ h/);
  // the table: a column per account, the one never read is marked, the best account highlighted
  assert.match(app.$('.mast-table thead').textContent, /not read yet/);
  const first = app.$('.mast-table tbody tr');
  assert.match(first.textContent, /Illaoi/);
  assert.equal(first.querySelectorAll('td.best').length, 1);
  assert.match(first.querySelector('td.best').textContent, /1,800,000/);
  assert.match(first.querySelector('td.best').textContent, /Level 161/);   // levels per account, never added
  // sort by name, then search
  await app.click('[data-ms="name"]');
  assert.match(app.$('.mast-table tbody tr').textContent, /Illaoi/);
  await app.click('[data-ms="name"]');
  assert.match(app.$('.mast-table tbody tr').textContent, /Urgot/);
  await app.type('#mastSearch', 'urg');
  assert.equal(app.$$('.mast-table tbody tr').length, 1);
  await app.type('#mastSearch', 'zed');
  assert.match(app.$('#mastBody').textContent, /No champion matches/);
  // back to the overview later: it opens on Mastery again
  await app.click('#navAccounts');
  await app.click('#navDash');
  assert.ok(app.visible('#dashMast'));
}));

test('mastery: nothing read yet says what to do', () => withApp({}, async (app) => {
  await app.click('#navDash');
  await app.click('[data-dt="mast"]');
  assert.match(app.$('#mastBody').textContent, /No mastery read yet/);
}));

test('load: one run for every button – progress on all of them, other accounts load at their next login', () => withApp({}, async (app) => {
  // the panel of the signed-in account has Load; another account waits for its login
  await app.click(tile(app, 1));
  const own = app.$(`#detail [data-loadall="${P(1)}"]`);
  assert.ok(own && !own.disabled);
  await app.click(tile(app, 2));
  const other = app.$(`#detail [data-loadall="${P(2)}"]`);
  assert.ok(other.disabled);
  assert.match(other.textContent, /Load at next login/);
  // while a run is going, every button shows the same step and nothing new starts
  await app.push({ ...app.S.state, loading: { step: 'mast', n: 2, of: 4, done: 0, total: 0, since: Date.now() - 5000 } });
  await app.click('#navColl');
  const b = app.$('#collRead');
  assert.ok(b.disabled);
  assert.match(b.textContent, /Mastery … 2\/4/);
  assert.ok(b.querySelector('.lb-bar'), 'a bar after a second');
  await app.click('#navDash');
  assert.match(app.$('#dashTabs [data-loadall]').textContent, /Mastery … 2\/4/);
  assert.equal(app.called('load-all').length, 0);
  // League closed: no Load
  await app.push({ ...app.S.state, loading: null, live: { clientUp: false } });
  assert.ok(app.$('#dashTabs [data-loadall]').disabled);
}));

test('load: a press runs it once and says what came in', () => withApp({ replies: { 'load-all': { ok: true, champs: 162, skins: 87, games: 12 } } }, async (app) => {
  await app.click('#navDash');
  await app.click('#dashTabs [data-loadall]');
  assert.equal(app.called('load-all').length, 1);
  assert.match(app.$('#toast').textContent, /✓ Loaded – 162 champions, 87 skins, 12 new games/);
}));
