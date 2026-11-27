// Collection: RP, and the tab "By rarity" – a row per kind, folding out a row per account; Legacy
// in a column of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, sampleState } = require('./harness');

test('collection: RP per account; the "By rarity" tab shows the kinds, a kind folds out its accounts; Legacy apart', async () => {
  const st = sampleState();
  st.accounts[0].profile = { be: 1200, rp: 3305 };
  const app = await boot({ state: st, replies: {
    collections: [
      { puuid: P(1), at: 1, champs: [103], skins: [[103001, 'Dynasty Ahri']], counts: { ward: 3,
        rar: { skin: [10, 0, 5, 2, 1, 0, 0, 1], ward: [2, 0, 0, 0, 1, 0, 0, 0], skinLegacy: 4 } } },
      { puuid: P(2), at: 1, champs: [1], skins: [], counts: { rar: { skin: [3, 0, 1, 0, 0, 0, 0, 0], icon: [4, 1, 0, 0, 0, 0, 0, 0] } } },
    ] } });
  try {
    await app.click('#navColl');
    await app.settle();
    assert.match(app.$('.coll-table thead').textContent, /RP/);
    assert.match(app.$(`.coll-table tr[data-cacc="${P(1)}"]`).textContent, /3,305/);
    assert.ok(!app.$('.coll-rar'), 'not on the first tab');
    // the second tab, in the bar under the pages
    assert.deepEqual(app.$$('#collTabs [data-ct]').map(b => b.dataset.ct), ['list', 'rar']);
    await app.click('[data-ct="rar"]');
    assert.ok(app.$('[data-ct="rar"]').classList.contains('on'));
    assert.ok(app.$('#collTiles').hidden && app.$('#collSearch').closest('label').hidden, 'no search, no tiles');
    // one table: a row per kind with all accounts together – skins, icons and wards
    const tables = app.$$('.coll-rar');
    assert.equal(tables.length, 1);
    const kinds = () => app.$$('.coll-rar tr.rar-kind');
    // in the client's order: skins, icons, ward skins (chromas: no data)
    assert.deepEqual(kinds().map(r => r.dataset.rarkind), ['skin', 'icon', 'ward']);
    // ward skins exist only as Rare, Epic and Mythic (and plain): the other cells stay empty; no Legacy
    assert.deepEqual([...kinds()[2].querySelectorAll('td')].slice(1).map(td => td.textContent), ['2', '0', '0', '1', '', '', '', '', '']);
    assert.equal(app.$$('.coll-rar tr.rar-acc').length, 0, 'accounts folded at first');
    // every rarity, lowest first – also the ones nobody has (Rare, Ultimate, Exalted) – then Legacy apart
    assert.deepEqual([...tables[0].querySelectorAll('thead th')].slice(1).map(th => th.textContent.trim()),
      ['No rarity', 'Rare ?', 'Epic', 'Mythic', 'Legendary', 'Ultimate', 'Exalted', 'Transcendent', 'Legacy']);
    assert.match(app.$('.coll-rar thead th[title]').title, /Victorious/);
    const cells = r => [...r.querySelectorAll('td')].slice(1).map(td => td.textContent);
    // skins: 10 + 3 without rarity, 5 + 1 epic; Legacy 4 (the second account read before it was counted)
    assert.deepEqual(cells(kinds()[0]), ['13', '', '6', '1', '2', '0', '0', '1', '4']);
    // a click on a kind folds out its accounts, a second click folds them back
    await app.click(kinds()[0]);
    const accs = app.$$('.coll-rar tr.rar-acc');
    assert.equal(accs.length, 2);
    assert.deepEqual(cells(accs[0]), ['10', '', '5', '1', '2', '0', '0', '1', '4']);
    assert.equal(cells(accs[1]).pop(), '–');
    assert.ok(kinds()[0].nextElementSibling.classList.contains('rar-acc'));
    await app.click(kinds()[0]);
    assert.equal(app.$$('.coll-rar tr.rar-acc').length, 0);
    // back to the first tab
    await app.click('[data-ct="list"]');
    assert.ok(!app.$('.coll-rar'));
    assert.ok(!app.$('#collTiles').hidden);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
