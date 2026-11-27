// The tag engine (ui/tags.js + ui/tag-rules.js): met / not met / too little data, levels per role,
// hysteresis, conflicts, only ranked games.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../ui/tags');
const TR = require('../ui/tag-rules');

const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
const DAY = 86400000;
const NOW = new Date(new Date().getFullYear(), 10, 20, 12).getTime();   // mid-November of this year
function player(team, i, o = {}) {
  return { puuid: `${team}-${i}`, team, champ: 100 + i, pos: POS[i], win: team === 100, k: 3, d: 2, a: 5, cs: i === 4 ? 30 : 200, dmg: 20000, vis: 25,
    spells: i === 1 ? [11, 4] : [4, 14], items: i === 4 ? [3877] : [], x: { turretDmg: 4000, pinks: 2 }, ...o };
}
let nextId = 1;
// one ranked game of "me" on a position (mid by default), hours ago
function game({ q = 420, ago = 1, at = 2, me = {}, dur = 1800, gold } = {}) {
  const players = [...POS.map((_, i) => player(100, i)), ...POS.map((_, i) => player(200, i))];
  players[at] = { ...players[at], puuid: 'me', ...me };
  return { id: String(nextId++), t: NOW - ago * 3600000, dur, q, mode: q === 450 ? 'ARAM' : 'CLASSIC', owners: ['me'], players, gold };
}
const run = (games, o = {}) => T.evaluate({ games, own: ['me'], now: NOW, ...o });
const get = (r, id) => r.results.filter(x => x.id === id);

test('no games: every tag is "too little data", never "not met"', () => {
  const r = run([]);
  for (const id of ['otp', 'flexPool', 'farm', 'kda', 'teamPlayer', 'hotStreak']) {
    const x = get(r, id)[0];
    assert.equal(x.state, 'few', id);
    assert.ok(x.need > 0);
  }
  assert.equal(T.pick(r.results).length, 0);
});

test('only ranked games count; the main role decides the key figures', () => {
  const games = [...Array.from({ length: 12 }, (_, i) => game({ ago: i + 1, me: { cs: 300 } })),       // mid, 10 CS/min
    ...Array.from({ length: 30 }, (_, i) => game({ q: 450, ago: 50 + i }))];                          // ARAM: ignored
  const r = run(games);
  assert.equal(r.main, 'mid');
  const farm = get(r, 'farm')[0];
  assert.equal(farm.state, 'met');
  assert.equal(farm.level, 'master');                     // 10 CS/min ≥ 7.8 (mid)
  assert.equal(farm.n, 12);
  // the support isn't judged on farm; damage against other supports: 20,000 in 30 min = 667/min ≥ 580
  const sup = run(Array.from({ length: 12 }, (_, i) => game({ ago: i + 1, at: 4 })));
  assert.equal(sup.role, 'support');
  assert.equal(get(sup, 'farm').length, 0);
  assert.equal(get(sup, 'damage')[0].level, 'master');
  // every position has its own thresholds: (3 + 5) / 2 = 4 → great for a support (master 4.65),
  // master for a mid (3.75)
  assert.equal(get(sup, 'kda')[0].level, 'great');
  assert.equal(get(run(Array.from({ length: 12 }, (_, i) => game({ ago: i + 1 }))), 'kda')[0].level, 'master');
});

test('only this season: last year\'s ranked games are left out, in the live tags too', () => {
  const thisYear = Array.from({ length: 12 }, (_, i) => game({ ago: i + 1, me: { cs: 300 } }));
  // last December, a lot of them: they would make the farm "terrible"
  const lastYear = Array.from({ length: 40 }, (_, i) => game({ ago: (NOW - new Date(new Date(NOW).getFullYear() - 1, 11, 20).getTime()) / 3600000 + i, me: { cs: 60 } }));
  const farm = get(run([...thisYear, ...lastYear]), 'farm')[0];
  assert.equal(farm.n, 12);
  assert.equal(farm.level, 'master');
  // autofill counts this season's roles only: last year all support, now mid
  const old = Array.from({ length: 40 }, (_, i) => game({ at: 4, ago: (NOW - new Date(new Date(NOW).getFullYear() - 1, 11, 20).getTime()) / 3600000 + i }));
  const r = run([...thisYear, ...old]);
  assert.equal(r.main, 'mid');
  assert.equal(T.liveTags({ games: [...thisYear, ...old], puuid: 'me', champ: 102, mastery: null, position: 'mid', main: r.main, now: NOW }).length, 0);
});

