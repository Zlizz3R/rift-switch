// Overview → Tags in the real window (harness.js): strengths / to work on, every tag by group, the
// numbers behind a tag on click, per account, no missing text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const player = (team, i, o = {}) => ({ puuid: `x${team}${i}`, name: 'N' + i, tag: 'EUW', team, champ: 200 + i, pos: POS[i], win: team === 100,
  k: 2, d: 3, a: 4, cs: i === 4 ? 30 : 200, gold: 9000, dmg: 15000, vis: 20, lvl: 14, items: i === 4 ? [3877, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0],
  spells: i === 1 ? [11, 4] : [4, 14], keystone: 0, sub: 0, x: { pinks: 3, turretDmg: 2000 }, ...o });
const now = Date.now();
// 12 ranked mid games of account 1: 10 CS/min, 8 / 1 / 6 → farm master, KDA master, few deaths
const games = Array.from({ length: 12 }, (_, i) => {
  const players = [...POS.map((_, j) => player(100, j)), ...POS.map((_, j) => player(200, j))];
  players[2] = { ...players[2], puuid: P(1), champ: 103, k: 8, d: 1, a: 6, cs: 300 };
  return { id: String(500 + i), t: now - (i + 1) * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 3, players };
});
const replies = {
  matches: { index: games.map(g => [g.id, g.t, g.q, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
  'matches-get': games,
  champions: [{ id: 103, name: 'Ahri' }, { id: 420, name: 'Illaoi' }],
  masteries: [{ puuid: P(1), at: 1, champs: { 420: [1200000, 120], 103: [90000, 10] } }],
};

test('tags: strengths on top, every tag by group, a click shows the numbers; per account', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="tags"]');
    await app.settle();
    assert.ok(app.visible('#dashTags'));
    assert.match(app.$('#tagSub').textContent, /12 ranked games this season · Mid \(main role\)/);
    const strong = app.$$('.tag-top > div')[0].textContent;
    assert.match(strong, /Great farmer ★/);
    assert.match(strong, /Great KDA ★/);
    assert.match(strong, /Survivor/);
    // mastery over all accounts; OTP of Ahri (12 of 12 – but under 15 games: too little data)
    assert.match(app.$('#tagBody').textContent, /Millionaire: Illaoi/);
    // tags that don't apply aren't shown at all
    assert.equal(app.$$('.tchip.tc-not').length, 0);
    assert.doesNotMatch(app.$('#tagBody').innerHTML, /Not met/);
    const otp = app.$$('.tchip.tc-few').find(c => /OTP/.test(c.textContent));
    assert.match(otp.textContent, /12\/15/);
    // a click: the numbers behind the tag
    const farm = app.$$('.tag-group .tchip').find(c => /Great farmer/.test(c.textContent));
    await app.click(farm);
    const det = app.$('.tdetail').textContent;
    assert.match(det, /Ø 10\.0 CS\/min in 12 games/);
    assert.match(det, /Threshold: 9\.5/);
    assert.match(det, /Season \d{4}/);
    // no text key without a translation
    assert.doesNotMatch(app.$('#dashTags').innerHTML, /\btags?\.[a-zA-Z]+\.?[a-zA-Z]*\b(?![^<]*>)/);
    // another account: nothing played → too little data everywhere, no strengths
    app.$(`[data-ovacc="${P(2)}"]`).dispatchEvent(new app.w.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await app.settle();
    assert.match(app.$('#tagBody').textContent, /No ranked games this season yet|Nothing yet/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
