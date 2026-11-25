// Live, more (live-more.js) in the real window: premade badges, "do I know them?", the own record
// against the lane opponent's champion, the damage mix, the helper by phase.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, scoutReply } = require('./harness');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const now = Date.now();
let gid = 5000;
// a stored game; slots: { index: player overrides } (0–4 blue, 5–9 red)
function game(slots, hoursAgo) {
  const players = Array.from({ length: 10 }, (_, i) => ({ puuid: `z${gid}${i}`, name: 'N', tag: 'EUW', team: i < 5 ? 100 : 200, champ: 300 + i, pos: POS[i % 5],
    win: i < 5, k: 2, d: 2, a: 2, cs: i % 5 === 4 ? 20 : 180, gold: 9000, dmg: 15000, vis: 20, lvl: 14, items: i % 5 === 4 ? [3877] : [0],
    spells: i % 5 === 1 ? [11, 4] : [4, 14], x: { phys: 9000, magic: 1000, true: 0 } }));
  for (const [i, o] of Object.entries(slots)) players[i] = { ...players[i], ...o };
  return { id: String(gid++), t: now - hoursAgo * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 4, players };
}
const card = (puuid, champ, position) => ({ puuid, gameName: 'G' + puuid, tagLine: 'EUW', championId: champ, position, iconId: 1, level: 200, solo: null, flex: null });
const inGame = { queueId: 420, gameId: 1,
  teamOne: [card('a5', 86, 'TOP'), card('a2', 64, 'JUNGLE'), card(P(1), 103, 'MIDDLE'), card('a3', 222, 'BOTTOM'), card('a4', 412, 'UTILITY')],
  teamTwo: [card('e1', 24, 'TOP'), card('e2', 266, 'JUNGLE'), card('e3', 238, 'MIDDLE'), card('e4', 51, 'BOTTOM'), card('e5', 117, 'UTILITY')] };
// e1 and e2 twice in one team before: a party (top + jungle, side by side)
const theirs = [game({ 0: { puuid: 'e1' }, 1: { puuid: 'e2' } }, 30), game({ 0: { puuid: 'e1' }, 1: { puuid: 'e2' } }, 50)];
// an own game 2 hours ago: e3 was my lane opponent on Zed (238), I won on Ahri (103)
const own = game({ 2: { puuid: P(1), champ: 103, win: true }, 7: { puuid: 'e3', champ: 238, win: false } }, 2);