test('levels both ways: deaths – fewer is better', () => {
  const deaths = d => get(run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { d } }))), 'deaths')[0];
  // mid: weak from 8.2, terrible from 9.6, great up to 5.5, master up to 4.3
  assert.equal(deaths(9).level, 'weak');
  assert.ok(T.isWeakness(deaths(9)));
  assert.equal(deaths(10).level, 'terrible');
  assert.equal(deaths(5).level, 'great');
  assert.equal(deaths(4).level, 'master');
  const mid = run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { d: 7 } })));
  assert.equal(get(mid, 'deaths')[0].state, 'not');
});

test('hysteresis: a tag shown before stays until 5 % past its threshold', () => {
  const at = cs => Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { cs } }));
  // mid, great from 7.3 CS/min: 7.2 – not met without history, kept when "great" was shown before
  assert.equal(get(run(at(216)), 'farm')[0].state, 'not');
  assert.equal(get(run(at(216), { prev: new Set(['farm:great']) }), 'farm')[0].level, 'great');
  // 6.8 is more than 5 % below: gone
  assert.equal(get(run(at(204), { prev: new Set(['farm:great']) }), 'farm')[0].state, 'not');
  assert.ok(T.keys(run(at(225)).results).has('farm:great'));
});

test('champion and pool: OTP beats main on the same champion, flexible pool excludes OTP', () => {
  const otp = run(Array.from({ length: 16 }, (_, i) => game({ ago: i + 1, me: { champ: 6 } })));
  assert.equal(get(otp, 'otp')[0].state, 'met');
  assert.equal(get(otp, 'main').length, 0);               // dropped: the OTP tag says it
  assert.equal(get(otp, 'flexPool')[0].state, 'not');
  const pool = run(Array.from({ length: 15 }, (_, i) => game({ ago: i + 1, me: { champ: 1 + (i % 5) } })));
  assert.equal(get(pool, 'flexPool')[0].state, 'met');
  assert.equal(get(pool, 'otp')[0].state, 'not');
  // great with: 6 games at ≥ 60 %
  const wr = run(Array.from({ length: 6 }, (_, i) => game({ ago: i + 1, me: { champ: 9, win: i < 4 } })));
  const gw = get(wr, 'greatWith')[0];
  assert.equal(gw.state, 'met');
  assert.equal(gw.champ, 9);
  assert.equal(gw.vars.wr, 67);
});

test('form: streaks, back after a break, grinder', () => {
  const streak = run([game({ ago: 1 }), game({ ago: 2 }), game({ ago: 3 }), game({ ago: 4, me: { win: false } })]);
  assert.equal(get(streak, 'hotStreak')[0].state, 'met');
  assert.equal(get(streak, 'hotStreak')[0].vars.n, 3);
  assert.equal(get(streak, 'lossStreak')[0].state, 'not');
  const back = run([game({ ago: 20 }), game({ ago: 24 * 20 })]);
  assert.equal(get(back, 'backAgain')[0].state, 'met');
  assert.equal(get(back, 'backAgain')[0].vars.days, 19);
  assert.equal(get(run(Array.from({ length: 50 }, (_, i) => game({ ago: i * 5 + 1 }))), 'grinder')[0].state, 'met');
});

