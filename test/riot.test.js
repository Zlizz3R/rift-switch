// Parsing of what the Riot / League client answers, rank math, match history, texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const riot = require('../src/riot');
const RM = require('../src/rankmath');
const lcuEvents = require('../src/lcuevents');
const matches = require('../src/matches');
const i18n = require('../src/i18n');

const DAY = 86400000;

test('ranked stats: other accounts report losses as 0 -> win/loss unknown', () => {
  const stats = { queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'I', leaguePoints: 50, wins: 10, losses: 0 },
    RANKED_FLEX_SR: { tier: 'NONE' } } };
  assert.equal(riot.pickQueue(stats, 'RANKED_SOLO_5x5', false).wl, false);
  assert.equal(riot.pickQueue(stats, 'RANKED_SOLO_5x5', true).wl, true);
  assert.equal(riot.pickQueue(stats, 'RANKED_FLEX_SR', true), null);
  assert.equal(riot.pickQueue(null, 'RANKED_SOLO_5x5', true), null);
});

test('decay counter is read for Solo/Duo and Flex, even with the warning flag off', () => {
  // exactly what the client answered for a Flex Diamond IV account
  const stats = { queueMap: {
    RANKED_SOLO_5x5: { tier: 'EMERALD', warnings: null },
    RANKED_FLEX_SR: { tier: 'DIAMOND', warnings: { daysUntilDecay: 28, demotionWarning: 0, displayDecayWarning: false, timeUntilInactivityStatusChanges: -1 } },
  } };
  const d = riot.decayOf(stats);
  assert.deepEqual(d.q, { flex: 28 });
  assert.equal(riot.decayOf({ queueMap: { RANKED_SOLO_5x5: { warnings: { daysUntilDecay: -1 } } } }), null);
});

test('decay countdown on the tiles', () => {
  const now = 100 * DAY;
  const a = { puuid: 'a', solo: { tier: 'EMERALD' }, flex: { tier: 'DIAMOND' }, decay: { q: { flex: 28 }, at: now - 3 * DAY } };
  assert.deepEqual(RM.decayInfo(a, 'other', now), { days: 25, est: false, q: 'Flex' });
  assert.equal(RM.decayInfo(a, 'a', now).days, 28);                 // signed in: the fresh number
  assert.equal(RM.decayInfo({ solo: { tier: 'EMERALD' } }, null, now), null);   // below Diamond: no decay
  const est = RM.decayInfo({ solo: { tier: 'MASTER' }, lastPlayed: now - 4 * DAY }, null, now);
  assert.deepEqual(est, { days: 10, est: true, bank: 14, q: 'Solo/Duo' });
  assert.equal(RM.decayInfo({ solo: { tier: 'DIAMOND' }, lastPlayed: now - 90 * DAY }, null, now).days, 0);
});

test('rank score and MMR guess', () => {
  assert.equal(RM.rankScore({ tier: 'IRON', division: 'IV', lp: 0 }), 0);
  assert.equal(RM.rankScore({ tier: 'GOLD', division: 'I', lp: 50 }), 3 * 400 + 300 + 50);
  assert.ok(RM.rankScore({ tier: 'MASTER', lp: 10 }) > RM.rankScore({ tier: 'DIAMOND', division: 'I', lp: 99 }));
  assert.deepEqual(RM.scoreToRank(1550), { tier: 'GOLD', division: 'I' });
  assert.equal(RM.scoreToRank(3000).plus, true);
  const winning = RM.mmrScore({ solo: { tier: 'GOLD', division: 'II', lp: 0, wins: 70, losses: 30, wl: true } });
  assert.ok(winning.diff > 0);
  const unknown = RM.mmrScore({ solo: { tier: 'GOLD', division: 'II', lp: 0, wins: 70, losses: 0, wl: false } });
  assert.equal(unknown.diff, 0);            // no real win/loss -> no nudge
  assert.equal(RM.mmrScore({}), null);
});

