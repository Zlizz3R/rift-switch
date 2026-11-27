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
    // mastery over all accounts; OTP of Ahri (12 of 12 – from 10 games on)
    assert.match(app.$('#tagBody').textContent, /Millionaire: Illaoi/);
    assert.match(app.$('#tagBody').textContent, /Ahri OTP/);
    // the groups show only met tags; the rest is in "All possible tags", folded at first
    assert.equal(app.$$('.tag-group:not(.tag-all) .tchip.tc-not, .tag-group:not(.tag-all) .tchip.tc-few').length, 0);
    assert.ok(!app.$('.tag-all .tchip'));
    assert.match(app.$('.tag-all-h').textContent, /All possible traits/);
    await app.click('[data-tagall]');
    const all = () => app.$('.tag-all');
    // too little data: the games so far and the games needed (late game: no long games, 5 needed)
    const few = [...all().querySelectorAll('.tchip.tc-few')].find(c => /Late-game/.test(c.textContent));
    assert.match(few.textContent, /0\/5/);
    // hover: what it measures first, then the own value and the thresholds of this role (mid:
    // weak ≤ 6.4 … master ≥ 7.8) and where they come from
    const farmAll = [...all().querySelectorAll('.tchip')].find(c => /Great farmer/.test(c.textContent));
    assert.match(farmAll.title, /^CS per minute \(minions and monsters\)/);
    assert.match(farmAll.title, /Thresholds for Mid: Master ≥ 7\.8 · Good ≥ 7\.3 · Weak ≤ 6\.4 · Very weak ≤ 5\.9\nThe thresholds come from/);
    assert.match(all().querySelector('.tchip.tc-not').title, /\n\nNot met\nYour value: /);
    // the tags only Live shows are not here at all
    for (const re of [/Autofill/i, /Main taken/i, /Main banned/i, /New to/i]) assert.ok(![...all().querySelectorAll('.tchip')].some(c => re.test(c.textContent)), String(re));
    // a click in "All possible tags" opens the numbers there, with what the tag measures
    await app.click(farmAll);
    assert.ok(all().querySelector('.tdetail'));
    assert.match(all().querySelector('.tdetail .tdesc').textContent, /^CS per minute/);
    await app.click('[data-tagall]');
    assert.ok(!app.$('.tag-all .tchip'));
    // a click: the numbers behind the tag
    const farm = app.$$('.tag-group .tchip').find(c => /Great farmer/.test(c.textContent));
    await app.click(farm);
    const det = app.$('.tdetail').textContent;
    assert.match(det, /Ø 10\.0 CS\/min in 12 games/);
    assert.match(det, /Threshold: 7\.8/);
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

test('tags: "All roles" – the role tags carry their role and its share of the games', async () => {
  const app = await boot({ replies });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="tags"]');
    await app.settle();
    await app.click('[data-trole="all"]');
    assert.ok(app.$('[data-trole="all"]').classList.contains('on'));
    assert.match(app.$('#tagSub').textContent, /12 ranked games this season · Mid 100 %/);
    const farm = app.$$('.tag-group .tchip').find(c => /Great farmer/.test(c.textContent));
    assert.ok(farm.querySelector('img.tc-role'));
    assert.match(farm.title, /Mid: 100 % of the games/);
    await app.click(farm);
    assert.match(app.$('.tdetail').textContent, /Mid: 100 % of the games/);
    // tags without a role: no icon
    const otp = app.$$('.tag-group .tchip').find(c => /Ahri OTP/.test(c.textContent));
    assert.ok(!otp.querySelector('img.tc-role'));
    assert.doesNotMatch(app.$('#dashTags').innerHTML, /\btags?\.[a-zA-Z]+\.?[a-zA-Z]*\b(?![^<]*>)/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

// ARAM: 14 ARAM games of account 2 (and the 12 ranked ones of account 1): the Traits tab starts on
// ARAM for an ARAM player, its own catalogue without roles; "At a glance" the same
test('traits: ARAM players get ARAM traits – the tab starts on ARAM, no roles, its own catalogue', async () => {
  const aram = Array.from({ length: 14 }, (_, i) => {
    const players = [...POS.map((_, j) => player(100, j, { pos: '' })), ...POS.map((_, j) => player(200, j, { pos: '' }))];
    // lots of damage and healing, a triple kill in half of the games, wins
    players[0] = { ...players[0], puuid: P(2), champ: 103, k: 14, d: 4, a: 20, dmg: 70000, multi: i % 2 ? 3 : 1, x: { taken: 90000, mitig: 60000, heal: 26000, cc: 50 } };
    return { id: String(700 + i), t: now - (i + 1) * 3600000, dur: 1200, q: 450, mode: 'ARAM', remake: false, v: 3, players };
  });
  const all = [...games, ...aram];
  const app = await boot({ replies: { ...replies, matches: { index: all.map(g => [g.id, g.t, g.q, g.players.some(p => p.puuid === P(2)) ? P(2) : P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': all } });
  try {
    await app.click('#navDash');
    // only account 2 (the ARAM player)
    app.$(`[data-ovacc="${P(2)}"]`).dispatchEvent(new app.w.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await app.click('[data-dt="tags"]');
    await app.settle();
    assert.ok(app.$('[data-tmode="aram"]').classList.contains('on'), 'more ARAM games: ARAM first');
    assert.ok(!app.visible('#tagRole'), 'no roles in ARAM');
    assert.match(app.$('#tagSub').textContent, /14 ARAM games this season/);
    const strong = app.$$('.tag-top > div')[0].textContent;
    assert.match(strong, /Damage dealer ★/);
    assert.match(strong, /Healing machine ★/);
    assert.match(strong, /Frontliner ★/);
    assert.match(app.$('#tagBody').textContent, /Multikill hunter/);
    assert.match(app.$('#tagBody').textContent, /Hot streak/);
    assert.match(app.$('#tagBody .coll-foot').textContent, /Only this season's ARAM games count/);
    // the ARAM catalogue in "All possible traits": no lane traits there
    await app.click('[data-tagall]');
    const allTxt = app.$('.tag-all').textContent;
    assert.match(allTxt, /CC machine/);
    assert.doesNotMatch(allTxt, /Lane tyrant|Great farmer|Ward hunter/);
    // the other way: Summoner's Rift has no games of this account
    await app.click('[data-tmode="sr"]');
    assert.ok(app.visible('#tagRole'));
    assert.match(app.$$('.tag-top > div')[0].textContent, /Nothing yet/);
    // Performance: ARAM first (no queues picked by hand yet), its cards for ARAM (team share, activity)
    await app.click('[data-dt="stats"]');
    await app.settle();
    assert.ok(app.$('[data-pq="aram"]').classList.contains('on'));
    assert.ok(!app.$('[data-pq="solo"]').classList.contains('on'));
    assert.ok(app.$('.pc-share'), 'the share of the team');
    assert.match(app.$('.pc-share').textContent, /Damage[\s\S]*Healing/);
    assert.ok(app.$('.pc-act'), 'activity instead of the radar');
    assert.match(app.$('.pf-traits').textContent, /Damage dealer/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
