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
  const types = new Set(['champShare', 'champRecent', 'champWinrate', 'pool', 'poolTop', 'roleSpread', 'streak', 'break', 'count', 'level', 'metric', 'carry', 'avg', 'mastery', 'live']);
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

test('objectives: the share of the own team\'s dragons and barons the player was in on, per role', () => {
  // "me" plays mid (index 2); per game the team (100) took 2 dragons and a baron, "me" was in on one;
  // the enemy's dragon and the team's grubs don't count
  const g = () => { const x = game({}); x.obj = [[600, 'D', 100, [1, 2]], [900, 'D', 200, [6]], [1000, 'G', 100, [0]], [1200, 'D', 100, [1, 3, 4]], [1500, 'B', 100, [0, 1, 3]]]; return x; };
  const r = run(Array.from({ length: 10 }, g));
  const o = get(r, 'objectives')[0];
  assert.equal(o.n, 10);
  assert.ok(Math.abs(o.value - 1 / 3) < 1e-9);
  assert.equal(o.state, 'not');                                // mid: weak below 30 %, great from 60 %
  // the jungler (index 1) was at all of them: great
  const jg = run(Array.from({ length: 10 }, () => { const x = g(); x.players[1] = { ...x.players[1], puuid: 'me' }; x.players[2] = { ...x.players[2], puuid: 'mid' }; return x; }));
  assert.equal(get(jg, 'objectives')[0].level, 'master');
  // older games without "obj": too little data
  assert.equal(get(run(Array.from({ length: 10 }, () => game({}))), 'objectives')[0].state, 'few');
});