test('match list summary: last played, ranked games, normals', () => {
  const games = [
    { gameId: 3, gameCreation: 300, queueId: 420, participants: [{ championId: 1, stats: { win: true } }] },
    { gameId: 2, gameCreation: 200, queueId: 400, participants: [{}] },
    { gameId: 1, gameCreation: 100, queueId: 450, participants: [{}] },
  ];
  const s = riot.summarizeGames(games, 7);
  assert.equal(s.lastPlayed, 300);
  assert.deepEqual(s.ranked, [{ id: 3, t: 300, q: 'solo', win: true, champ: 1 }]);
  assert.deepEqual(s.normals, { count: 1, hasRanked: true, sample: 3, at: 7 });
  assert.deepEqual(s.list.map(g => g.id), [3, 2, 1]);
  assert.equal(riot.summarizeGames(undefined), null);
});

test('"Stay signed in" is detected from the Riot Client settings file', () => {
  // a saved session = JSON with the settings file base64-encoded
  const snap = yaml => JSON.stringify({ files: { 'RiotGamesPrivateSettings.yaml': Buffer.from(yaml).toString('base64') } });
  assert.equal(riot.sessionPersisted(snap('riot-login:\r\n    persist:\r\n        region: "EUW"')), true);
  assert.equal(riot.sessionPersisted(snap('riot-login:\n    persist: null\n')), false);
  assert.equal(riot.sessionPersisted(snap('')), false);
  assert.equal(riot.sessionPersisted('garbage'), false);
});

test('client events: only API events get through', () => {
  assert.deepEqual(lcuEvents.parseEvent('[8,"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",{"uri":"/lol-gameflow/v1/gameflow-phase","eventType":"Update","data":"ReadyCheck"}]'),
    { uri: '/lol-gameflow/v1/gameflow-phase', data: 'ReadyCheck', type: 'Update' });
  assert.equal(lcuEvents.parseEvent('[0,"welcome"]'), null);
  assert.equal(lcuEvents.parseEvent('not json'), null);
  assert.equal(lcuEvents.eventName('/lol-gameflow/v1/gameflow-phase'), 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase');
});

test('match history: compact games, one row per game for two own accounts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-mh-'));
  matches.load(dir);
  const detail = id => ({ gameId: id, gameCreation: id * 1000, gameDuration: 1800, queueId: 420, gameMode: 'CLASSIC',
    participantIdentities: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, player: { puuid: 'p' + i, gameName: 'N' + i, tagLine: 'EUW' } })),
    participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, championId: i + 1, spell1Id: 4, spell2Id: 14,
      stats: { kills: i, deaths: 1, assists: 2, totalMinionsKilled: 100, neutralMinionsKilled: 5, item0: 3031, win: i < 5, perk0: 8112, perkSubStyle: 8300 } })) });
  const g = matches.compact(detail(5));
  assert.equal(g.players.length, 10);
  assert.equal(g.players[3].cs, 105);
  assert.equal(g.players[3].name, 'N3');
  assert.equal(matches.compact({}), null);

  matches.note('p0', [{ id: 5 }, { id: 4 }]);
  matches.note('p1', [{ id: 5 }]);
  assert.deepEqual(matches.missing(), ['5', '4']);
  return matches.fill(async p => detail(Number(p.split('/').pop())), 5).then(got => {
    assert.equal(got, 2);
    const rows = matches.list(['p0', 'p1']);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].owners, ['p0', 'p1']);
    assert.equal(matches.list(['p0'], { queue: 'aram' }).length, 0);
    matches.forget('p0');
    assert.equal(matches.list(['p0', 'p1']).length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('every language has every text with the same placeholders', () => {
  const en = i18n.STRINGS.en;
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const [code] of i18n.LANGS) {
    const L = i18n.STRINGS[code];
    assert.ok(L, code);
    // left in English on purpose: the app's name, the Riot legal notice, the op.gg button
    const missing = Object.keys(en).filter(k => !(k in L) && !['live.allOpgg', 'app.name', 'legal.riot'].includes(k));
    assert.deepEqual(missing, [], code + ' is missing texts');
    for (const k of Object.keys(L)) if (k in en) assert.equal(ph(L[k]), ph(en[k]), `${code} ${k}`);
  }
});

