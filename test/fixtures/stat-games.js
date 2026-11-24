// A fixed set of games for the stats tests: two own accounts (o1, o2), a remake, 0 deaths, a game
// both own accounts played together, a game without kills on one team, ARAM.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function game(i, o = {}) {
  const owners = o.owners || [i % 3 === 0 ? 'o2' : 'o1'];
  const win = o.win ?? rnd() < 0.55;
  const players = Array.from({ length: 10 }, (_, n) => {
    const blue = n < 5;
    const puuid = n === 0 ? owners[0] : n === 1 && owners[1] ? owners[1] : `x${i}-${n}`;
    const k = o.noKills && !blue ? 0 : int(0, 12);
    return { puuid, name: 'P' + n, tag: 'EUW', team: blue ? 100 : 200, champ: n === 0 ? [103, 238, 517, 86][i % 4] : 10 + n,
      pos: ['top', 'jungle', 'mid', 'bot', 'support'][n % 5], win: blue === win, k, d: n === 0 && o.deathless ? 0 : int(0, 10), a: int(0, 15),
      cs: int(20, 260), gold: int(6000, 16000), dmg: int(4000, 40000), vis: int(5, 70), lvl: int(10, 18), multi: n === 0 && i === 5 ? 5 : int(0, 2) };
  });
  return { id: String(1000 + i), t: 1_700_000_000_000 + i * 3_600_000, dur: o.dur ?? int(900, 2400), q: o.q ?? 420,
    remake: (o.dur ?? 1000) < 300, players, owners, v: 3 };
}

module.exports = [
  ...Array.from({ length: 24 }, (_, i) => game(i + 1)),
  game(30, { dur: 200 }),                          // remake
  game(31, { deathless: true, win: true }),        // 0 deaths
  game(32, { owners: ['o1', 'o2'], win: false }),  // both own accounts in one game
  game(33, { noKills: true, win: true }),          // the enemy team without a kill
  game(34, { q: 450 }),                            // ARAM
];