test('lane gold at 15 minutes against the lane opponent', () => {
  // gold per minute in the order of the players: me (index 2) +600 over the enemy mid (index 7)
  const gold = Array.from({ length: 20 }, (_, m) => Array.from({ length: 10 }, (_, i) => 500 + m * 300 + (i === 2 ? m * 40 : 0)));
  const r = run(Array.from({ length: 6 }, (_, i) => game({ ago: i + 1, gold })));
  const lg = get(r, 'laneGold')[0];
  assert.equal(lg.state, 'met');
  assert.equal(lg.value, 600);
  assert.equal(lg.level, 'great');
  // without gold data: too little data, not "not met"
  assert.equal(get(run(Array.from({ length: 6 }, (_, i) => game({ ago: i + 1 }))), 'laneGold')[0].state, 'few');
});

test('mastery: never read = too little data; the highest step per champion, at most three', () => {
  assert.equal(get(run([]), 'mastery')[0].state, 'few');
  const m = [{ id: 420, total: 2200000, n: 3 }, { id: 74, total: 600000, n: 1 }, { id: 1, total: 150000, n: 1 }, { id: 2, total: 120000, n: 1 }];
  const r = get(run([], { mastery: m }), 'mastery');
  assert.deepEqual(r.map(x => [x.champ, x.level]), [[420, 'millionaire'], [74, 'veteran'], [1, 'expert']]);
});

test('every threshold sits in tag-rules.js; every rule has a known type', () => {
  const types = new Set(['champShare', 'champRecent', 'champWinrate', 'pool', 'poolTop', 'roleSpread', 'phase', 'streak', 'break', 'count', 'level', 'metric', 'carry', 'avg', 'mastery', 'live']);
  for (const r of TR.TAG_RULES) {
    assert.ok(types.has(r.type), r.id);
    if (r.type === 'metric') assert.ok(T.METRICS[r.metric], r.id);
  }
  assert.equal(new Set(TR.TAG_RULES.map(r => r.id)).size, TR.TAG_RULES.length);
});

// ---------- timeline tags (game format 4) ----------
// kills: [second, killer index, victim index, [assist indexes]] – me = index 2 (mid), enemy mid = 7
function tlGame(o = {}) {
  const g = game({ ago: o.ago || 1, at: o.at ?? 2 });
  g.kills = o.kills || [];
  g.csm = Array.from({ length: 31 }, (_, m) => Array.from({ length: 10 }, (_, i) => m * (i === (o.at ?? 2) ? 9 : 6)));
  g.w1 = Array.from({ length: 10 }, (_, i) => (i === (o.at ?? 2) ? (o.ward ?? 90) : null));
  g.drake1 = o.drake1 ?? 100;
  return g;
}
test('timeline tags: solo kills, duels, early deaths, early farm, lane CS, wards, first dragon', () => {
  const kills = [[200, 2, 7, []], [400, 2, 6, []], [700, 2, 8, []], [800, 7, 2, []], [1300, 9, 2, [5]]];
  const r = run(Array.from({ length: 10 }, (_, i) => tlGame({ ago: i + 1, kills })));
  const one = id => get(r, id)[0];
  assert.equal(one('soloFighter').state, 'met');                 // 3 solo kills per game
  assert.equal(one('duelist').state, 'met');                     // 30 of 40 duels
  assert.equal(one('duelist').vars.k, 30);
  assert.equal(one('duelist').n, 40);
  assert.equal(one('unkillable').state, 'met');                  // no death before 10:00
  assert.equal(one('gankVictim').state, 'not');                  // the gank death came after 15:00
  assert.equal(one('readyToRumble').state, 'met');               // a kill at 3:20
  assert.equal(get(r, 'earlyWarder').length, 0);                 // off: the client's timelines have no wards
  assert.equal(one('dragonSlayer').state, 'met');
  assert.equal(one('earlyFarm').value, 135);                     // 9 CS a minute → 135 at 15
  assert.equal(one('earlyFarm').level, 'master');              // mid: master from 123
  assert.equal(one('laneCs').value, 45);                         // 135 − 90
  assert.equal(one('laneCs').level, 'master');
  assert.ok(Math.abs(one('earlyShare').value - 9 / 33) < 1e-9);  // 9 of 9 + 4 × 6
  // games stored before the timeline format: too little data, not "not met"
  const old = run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1 })));
  for (const id of ['soloFighter', 'unkillable', 'earlyFarm', 'laneCs', 'dragonSlayer']) assert.equal(get(old, id)[0].state, 'few', id);
});
test('timeline tags: jungle – ganks, aggressive and passive exclude each other', () => {
  // me = jungler (index 1); kills on the enemy mid (7) and the enemy jungler (6)
  const kills = [[300, 1, 7, []], [400, 2, 8, [1]], [500, 1, 6, []], [600, 3, 9, [1]], [700, 1, 7, [2]]];
  const r = run(Array.from({ length: 6 }, (_, i) => tlGame({ ago: i + 1, at: 1, kills })));
  assert.equal(r.role, 'jungle');
  assert.equal(get(r, 'ganker')[0].state, 'met');
  assert.equal(get(r, 'aggroJungler')[0].state, 'met');          // 5 takedowns before 15:00
  assert.equal(get(r, 'passiveJungler')[0].state, 'not');
  assert.equal(get(r, 'soloFighter').length, 1);
  // a mid laner isn't judged as a jungler
  assert.equal(get(run([tlGame()]), 'ganker').length, 0);
});