test('live board: a party gets a badge, "do I know them?", my record, the damage mix', async () => {
  const app = await boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame },
    'scout-games': scoutReply({ e1: { games: theirs }, e2: { games: theirs } }),
    matches: { index: [[own.id, own.t, 420, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [own],
    'champ-damage': { 86: 'kPhysical', 64: 'kPhysical', 222: 'kPhysical', 412: 'kMagic', 24: 'kPhysical', 266: 'kPhysical', 51: 'kPhysical', 117: 'kMagic' },
    champions: [{ id: 238, name: 'Zed' }, { id: 103, name: 'Ahri' }, { id: 24, name: 'Jax' }, { id: 266, name: 'Aatrox' }],
  } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const c = id => app.$(`.sc-card[data-sc="${id}"]`);
    // the party: the same numbered badge in the same colour on both cards, inside the card head
    assert.ok(c('e1').dataset.party && c('e1').dataset.party === c('e2').dataset.party);
    // the badge: two heads (a party of two) and its number in the team
    assert.equal(c('e1').querySelector('.sc-head .sc-party').textContent, '1');
    assert.equal(c('e1').querySelector('.sc-party .sc-ppl').dataset.n, '2');
    assert.equal(c('e1').querySelectorAll('.sc-ppl circle').length, 2);
    assert.equal(c('e1').className.match(/pa\d/)[0], c('e2').className.match(/pa\d/)[0]);
    assert.ok(!c('e3').dataset.party && !c('e3').querySelector('.sc-party'));
    assert.match(c('e1').querySelector('.sc-party').title, /Party with Ge2#EUW · together in 2 of the last 2 games/);
    // hovering one lights up the partner
    c('e1').dispatchEvent(new (c('e1').ownerDocument.defaultView.MouseEvent)('mouseover', { bubbles: true }));
    assert.ok(c('e2').classList.contains('hl') && !c('e3').classList.contains('hl'));
    // do I know them: e3 was my opponent 2 hours ago – a click opens that game
    const know = [...c('e3').querySelectorAll('.tchip')].find(x => /Last game: enemy \(Zed\)/.test(x.textContent));
    assert.ok(know, c('e3').querySelector('.sc-tags').textContent);
    assert.equal(know.dataset.opengame, own.id);
    // my record against my lane opponent's champion
    assert.match(c(P(1)).querySelector('.sc-tags').textContent, /Vs Zed: 1–0 · 100 %/);
    // the damage mix of both teams, enemies first
    const mixes = app.$$('.mix');
    assert.equal(mixes.length, 2);
    assert.match(mixes[0].textContent, /Enemies/);
    assert.match(mixes[0].textContent, /% AD/);
    // a game on: no helper
    assert.ok(!app.$('#liveBody .helper') && !app.$('#liveBody .pool-box'));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('post-game: the own tags before / after this game; it stays until the next champ select', async () => {
  // 12 older games at 7.5 CS/min, then this one at 15 CS/min: "great farmer" is new with this game
  const older = Array.from({ length: 12 }, (_, i) => game({ 2: { puuid: P(1), cs: 225 } }, 30 + i));
  const last = game({ 2: { puuid: P(1), cs: 450 } }, 1);
  const all = [last, ...older];
  const replies = {
    matches: { index: all.map(g => [g.id, g.t, 420, P(1)]), waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': all,
  };
  const app = await boot({ replies: { ...replies, live: { clientUp: true, phase: 'Lobby', me: P(1) } } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    assert.ok(app.$('.pg-card'), 'the post-game overview');
    const row = app.$('.pgt-row');
    assert.ok(row, 'the tag changes');
    const up = [...row.querySelectorAll('.pgt.up')].map(x => x.textContent);
    assert.ok(up.some(x => /Great farmer/.test(x)), up.join(' | '));
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('live board: blue on top even when I am on red; my record still against my lane opponent', async () => {
  const red = { queueId: 420, gameId: 1, teamOne: inGame.teamTwo, teamTwo: inGame.teamOne };
  const app = await boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame: red },
    'scout-games': { players: {} },
    matches: { index: [[own.id, own.t, 420, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [own],
    champions: [{ id: 238, name: 'Zed' }, { id: 103, name: 'Ahri' }],
  } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const rows = app.$$('.sc-row').map(r => [...r.querySelectorAll('.sc-card')].map(x => x.dataset.sc));
    assert.deepEqual(rows[0], ['e1', 'e2', 'e3', 'e4', 'e5']);
    assert.ok(rows[1].includes(P(1)));
    assert.ok(app.$(`.sc-card.bot.me[data-sc="${P(1)}"]`));
    assert.match(app.$(`.sc-card[data-sc="${P(1)}"] .sc-tags`).textContent, /Vs Zed: 1–0 · 100 %/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('live board: in Flex four premades mean all five; the badge shows five heads', async () => {
  // e1–e4 together twice before, e5 never
  const four = { 0: { puuid: 'e1' }, 1: { puuid: 'e2' }, 2: { puuid: 'e3' }, 3: { puuid: 'e4' } };
  const prev = [game(four, 30), game(four, 50)];
  const flex = { ...inGame, queueId: 440 };
  const scout = Object.fromEntries(['e1', 'e2', 'e3', 'e4'].map(p => [p, { games: prev }]));
  const boot1 = q => boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame: { ...flex, queueId: q } },
    'scout-games': scoutReply(scout),
    matches: { index: [], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [],
  } });
  let app = await boot1(440);
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const c = id => app.$(`.sc-card[data-sc="${id}"]`);
    const party = c('e1').dataset.party;
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) {
      assert.equal(c(id).dataset.party, party, id);
      assert.equal(c(id).querySelector('.sc-ppl').dataset.n, '5', id);
    }
    assert.match(c('e5').querySelector('.sc-party').title, /Flex can’t be queued as four/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
  // a normal game: four can queue, the fifth stays alone
  app = await boot1(400);
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    assert.equal(app.$('.sc-card[data-sc="e1"] .sc-ppl').dataset.n, '4');
    assert.ok(!app.$('.sc-card[data-sc="e5"]').dataset.party);
  } finally { app.close(); }
});

test('live board: the own lobby is a party, even without earlier games together', async () => {
  const app = await boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame: { ...inGame, party: [P(1), 'a3', 'someone-else'] } },
    'scout-games': { players: {}, games: [] },
    matches: { index: [], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [],
  } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const c = id => app.$(`.sc-card[data-sc="${id}"]`);
    assert.ok(c(P(1)).dataset.party && c(P(1)).dataset.party === c('a3').dataset.party);
    assert.equal(c('a3').querySelector('.sc-party .sc-ppl').dataset.n, '2');
    assert.match(c('a3').querySelector('.sc-party').closest('[title]').title, /Your lobby: G/);
    assert.ok(!c('a2').dataset.party);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('live board: two others met once before – when, the other by his champion now, this one by his champion then', async () => {
  // e4 played Jax (24) against e5 on Aatrox (266) three hours ago; now e4 is on 51, e5 on 117
  const once = game({ 0: { puuid: 'e4', champ: 24 }, 5: { puuid: 'e5', champ: 266 } }, 3);
  const app = await boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame },
    'scout-games': scoutReply({ e4: { games: [once] }, e5: { games: [once] } }),
    matches: { index: [], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [],
    champions: [{ id: 24, name: 'Jax' }, { id: 266, name: 'Aatrox' }, { id: 51, name: 'Caitlyn' }, { id: 117, name: 'Lulu' }],
  } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const chip = id => [...app.$(`.sc-card[data-sc="${id}"]`).querySelectorAll('.tchip')].map(x => x.textContent).find(x => /against/.test(x));
    const hours = new Date().getHours();
    const day = hours >= 3 ? 'Today' : 'Yesterday';
    assert.equal(chip('e4'), `${day}: against Lulu (as Jax)`);
    assert.equal(chip('e5'), `${day}: against Caitlyn (as Aatrox)`);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('live board: no "do I know them?" on my own premades; without lanes the record shows its numbers', async () => {
  // a2 queued with me (the client's lobby) and played with me 3 hours ago – no chip for that
  const withMate = game({ 2: { puuid: P(1), champ: 103, win: true }, 1: { puuid: 'a2', champ: 64 }, 7: { puuid: 'e3', champ: 238, win: false } }, 3);
  const aram = { ...inGame, queueId: 450, party: [P(1), 'a2'] };
  const app = await boot({ replies: {
    live: { clientUp: true, phase: 'InProgress', me: P(1), inGame: aram },
    'scout-games': scoutReply({}),
    matches: { index: [[withMate.id, withMate.t, 420, P(1)]], waiting: 0, loadingOlder: false, clientUp: true },
    'matches-get': [withMate],
    champions: [{ id: 238, name: 'Zed' }, { id: 103, name: 'Ahri' }, { id: 64, name: 'Lee Sin' }],
  } });
  try {
    await app.click('#navLive');
    for (let i = 0; i < 4; i++) await app.settle();
    const c = id => app.$(`.sc-card[data-sc="${id}"]`);
    assert.ok(c('a2').dataset.party, 'a2 is in my party');
    assert.ok(![...c('a2').querySelectorAll('.tchip')].some(x => /Team|team/.test(x.textContent)), c('a2').querySelector('.sc-tags').textContent);
    // e3 (not a premade) still gets it
    assert.ok([...c('e3').querySelectorAll('.tchip')].some(x => /enemy \(Zed\)/.test(x.textContent)));
    // no lanes: the chip itself says the record against each enemy champion
    assert.match(c(P(1)).querySelector('.sc-tags').textContent, /Your record vs\. their champions: Zed 1–0/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
