// Collection: RP, and the breakdown by rarity – one table per kind, a row per account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, sampleState } = require('./harness');

test('collection: RP per account; "by rarity" folds out a table per kind to compare accounts', async () => {
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
    const tables = app.$$('.coll-rar');
    assert.equal(tables.length, 2);                          // skins and wards (chromas, icons: no data)
    // only the rarities anyone has, rarest first, "no rarity" last
    assert.deepEqual([...tables[0].querySelectorAll('thead th')].slice(1).map(th => th.textContent),
      ['Transcendent', 'Mythic', 'Legendary', 'Epic', 'No rarity']);
    const p1 = [...tables[0].querySelectorAll('tbody tr')][0];
    assert.deepEqual([...p1.querySelectorAll('td')].slice(1).map(td => td.textContent), ['1', '1', '2', '5', '10']);
    assert.match(tables[0].querySelector('tfoot').textContent, /13/);   // no rarity: 10 + 3
    // folds back
    await app.click('[data-collbd]');
    assert.ok(!app.$('.coll-rar'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
