// The player page (player-view.js) in the real window: any player's games in the Overview's tabs –
// Performance, Traits, Mastery, Match history, Seasons – "open with", and Live's trait tiers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P } = require('./harness');
const Tags = require('../ui/tags');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const now = Date.now();
// 12 lite games of player "x1" from his match list: mid, Ahri (103), 9 wins
const lite = Array.from({ length: 12 }, (_, i) => ({ id: String(800 + i), t: now - (i + 1) * 3600000, dur: 1800, q: 420, mode: 'CLASSIC', remake: false, v: 0, lite: true,
  k: `${800 + i}:0.900`, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1', team: 100, champ: 103, pos: 'mid', win: i < 9, k: 8, d: 2, a: 6, cs: 270, dmg: 25000, vis: 20, spells: [4, 14] }] }));
const info = { puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', iconId: 7, level: 412, solo: { tier: 'CHALLENGER', division: 'I', lp: 1400, wins: 300, losses: 200 }, flex: null };

test('player page: rank, then the Overview tabs for any player – performance, traits, mastery, match history, seasons', async () => {
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: lite, info, mastery: { 103: 1500000 }, progress: { listed: true, done: 3, total: 12 } }),
    champions: [{ id: 103, name: 'Ahri', alias: 'Ahri' }],
    'open-external': true,
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', region: 'EUW' })`);
    await app.settle();
    await new Promise((r) => setTimeout(r, 30));
    await app.settle();
    assert.ok(app.visible('#viewPlayer'));
    const head = app.$('#plHead').textContent;
    assert.match(head, /Faker/);
    assert.match(head, /#KR1/);
    assert.match(head, /Level 412/);
    assert.match(head, /Challenger/);
    // the details still loading
    assert.match(app.$('#plHead .pl-prog').textContent, /3 \/ 12/);
    const body = app.$('#plBody').textContent;
    assert.match(body, /12 games known/);
    // the Overview's tabs, Performance first (no LP history: there is none for another player)
    assert.deepEqual(app.$$('[data-pltab]').map(b => b.textContent), ['Performance', 'Traits', 'Mastery', 'Match history', 'Seasons']);
    assert.ok(app.$('[data-pltab="stats"]').classList.contains('on'));
    // Performance: the key figures and traits, then champions, roles, play style and map – no accounts
    // column, no jumps into the own match history
    const strip = app.$('#plBody .perf-strip').textContent;
    assert.match(strip, /75 %/);           // 9 of 12
    assert.match(strip, /7\.00/);           // (8 + 6) / 2
    assert.match(app.$('#plBody .pf-traits').textContent, /Ahri OTP/, 'traits from his games');
    assert.match(app.$$('#plBody .pc-roles .sro')[0].textContent, /Mid[\s\S]*100 %/);
    assert.equal(app.$('#plBody [data-ppin]'), null);
    assert.match(app.$('#plBody .pc-champs .oc-list').textContent, /Ahri[\s\S]*75 %/);
    // a champion picks only its games here too – never a jump into the own match history
    assert.equal(app.$('#plBody [data-pchampmh]'), null);
    await app.click('#plBody .oc-row[data-pchamp="103"]');
    assert.ok(app.$('#plBody .oc-row[data-pchamp="103"]').classList.contains('on'));
    assert.match(app.$('#plBody .pf.games').textContent, /Games\s*12/);
    await app.click('#plBody .oc-row[data-pchamp="103"]');
    assert.equal(app.$('#plBody .oc-row.on'), null);
    assert.ok(app.$('#plBody .pc-style .rd-head'));
    // another player: the play profile – areas without figures, never against the lane opponent
    assert.ok(app.$('#plBody .pc-style svg.radar.gpi'));
    assert.match(app.$('#plBody .pc-style').textContent, /Fighting[\s\S]*Versatility/);
    assert.doesNotMatch(app.$('#plBody .pc-style').textContent, /lane opponent/);
    assert.match(app.$('#plBody .pc-map').textContent, /No deaths or kills with a place yet/, 'lite games have no timeline');
    // the splash art of the champion played most (Ahri)
    assert.equal(app.$('#plArt').dataset.alias, 'ahri');
    await app.click('[data-plsite="opgg"]');
    const ext = app.called('open-external').pop();
    assert.match(String(ext.args[0]), /op\.gg\/lol\/summoners\/euw\/Faker-KR1/);
    // all games / ranked
    await app.click('[data-plq="all"]');
    assert.ok(app.$('[data-plq="all"]').classList.contains('on'));
    assert.doesNotMatch(app.$('#plBody').innerHTML, /\b(pl|tags?|perf)\.[a-zA-Z]+\b(?![^<]*>)/, 'no text key without a translation');
    await app.click('[data-plrole="top"]');
    assert.match(app.$('#plBody').textContent, /No games match/);
    await app.click('[data-plrole=""]');
    // Traits → : the Overview's traits page for him
    await app.click('#plBody .pf-traits [data-ovgo="tags"]');
    assert.ok(app.$('[data-pltab="tags"]').classList.contains('on'));
    assert.match(app.$('#plBody .tag-top').textContent, /Your strengths/);
    assert.match(app.$('#plBody').textContent, /Ahri OTP/);
    // another player: nothing that shames (Riot's policies) – no "to work on", no list of every trait
    assert.doesNotMatch(app.$('#plBody .tag-top').textContent, /To work on/);
    assert.equal(app.$('#plBody [data-tagall]'), null);
    assert.match(app.$('#plBody .coll-foot').textContent, /only what speaks for them/);
    // Mastery: his points and the play time behind them
    await app.click('[data-pltab="mast"]');
    assert.match(app.$('#plBody .mast-card').textContent, /Ahri[\s\S]*1,500,000[\s\S]*≈ [\d,]+ h/);
    assert.match(app.$('#plBody .mast-totals').textContent, /Mastery points\s*1,500,000/);
    // Match history: his games as rows; one from his match list only has nothing to unfold
    await app.click('[data-pltab="matches"]');
    assert.equal(app.$$('#plBody .mh-row').length, 12);
    assert.ok(app.$('#plBody .mh-row.win') && app.$('#plBody .mh-row.loss'));
    assert.match(app.$('#plBody .mh-tot').textContent, /12\s*games/);
    assert.match(app.$('#plBody .pl-with').textContent, /Never in one of your stored games/);
    await app.click(app.$('#plBody .mh-row .mh-meta'));
    assert.equal(app.$('#plBody .mh-det'), null);
    // Seasons: what the client tells and his stored games – nothing typed in by you
    await app.click('[data-pltab="seasons"]');
    assert.match(app.$('#plBody .ss-acc').textContent, /From the client[\s\S]*From stored games/);
    assert.doesNotMatch(app.$('#plBody').textContent, /Entered by you/);
    assert.equal(app.$('#plBody [data-ssedit]'), null);
    // back to the own accounts
    await app.click('#plMine');
    assert.ok(app.visible('#viewDash'));
    assert.ok(app.$('#ovSearchSlot #plSearch'), 'the search moved back into the Overview');
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('player page: the window sends the keys of the games it holds; "player-changed" loads again', async () => {
  let n = 0;
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: n++ ? [] : lite, info, mastery: null, progress: { listed: true, done: 12, total: 12 } }),
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1' })`);
    await app.settle();
    await app.emit('player-changed', { puuid: 'x1', progress: { listed: true, done: 12, total: 12 } });
    await new Promise((r) => setTimeout(r, 2200));
    await app.settle();
    const calls = app.called('player-games');
    assert.ok(calls.length >= 2);
    assert.deepEqual([...calls[calls.length - 1].args[1]].sort(), lite.map(g => g.k).sort());
    assert.match(app.$('#plBody .pf.games').textContent, /Games\s*12/, 'still there after a reply without games');
    // loaded: no progress bar
    assert.equal(app.$('#plHead .pl-prog'), null);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('player page: the progress bar moves with every message; the games are fetched every 2 s while messages keep coming', async () => {
  const app = await boot({ replies: {
    'player-games': () => ({ ids: [], games: [], info, mastery: null, progress: { listed: true, done: 0, total: 12 } }),
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1' })`);
    await app.settle();
    assert.match(app.$('#plHead .pl-prog').textContent, /0 %/);
    const before = app.called('player-games').length;
    for (let i = 1; i <= 6; i++) {
      await app.emit('player-changed', { puuid: 'x1', progress: { listed: true, done: i, total: 12 } });
      assert.equal(app.$('#plHead .pl-prog b').textContent, `${Math.round((100 * i) / 12)} %`, 'at once, without a tab switch');
      await new Promise((r) => setTimeout(r, 500));
    }
    // three seconds of messages: fetched again meanwhile (a restarted timer would wait for them to stop)
    assert.ok(app.called('player-games').length > before);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('player page: League closed – a note instead of a progress bar stuck at 5 %; it goes on once League is open', async () => {
  const { sampleState } = require('./harness');
  const st = sampleState({ live: { clientUp: false, puuid: null, phase: null, waits: [] } });
  let listed = false;
  const app = await boot({ state: st, replies: {
    'player-games': () => ({ ids: listed ? lite.map(g => g.id) : [], games: listed ? lite : [], info: null, mastery: null, progress: { listed, done: 0, total: listed ? 12 : 0 } }),
    'find-player': () => null,
  } });
  try {
    app.w.eval(`openPlayer({ puuid: 'x1', gameName: 'Faker', tagLine: 'KR1', region: 'EUW' })`);
    await app.settle();
    assert.equal(app.$('#plHead .pl-prog'), null, 'no progress bar while nothing can come');
    assert.match(app.$('#plHead .pl-note').textContent, /League isn't open/);
    assert.match(app.$('#plBody').textContent, /League isn't open/);
    // the search says why too
    const inp = app.$('#plSearch');
    await app.type(inp, 'Nobody#X');
    await app.key('Enter', inp);
    await app.settle();
    assert.match(app.$('#toast').textContent, /looking up a Riot ID needs the League client/);
    // League opens: asked again, the list comes
    listed = true;
    const before = app.called('player-games').length;
    await app.push({ ...st, live: { clientUp: true, puuid: P(1), phase: 'Lobby', waits: [] } });
    await app.settle();
    assert.ok(app.called('player-games').length > before, 'loaded again');
    assert.equal(app.$('#plHead .pl-note'), null);
    assert.match(app.$('#plHead .pl-prog').textContent, /0 \/ 12/);
    // champion select: Live goes first – the page says so
    await app.push({ ...st, live: { clientUp: true, puuid: P(1), phase: 'ChampSelect', waits: [] } });
    assert.match(app.$('#plHead .pl-note').textContent, /Live goes first/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});

test('other players: no weak levels, no bad or warn tags – the own accounts see everything (Riot\'s policies: no shaming)', () => {
  const r = [
    { id: 'farm', state: 'met', level: 'master' }, { id: 'kda', state: 'met', level: 'weak' }, { id: 'deaths', state: 'met', level: 'terrible' },
    { id: 'lossStreak', state: 'met', color: 'bad' }, { id: 'smurf', state: 'met', color: 'warn' }, { id: 'newTo', state: 'met', color: 'warn', live: true },
    { id: 'otp', state: 'met', color: 'good' }, { id: 'generalist', state: 'met', color: 'info' }, { id: 'readyToRumble', state: 'met', color: 'warn' },
    { id: 'gankVictim', state: 'not', color: 'bad' },
  ];
  assert.deepEqual(Tags.forOthers(r).map(x => x.id), ['farm', 'otp', 'generalist', 'readyToRumble', 'gankVictim']);
});

test('trait tiers: what to act on first, background last; another champion\'s trait is background', () => {
  assert.equal(Tags.tierOf({ id: 'gankVictim' }), 1);
  assert.equal(Tags.tierOf({ id: 'fbVictim' }), 1);
  assert.equal(Tags.tierOf({ id: 'autofill', live: true }), 1);
  assert.equal(Tags.tierOf({ id: 'earlyFarm', level: 'great' }), 2);
  assert.equal(Tags.tierOf({ id: 'deaths', level: 'weak' }), 1);
  assert.equal(Tags.tierOf({ id: 'deaths', level: 'great' }), 2);
  assert.equal(Tags.tierOf({ id: 'mastery', champ: 420 }, { champ: 420 }), 3);
  // a millionaire on Illaoi while playing Yorick: background
  assert.equal(Tags.tierOf({ id: 'otp', champ: 420 }, { champ: 83 }), 3);
  assert.equal(Tags.tierOf({ id: 'otp', champ: 83 }, { champ: 83 }), 1);
  // one role only, and he got that role: background
  assert.equal(Tags.tierOf({ id: 'oneRole' }, { position: 'top', main: 'top' }), 3);
  assert.equal(Tags.tierOf({ id: 'smallPool' }), 3);
});

test('player search: suggestions from your games, Enter opens; an unknown Riot ID is looked up through the client', async () => {
  const app = await boot({ replies: {
    'player-games': () => ({ ids: lite.map(g => g.id), games: lite, info, mastery: null, progress: { listed: true, done: 12, total: 12 } }),
    'find-player': (q) => (String(q).toLowerCase() === 'caps#euw' ? { puuid: 'x2', gameName: 'Caps', tagLine: 'EUW', region: 'EUW' } : null),
  } });
  try {
    const inp = app.$('#plSearch');
    assert.ok(inp && /Name#Tag/.test(inp.placeholder));
    app.w.eval(`scv.own = [{ id: '1', t: 1, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1' }, { puuid: 'x3', name: 'Fakeman', tag: 'EUW' }, { puuid: '${P(1)}', name: 'Me', tag: 'EUW' }] },
      { id: '2', t: 2, players: [{ puuid: 'x1', name: 'Faker', tag: 'KR1' }] }]`);
    await app.type(inp, 'fak');
    const sug = app.$$('.pl-sug');
    assert.equal(sug.length, 2);
    // most games with you first
    assert.match(sug[0].textContent, /Faker#KR12 games with you/);
    await app.key('ArrowDown', inp);
    assert.ok(app.$$('.pl-sug')[0].classList.contains('on'));
    await app.key('Enter', inp);
    await app.settle();
    assert.ok(app.visible('#viewPlayer'));
    assert.match(app.$('#plHead').textContent, /Faker/);
    assert.equal(inp.value, '');
    assert.equal(app.called('find-player').length, 0, 'known: no lookup');
    // somebody never met: through the client
    await app.type(inp, 'Caps#EUW');
    assert.equal(app.$$('.pl-sug').length, 0);
    await app.key('Enter', inp);
    await app.settle();
    assert.deepEqual(app.called('find-player').pop().args, ['Caps#EUW']);
    assert.equal(app.called('player-games').pop().args[0], 'x2');
    // not found: a message
    await app.type(inp, 'Nobody#X');
    await app.key('Enter', inp);
    await app.settle();
    assert.match(app.$('#toast').textContent, /No player “Nobody#X” found/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