test('pool: flexible = no champion over 40 %; small = three champions over 90 % of the games', () => {
  const on = champs => run(champs.map((c, i) => game({ ago: i + 1, me: { champ: c } })));
  // 20 games: 8 / 4 / 4 / 2 / 2 on five champions – 40 %: flexible, not small
  const flex = on([...Array(8).fill(1), ...Array(4).fill(2), ...Array(4).fill(3), 4, 4, 5, 5]);
  assert.equal(get(flex, 'flexPool')[0].state, 'met');
  assert.equal(get(flex, 'smallPool')[0].state, 'not');
  // 9 of 20 on one (45 %): not flexible any more
  assert.equal(get(on([...Array(9).fill(1), ...Array(3).fill(2), ...Array(4).fill(3), 4, 4, 5, 5]), 'flexPool')[0].state, 'not');
  // 19 of 20 on three champions: small pool – something to work on; with OTP only OTP shows
  const small = on([...Array(10).fill(1), ...Array(5).fill(2), ...Array(4).fill(3), 4]);
  const sp = get(small, 'smallPool')[0];
  assert.equal(sp.state, 'met');
  assert.deepEqual(sp.vars, { k: 3, share: 95, n: 20, champs: [1, 2, 3] });
  assert.ok(T.isWeakness(sp));
  const otp = on([...Array(17).fill(1), 2, 3, 4]);
  assert.deepEqual(T.pick(otp.results).filter(x => /Pool|otp/.test(x.id)).map(x => x.id), ['otp']);
  // a losing streak is bad, but not something to work on
  assert.ok(!T.isWeakness({ state: 'met', color: 'bad', group: 'form' }));
});

test('roles: generalist = no role over 66 %; one role only = one role over 90 % of the games', () => {
  // "me" at index 2 (mid) or 0 (top)
  const on = list => run(list.map((at, i) => game({ ago: i + 1, at })));
  const spread = on([...Array(9).fill(2), ...Array(6).fill(0), 1, 1, 3, 3, 4]);   // mid 45 %
  assert.equal(get(spread, 'generalist')[0].state, 'met');
  assert.equal(get(spread, 'oneRole')[0].state, 'not');
  const one = get(on([...Array(19).fill(2), 0]), 'oneRole')[0];                  // mid 95 %
  assert.equal(one.state, 'met');
  assert.deepEqual([one.vars.role, one.vars.pct, one.vars.n], ['mid', 95, 20]);
  assert.ok(T.isWeakness(one));
  assert.equal(get(on([...Array(18).fill(2), 0, 0]), 'oneRole')[0].state, 'not'); // exactly 90 %: not above
  assert.equal(get(on(Array(9).fill(2)), 'oneRole')[0].state, 'few');             // under 10 games
});

