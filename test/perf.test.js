// Overview → Performance / Champions (ui/perfmath.js): which games count, the role table, sorting.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../ui/perfmath');
const MF = require('../ui/matchfilter');

// a Summoner's Rift game with all ten players in clear positions (Smite jungle, support item support)
const POS = ['top', 'jungle', 'mid', 'bot', 'support'];
function player(team, i, o = {}) {
  return { puuid: `${team}-${i}`, team, champ: 100 + i, pos: POS[i], win: team === 100, k: 3, d: 2, a: 5, cs: i === 4 ? 30 : 200, dmg: 20000, vis: 25,
    spells: i === 1 ? [11, 4] : [4, 14], items: i === 4 ? [3877] : [], ...o };
}
let nextId = 1;
function game({ q = 420, t = Date.UTC(2026, 5, 1), dur = 1800, mode = 'CLASSIC', me = {}, meAt = 2, owners = ['me'], extra = {} } = {}) {
  const players = [...POS.map((_, i) => player(100, i)), ...POS.map((_, i) => player(200, i))];
  players[meAt] = { ...players[meAt], puuid: 'me', ...me };
  for (const [at, o] of Object.entries(extra)) players[at] = { ...players[at], ...o };
  return { id: String(nextId++), t, dur, q, mode, owners, players };
}

test('select: queue, account, season, role – and remakes never', () => {
  const games = [
    game(), game({ q: 440 }), game({ q: 450, mode: 'ARAM' }), game({ q: 420, dur: 200 }),
    game({ t: Date.UTC(2025, 3, 1) }), game({ meAt: 0 }),
  ];
  assert.equal(PM.select(games, { queue: 'ranked', range: 'all' }).length, 4);   // ARAM and the remake out
  assert.equal(PM.select(games, { queue: 'solo', range: 'all' }).length, 3);
  assert.equal(PM.select(games, { queue: 'all', range: 'all' }).length, 5);
  assert.equal(PM.select(games, { queue: 'ranked', range: 'y2026' }).length, 3);
  assert.equal(PM.select(games, { queue: 'ranked', range: 'y2025' }).length, 1);
  assert.equal(PM.select(games, { queue: 'ranked', range: 'all', role: 'top' }).length, 1);
  assert.equal(PM.select(games, { queue: 'ranked', range: 'all', acc: 'someone' }).length, 0);
  // the season is the calendar year
  assert.deepEqual(MF.rangeBounds({ range: 'y2026' }), [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()]);
});

test('roles: the rows add up to the key figures; ARAM has no lane', () => {
  const games = [game(), game(), game({ meAt: 1 }), game({ q: 450, mode: 'ARAM' }), game({ q: 450, mode: 'ARAM', me: { champ: 7 } })];
  const parts = PM.select(games, { queue: 'all', range: 'all' });
  const roles = PM.roleTable(parts);
  assert.deepEqual(roles.map(r => [r.role, r.n]), [['jungle', 1], ['mid', 2], ['none', 2]]);
  // done when: the rows and the bar give the same sums
  assert.equal(roles.reduce((s, r) => s + r.n, 0), parts.length);
  for (const r of roles) assert.equal(r.champs.reduce((s, c) => s + c.n, 0), r.n);
  assert.equal(roles.reduce((s, r) => s + r.k, 0), parts.reduce((s, x) => s + x.p.k, 0));
});

test('two own accounts in one game: two parts, one game', () => {
  const g = game({ owners: ['me', 'alt'], extra: { 3: { puuid: 'alt' } } });
  const parts = PM.select([g], { queue: 'ranked', range: 'all' });
  assert.equal(parts.length, 2);
  assert.equal(PM.select([g], { queue: 'ranked', range: 'all', acc: 'alt' })[0].p.puuid, 'alt');
});

test('champion list: most games first, sortable; colour only from 5 games on', () => {
  const games = [
    ...Array.from({ length: 6 }, () => game({ me: { champ: 1 } })),
    ...Array.from({ length: 2 }, () => game({ me: { champ: 2, k: 20, d: 0 } })),
    game({ me: { champ: 3, win: false } }),
  ];
  const rows = PM.champRows(PM.select(games, { queue: 'all', range: 'all' }));
  assert.deepEqual(rows.map(r => r.champ), [1, 2, 3]);
  assert.deepEqual(PM.sortRows(rows, 'kda').map(r => r.champ), [2, 1, 3]);           // 0 deaths = perfect, on top
  assert.deepEqual(PM.sortRows(rows, 'winrate', 1).map(r => r.champ), [3, 1, 2]);    // ties: more games first
  assert.equal(PM.markWinrate(rows[0]), 'good');       // 6 games, 100 %
  assert.equal(PM.markWinrate(rows[1]), '');           // 2 games: no colour
  assert.equal(PM.markKda(rows[1]), '');
});

test('trend: the last n games against the n before; too few games say how many are needed', () => {
  // newest 10: wins with 1 death; the 10 before: losses with 5 deaths
  const games = [...Array.from({ length: 10 }, (_, i) => game({ t: Date.UTC(2026, 5, 20, i), me: { win: true, d: 1 } })),
    ...Array.from({ length: 10 }, (_, i) => game({ t: Date.UTC(2026, 5, 1, i), me: { win: false, d: 5 } }))];
  const parts = PM.select(games, { queue: 'all', range: 'all' });
  const tr = PM.trend(parts, 10, 'deaths');
  assert.equal(tr.ok, true);
  assert.deepEqual(tr.wr, [1, 0]);
  assert.equal(tr.cur, 1);
  assert.equal(tr.prev, 5);
  assert.equal(tr.better, -1);            // fewer deaths is better
  assert.deepEqual(PM.trend(parts, 20, 'kda'), { ok: false, have: 20, need: 40 });
});