test('platform of the Riot Client account -> server (PBE accounts start the PBE client)', () => {
  assert.equal(riot.platformRegion('PBE1'), 'PBE');
  assert.equal(riot.platformRegion('EUW1'), 'EUW');
  assert.equal(riot.platformRegion(''), '');
});

test('match history filters, sorting and summary', () => {
  const MF = require('../src/matchfilter');
  const now = 100 * DAY;
  const game = (id, daysAgo, k, d, a, win, extra = {}) => ({ id: String(id), t: now - daysAgo * DAY, dur: 1800, owners: ['me'],
    players: [{ puuid: 'me', champ: extra.champ || 1, k, d, a, cs: 180, dmg: 20000 + k * 1000, win, multi: extra.multi || 1 }, { puuid: 'x', k: 0, d: 0, a: 0 }],
    remake: !!extra.remake });
  const games = [game(1, 0.1, 10, 2, 5, true), game(2, 3, 2, 9, 1, false, { champ: 7 }), game(3, 20, 15, 0, 3, true, { multi: 5 }),
    game(4, 40, 4, 4, 4, false), game(5, 1, 0, 0, 0, false, { remake: true })];
  assert.deepEqual(MF.filterGames(games, { range: '7' }, now).map(g => g.id), ['1', '5', '2']);
  assert.deepEqual(MF.filterGames(games, { result: 'win' }, now).map(g => g.id), ['1', '3']);
  assert.deepEqual(MF.filterGames(games, { result: 'loss' }, now).map(g => g.id), ['2', '4']);   // remake is neither
  assert.deepEqual(MF.filterGames(games, { champ: 7 }, now).map(g => g.id), ['2']);
  assert.deepEqual(MF.filterGames(games, { minKills: 10 }, now).map(g => g.id), ['1', '3']);
  assert.deepEqual(MF.filterGames(games, { maxDeaths: '2', minKda: '' }, now).map(g => g.id), ['1', '5', '3']);
  assert.deepEqual(MF.filterGames(games, { minMulti: 5 }, now).map(g => g.id), ['3']);
  assert.equal(MF.filterGames(games, { sort: 'kda' }, now)[0].id, '3');        // 0 deaths = perfect, first
  assert.equal(MF.filterGames(games, { sort: 'deaths' }, now)[0].id, '2');
  const s = MF.summarize(games);
  assert.equal(s.games, 4);                                                   // remake left out
  assert.equal(s.winrate, 50);
  assert.equal(s.records.kills.p.k, 15);
  assert.equal(s.pentas, 1);
  assert.deepEqual(s.streak, { win: true, n: 1 });
  assert.equal(MF.summarize([]), null);
});

test('placeholder tiers before placements (Classic 5v5 "SALT") count as unranked', () => {
  const stats = { queueMap: { JADE_RANKED_SOLO_5x5: { tier: 'SALT', division: 'IV', leaguePoints: 0, wins: 0, losses: 0 } } };
  assert.equal(riot.pickQueue(stats, 'JADE_RANKED_SOLO_5x5', true), null);
  stats.queueMap.JADE_RANKED_SOLO_5x5.wins = 3;
  assert.equal(riot.pickQueue(stats, 'JADE_RANKED_SOLO_5x5', true).tier, 'SALT');   // played: shown as it is
});

test('match history: own date range, both days included', () => {
  const MF = require('../src/matchfilter');
  const at = (y, m, d, h) => new Date(y, m - 1, d, h).getTime();
  const g = (id, t) => ({ id, t, dur: 1800, owners: ['me'], players: [{ puuid: 'me', k: 1, d: 1, a: 1, cs: 1, dmg: 1, win: true }] });
  const games = [g('a', at(2026, 11, 1, 23)), g('b', at(2026, 11, 3, 0)), g('c', at(2026, 11, 5, 23)), g('d', at(2026, 11, 6, 0))];
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-03', to: '2026-11-05' }).map(x => x.id), ['c', 'b']);
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-05', to: '2026-11-03' }).map(x => x.id), ['c', 'b']);
  assert.deepEqual(MF.filterGames(games, { range: 'custom', from: '2026-11-05', to: '' }).map(x => x.id), ['d', 'c']);
  assert.equal(MF.dayStart('bad'), null);
});