test('objectives: the share of the own team\'s dragons and barons the player was in on, per role', () => {
  // "me" plays mid (index 2); per game the team (100) took 2 dragons and a baron, "me" was in on one;
  // the enemy's dragon and the team's grubs don't count
  const g = () => { const x = game({}); x.obj = [[600, 'D', 100, [1, 2]], [900, 'D', 200, [6]], [1000, 'G', 100, [0]], [1200, 'D', 100, [1, 3, 4]], [1500, 'B', 100, [0, 1, 3]]]; return x; };
  const r = run(Array.from({ length: 10 }, g));
  const o = get(r, 'objectives')[0];
  assert.equal(o.n, 10);
  assert.ok(Math.abs(o.value - 1 / 3) < 1e-9);
  assert.equal(o.state, 'not');                                // mid: weak below 14 %, great from 45 %
  // the jungler (index 1) was at all of them: normal for a jungler – no good level there
  const jg = run(Array.from({ length: 10 }, () => { const x = g(); x.players[1] = { ...x.players[1], puuid: 'me' }; x.players[2] = { ...x.players[2], puuid: 'mid' }; return x; }));
  assert.equal(get(jg, 'objectives')[0].state, 'not');
  // one who missed the first dragon in every game (2 of 3): far below the other junglers
  const jgMiss = run(Array.from({ length: 10 }, () => { const x = g(); x.obj[0][3] = [2]; x.players[1] = { ...x.players[1], puuid: 'me' }; x.players[2] = { ...x.players[2], puuid: 'mid' }; return x; }));
  assert.equal(get(jgMiss, 'objectives')[0].level, 'terrible');
  // older games without "obj": too little data
  assert.equal(get(run(Array.from({ length: 10 }, () => game({}))), 'objectives')[0].state, 'few');
});

// ---------- game format 6: XP, places, steals; gold, wards, first blood, comebacks, game length ----------
const St = require('../ui/stats');
test('map zones: lanes, river, both jungles, bases (hundreds of map units)', () => {
  assert.equal(St.zone(10, 104), 'top');        // blue's outer top tower
  assert.equal(St.zone(58, 64), 'mid');         // blue's outer mid tower
  assert.equal(St.zone(105, 10), 'bot');        // blue's outer bot tower
  assert.equal(St.zone(99, 44), 'river');       // the dragon pit
  assert.equal(St.zone(50, 105), 'river');      // baron
  assert.equal(St.zone(77, 40), 'jungle100');   // blue's red buff
  assert.equal(St.zone(71, 109), 'jungle200');  // red's blue buff
  assert.equal(St.zone(5, 5), 'base');
});

