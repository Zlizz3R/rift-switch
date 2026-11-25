// Collection: RP, and the breakdown by rarity – a row per kind, folding out a row per account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, sampleState } = require('./harness');

test('collection: RP per account; "by rarity" shows the kinds, a kind folds out its accounts', async () => {
  const st = sampleState();
  st.accounts[0].profile = { be: 1200, rp: 3305 };
  const app = await boot({ state: st, replies: {
    collections: [
      { puuid: P(1), at: 1, champs: [103], skins: [[103001, 'Dynasty Ahri']], counts: { ward: 3,
        rar: { skin: [10, 0, 5, 2, 1, 0, 0, 1], ward: [2, 0, 0, 0, 1, 0, 0, 0] } } },
      { puuid: P(2), at: 1, champs: [1], skins: [], counts: { rar: { skin: [3, 0, 1, 0, 0, 0, 0, 0] } } },
    ] } });
  try {
    await app.click('#navColl');
    await app.settle();
    assert.match(app.$('.coll-table thead').textContent, /RP/);
    assert.match(app.$(`.coll-table tr[data-cacc="${P(1)}"]`).textContent, /3,305/);
    assert.ok(!app.$('.coll-rar'), 'folded at first');
    await app.click('[data-collbd]');
    // one table: a row per kind with all accounts together – skins and wards (chromas, icons: no data)
    const tables = app.$$('.coll-rar');
    assert.equal(tables.length, 1);
    const kinds = () => app.$$('.coll-rar tr.rar-kind');
    assert.deepEqual(kinds().map(r => r.dataset.rarkind), ['skin', 'ward']);
    // ward skins exist only as Rare, Epic and Mythic (and plain): the other cells stay empty
    assert.deepEqual([...kinds()[1].querySelectorAll('td')].slice(1).map(td => td.textContent), ['2', '0', '0', '', '1', '', '', '']);
    assert.equal(app.$$('.coll-rar tr.rar-acc').length, 0, 'accounts folded at first');
    // every rarity, lowest first – also the ones nobody has (Rare, Ultimate, Exalted)
    assert.deepEqual([...tables[0].querySelectorAll('thead th')].slice(1).map(th => th.textContent),
      ['No rarity', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Ultimate', 'Exalted', 'Transcendent']);
    const cells = r => [...r.querySelectorAll('td')].slice(1).map(td => td.textContent);
    assert.deepEqual(cells(kinds()[0]), ['13', '0', '6', '2', '1', '0', '0', '1']);   // skins: 10 + 3 without rarity, 5 + 1 epic
    // a click on a kind folds out its accounts, a second click folds them back
    await app.click(kinds()[0]);
    const accs = app.$$('.coll-rar tr.rar-acc');
    assert.equal(accs.length, 2);
    assert.deepEqual(cells(accs[0]), ['10', '0', '5', '2', '1', '0', '0', '1']);
    assert.ok(kinds()[0].nextElementSibling.classList.contains('rar-acc'));
    await app.click(kinds()[0]);
    assert.equal(app.$$('.coll-rar tr.rar-acc').length, 0);
    // folds back
    await app.click('[data-collbd]');
    assert.ok(!app.$('.coll-rar'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
