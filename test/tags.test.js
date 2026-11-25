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
  assert.equal(farm.level, 'master');                     // 10 CS/min ≥ 9.5
  assert.equal(farm.n, 12);
  // the support isn't judged on farm or damage at all
  const sup = run(Array.from({ length: 12 }, (_, i) => game({ ago: i + 1, at: 4 })));
  assert.equal(sup.role, 'support');
  assert.equal(get(sup, 'farm').length, 0);
  assert.equal(get(sup, 'damage').length, 0);
  // KDA has its own thresholds for supports: (3 + 5) / 2 = 4 → great, not master (5)
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
  const many = run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { d: 8 } })));
  assert.equal(get(many, 'deaths')[0].level, 'terrible');
  assert.ok(T.isWeakness(get(many, 'deaths')[0]));
  const few = run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { d: 2 } })));
  assert.equal(get(few, 'deaths')[0].level, 'great');
  const mid = run(Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { d: 5 } })));
  assert.equal(get(mid, 'deaths')[0].state, 'not');
});

test('hysteresis: a tag shown before stays until 5 % past its threshold', () => {
  const at = cs => Array.from({ length: 10 }, (_, i) => game({ ago: i + 1, me: { cs } }));
  // 7.8 CS/min: below 8.0 – not met without history, kept when "great" was shown before
  assert.equal(get(run(at(234)), 'farm')[0].state, 'not');
  assert.equal(get(run(at(234), { prev: new Set(['farm:great']) }), 'farm')[0].level, 'great');
  // 7.5 is more than 5 % below: gone
  assert.equal(get(run(at(225), { prev: new Set(['farm:great']) }), 'farm')[0].state, 'not');
  assert.ok(T.keys(run(at(250)).results).has('farm:great'));
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
  const types = new Set(['champShare', 'champRecent', 'champWinrate', 'pool', 'roleSpread', 'streak', 'break', 'count', 'level', 'metric', 'carry', 'avg', 'mastery', 'live']);
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
  assert.equal(one('earlyFarm').level, 'great');
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