test('format 6 figures: XP lead, roams, steals, invades; "caught" is off', () => {
  // "me" = blue mid (index 2), lane opponent = red mid (7)
  const g = () => {
    const x = game({});
    x.xp = Array.from({ length: 20 }, (_, m) => Array.from({ length: 10 }, (_, i) => m * 500 + (i === 2 ? 40 : 0)));
    // everyone in the own base, the blue jungler (1) in red's jungle from minute 3 to 5
    x.at = Array.from({ length: 31 }, (_, m) => Array.from({ length: 10 }, (_, i) => (i === 1 && m >= 3 && m <= 5 ? [71, 109] : i < 5 ? [20, 20] : [128, 128])));
    x.jcs = Array.from({ length: 31 }, (_, m) => Array.from({ length: 10 }, (_, i) => (i === 1 ? m * 6 : 0)));
    x.kills = [
      [500, 2, 5, [0], 10, 104],       // 8:20 me on the top lane: a roam
      [600, 2, 7, [], 60, 62],         // my own lane: no roam
      [1200, 6, 2, [7], 120, 40],      // 20:00 me dead in the bot side lane, two enemies, no team mate near
    ];
    x.obj = [[1000, 'B', 100, [2], 2, 3], [600, 'D', 100, [1, 2, 3], 2, 2]];   // baron stolen by me; the dragon contested
    return x;
  };
  const r = run(Array.from({ length: 10 }, g));
  const one = id => get(r, id)[0];
  assert.equal(one('xpLead').value, 40);
  assert.equal(one('roamer').value, 1);
  // off: the minute places can't tell who was near at the moment of death
  assert.equal(get(r, 'caught').length, 0);
  assert.equal(one('stealer').value, 1);
  assert.equal(one('stealer').level, 'master');
  // the jungler: minutes 3→4 and 4→5 fully in red's jungle, 2→3 and 5→6 half: 6 + 6 + 3 + 3 CS
  const jg = run(Array.from({ length: 10 }, () => { const x = g(); x.players[1] = { ...x.players[1], puuid: 'me' }; x.players[2] = { ...x.players[2], puuid: 'mid' }; return x; }));
  assert.equal(get(jg, 'invader')[0].value, 18);
  // the red jungler lost those 18 CS in their own jungle
  const red = run(Array.from({ length: 10 }, () => { const x = g(); x.players[6] = { ...x.players[6], puuid: 'me' }; x.players[2] = { ...x.players[2], puuid: 'mid' }; return x; }));
  assert.equal(get(red, 'invaded')[0].value, 18);
  // older games (no places, no XP): too little data
  const old = run(Array.from({ length: 10 }, () => game({})));
  for (const id of ['xpLead', 'roamer', 'stealer']) assert.equal(get(old, id)[0].state, 'few', id);
});

test('gold, wards, first blood, comebacks and throws, early / late game', () => {
  // gold 9,000 → 300/min in 30 min: mid "broke"; 3 wards destroyed a game
  const r = run(Array.from({ length: 10 }, () => game({ me: { gold: 9000, x: { wardsKilled: 3 } } })));
  assert.equal(get(r, 'gold')[0].level, 'terrible');
  assert.equal(get(r, 'wardHunter')[0].level, 'master');
  // first blood: in on it in 5 of 10 games, its victim in 3
  const fb = run(Array.from({ length: 10 }, (_, i) => { const x = game({ ago: i + 1 }); x.kills = [i < 5 ? [200, 2, 7, []] : i < 8 ? [200, 7, 2, []] : [200, 6, 1, []]]; return x; }));
  assert.equal(get(fb, 'firstBlood')[0].level, 'master');
  assert.equal(get(fb, 'fbVictim')[0].level, 'terrible');
  // 8 games 3,000 behind at 15, 5 of them won: comeback king; 8 ahead, 5 lost: throws leads
  const gold15 = d => Array.from({ length: 16 }, () => Array.from({ length: 10 }, (_, i) => (i < 5 ? 5000 + d / 5 : 5000)));
  const cb = run(Array.from({ length: 16 }, (_, i) => { const x = game({ ago: i + 1, me: { win: i < 8 ? i < 5 : i >= 13 } }); x.gold = gold15(i < 8 ? -3000 : 3000); return x; }));
  assert.equal(get(cb, 'comeback')[0].state, 'met');
  assert.deepEqual([get(cb, 'comeback')[0].n, get(cb, 'comeback')[0].vars.w], [8, 5]);
  // 4 of 8 (50 %) is not clearly more than luck any more
  const half = run(Array.from({ length: 8 }, (_, i) => { const x = game({ ago: i + 1, me: { win: i % 2 === 0 } }); x.gold = gold15(-3000); return x; }));
  assert.equal(get(half, 'comeback')[0].state, 'not');
  assert.equal(get(cb, 'throws')[0].state, 'met');
  // 10 short games 3 won, 10 long ones 9 won: late game; not early game
  const ph = run(Array.from({ length: 20 }, (_, i) => game({ ago: i + 1, dur: i < 10 ? 20 * 60 : 35 * 60, me: { win: i < 10 ? i < 3 : i < 19 } })));
  assert.equal(get(ph, 'lateGame')[0].state, 'met');
  assert.deepEqual(get(ph, 'lateGame')[0].vars, { s: 30, l: 90, ns: 10, nl: 10 });
  assert.equal(get(ph, 'earlyGame')[0].state, 'not');
  // the same with a small difference (60 % against 70 %): neither
  const even = run(Array.from({ length: 20 }, (_, i) => game({ ago: i + 1, dur: i < 10 ? 20 * 60 : 35 * 60, me: { win: i < 10 ? i < 6 : i < 17 } })));
  assert.equal(get(even, 'lateGame')[0].state, 'not');
});

