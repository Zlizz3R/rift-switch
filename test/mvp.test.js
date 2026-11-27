// MVP, ACE and the placement (ui/mvp.js with the figures of ui/mvp-rules.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Mvp = require('../ui/mvp');
const R = require('../ui/mvp-rules');

// a Summoner's Rift game: per team top, jungle (smite), mid, bot, support (support item); o: changes
const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'];
const base = { top: { k: 4, d: 4, a: 4, cs: 220, dmg: 20000, vis: 20, gold: 11000 }, jungle: { k: 5, d: 4, a: 7, cs: 170, dmg: 16000, vis: 25, gold: 11000 },
  mid: { k: 6, d: 4, a: 5, cs: 230, dmg: 22000, vis: 18, gold: 11500 }, bot: { k: 7, d: 4, a: 5, cs: 250, dmg: 23000, vis: 15, gold: 12500 },
  support: { k: 1, d: 5, a: 12, cs: 30, dmg: 8000, vis: 70, gold: 7500 } };
function game(o = {}, extra = {}) {
  const players = [];
  for (const team of [100, 200]) for (const r of ROLES) {
    const id = `${team}-${r}`;
    players.push({ puuid: id, name: id, team, win: team === 100, pos: r, spells: r === 'jungle' ? [4, 11] : [4, 14], items: r === 'support' ? [3870] : [1055],
      ...base[r], x: { taken: 20000, mitig: 15000, obj: r === 'jungle' ? 20000 : 4000, cc: 20 }, ...(o[id] || {}) });
  }
  return { id: '1', t: 1, dur: 1800, q: 420, mode: 'CLASSIC', players, ...extra };
}
const at = (g, id) => g.players.findIndex(p => p.puuid === id);

test('the figures: every role and result, every part, quantiles in order, small offsets', () => {
  for (const r of ROLES) for (const w of ['W', 'L']) {
    const k = r + w;
    for (const f of Mvp.FEAT) assert.ok(R.norm[k][f] && R.norm[k][f][1] > 0, `${k} ${f}`);
    const q = R.quant[k];
    assert.ok(q.every((v, i) => !i || v >= q[i - 1]), k);
  }
  for (const r of ROLES) assert.ok(Math.abs(R.offset[r]) < 0.3, r);
});

test('more kills and kill participation beat a better KDA (the Yorick game)', () => {
  // top 5/2/10 against mid 17/6/7 in the same won team, both with ~29k damage
  const g = game({ '100-top': { k: 5, d: 2, a: 10, cs: 300, dmg: 28000, gold: 15000 }, '100-mid': { k: 17, d: 6, a: 7, dmg: 29800, gold: 17800 },
    '100-jungle': { k: 9, d: 1, a: 23 }, '100-bot': { k: 10, d: 6, a: 6 }, '100-support': { k: 0, d: 5, a: 18 } });
  const pl = Mvp.placements(g);
  assert.ok(pl.place(at(g, '100-mid')) < pl.place(at(g, '100-top')));
});

test('a support can be MVP: vision, kill participation, few deaths', () => {
  const g = game({ '100-support': { k: 2, d: 1, a: 22, vis: 120 } });
  assert.equal(Mvp.placements(g).mvp, at(g, '100-support'));
});

test('MVP is the best winner, ACE the best loser; winners above losers when they play alike', () => {
  const g = game();
  const pl = Mvp.placements(g);
  assert.equal(g.players[pl.mvp].win, true);
  assert.equal(g.players[pl.ace].win, false);
  assert.equal(pl.place(pl.mvp), 1);
  assert.deepEqual([...Array(10).keys()].map(pl.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the end screen (only damage taken) and the lane factor', () => {
  const g = game({ '100-mid': { k: 12, d: 1, a: 8 } });
  for (const p of g.players) p.x = { taken: 20000 };
  const rows = Mvp.features(g);
  assert.equal(rows[0].tsh, null);
  assert.equal(rows[0].obj, null);
  const pl = Mvp.placements(g);
  assert.equal(pl.mvp, at(g, '100-mid'));
  const l = pl.lane(at(g, '100-mid'));
  assert.equal(l.opp.puuid, '200-mid');
  assert.ok(l.mult > 1 && l.mult <= 1.4);
});

test('ARAM (no roles): every figure against the best of the ten', () => {
  const g = game({ '100-mid': { k: 20, d: 2, a: 20, dmg: 50000 } }, { q: 450, mode: 'ARAM' });
  const pl = Mvp.placements(g);
  assert.equal(pl.lane(0), null);
  assert.equal(pl.mvp, at(g, '100-mid'));
  assert.equal(g.players[pl.ace].win, false);
});