test('all roles: the role tags for every role played 5+ times, each with its thresholds and share', () => {
  // 10 games mid at 10 CS/min, 6 support, 2 top (too few: left out)
  const games = [...Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { cs: 300 } })),
    ...Array.from({ length: 6 }, (_, i) => game({ ago: 20 + i, at: 4 })),
    ...Array.from({ length: 2 }, (_, i) => game({ ago: 40 + i, at: 0 }))];
  const r = T.evaluateAll({ games, own: ['me'], now: NOW });
  assert.equal(r.all, true);
  assert.deepEqual(r.roles.map(x => [x.role, x.n]), [['mid', 10], ['support', 6]]);
  // farm is judged on mid only (not for supports), with the mid thresholds
  const farm = get(r, 'farm');
  assert.deepEqual(farm.map(x => x.role), ['mid']);
  assert.equal(farm[0].level, 'master');
  assert.equal(farm[0].roleShare, 10 / 18);
  // damage for both roles, each against its own role
  assert.deepEqual(get(r, 'damage').map(x => x.role).sort(), ['mid', 'support']);
  // the tags that don't depend on the role come once, without a role
  assert.equal(get(r, 'otp').length, 1);
  assert.equal(get(r, 'otp')[0].role, undefined);
  // hysteresis keys keep the role
  assert.ok([...T.keys(r.results)].some(k => k === 'farm:master:mid'));
});

test('ARAM: the new traits – finisher, enabler, poke master, tower crusher, first blood, comebacks, game length', () => {
  // 12 ARAM games of 18 minutes: 15 kills and 30 assists, 60,000 damage for 30,000 taken, 2,800 tower
  // damage, in on every first blood
  const aram = Array.from({ length: 12 }, (_, i) => {
    const g = game({ q: 450, ago: 2 + i, dur: 1080, me: { k: 15, a: 30, dmg: 60000, x: { taken: 30000, turretDmg: 2800 } } });
    g.kills = [[30, 2, 7, [1]]];
    return g;
  });
  const r = T.evaluateAram({ games: aram, own: ['me'], now: NOW });
  const met = id => r.results.find(x => x.id === id);
  assert.equal(met('arKills').level, 'master');            // 8.3 kills per 10 minutes
  assert.equal(met('arAssists').level, 'great');           // 16.7 – the best sixth starts at 17
  assert.equal(met('arPoke').level, 'master');             // 2.0 × the damage taken
  assert.equal(met('arTowers').level, 'master');           // 156 per minute
  assert.equal(met('arFirstBlood').level, 'master');       // every first blood
  // no gold timeline, no long games: "too little data", never "not met"
  assert.equal(met('arComeback').state, 'few');
  assert.equal(met('arLate').state, 'few');
  // only good sides: a quiet game is no weakness
  const quiet = aram.map(g => ({ ...g, players: g.players.map(p => (p.puuid === 'me' ? { ...p, k: 1, a: 3, dmg: 9000, x: { taken: 40000 } } : p)) }));
  const q = T.evaluateAram({ games: quiet, own: ['me'], now: NOW });
  for (const id of ['arKills', 'arAssists', 'arPoke', 'arTowers']) assert.equal(q.results.find(x => x.id === id).state, 'not', id);
  // every ARAM rule has a known metric
  for (const rule of TR.ARAM_RULES) if (rule.type === 'metric' || rule.type === 'avg') assert.ok(T.METRICS[rule.metric], rule.id);
});
