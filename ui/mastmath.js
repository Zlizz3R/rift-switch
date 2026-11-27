// Mastery across accounts, shared by the window and the tests (no DOM): the champion × account
// table, milestones and the play time estimate.
(function (root) {
  const R = typeof module !== 'undefined' && module.exports ? require('./playtime-rules.js') : root.PLAYTIME_RULES;
  const MILESTONES = [100000, 500000, 1000000, 2000000, 5000000, 10000000];
  const ARAM_QUEUES = [450, 2400, 3220, 3270, 720];

  // the highest milestone reached (0 = none)
  const milestone = pts => MILESTONES.filter(m => pts >= m).pop() || 0;

  // list: [{ puuid, at, champs: { id: [points, level] } }] → one row per champion, most points first:
  // { id, total, accs: { puuid: { pts, lvl } }, best: puuid with the most, n: accounts with points }
  // Levels are never added up (a level belongs to one account).
  function masteryTable(list) {
    const rows = new Map();
    for (const m of list || []) {
      for (const [id, v] of Object.entries((m && m.champs) || {})) {
        const pts = Number(v && v[0]) || 0;
        if (pts <= 0) continue;
        const cid = Number(id);
        const r = rows.get(cid) || { id: cid, total: 0, accs: {}, best: null, n: 0 };
        r.accs[m.puuid] = { pts, lvl: Number(v[1]) || 0 };
        r.total += pts;
        r.n++;
        if (!r.best || pts > r.accs[r.best].pts) r.best = m.puuid;
        rows.set(cid, r);
      }
    }
    return [...rows.values()].sort((a, b) => b.total - a.total);
  }

  // remakes and custom games never count
  const counts = g => !g[5] && g[2] > 0;

  // the share of ARAM among an account's stored games on a champion (null: no games on it)
  function aramShare(games, champ) {
    const on = (games || []).filter(x => counts(x) && x[3] === champ);
    if (!on.length) return null;
    return on.filter(x => ARAM_QUEUES.includes(x[2])).length / on.length;
  }
  // the account's own average game length in minutes (Summoner's Rift and ARAM apart), for comparison
  function avgMinutes(games) {
    const ok = (games || []).filter(counts);
    const avg = list => (list.length ? list.reduce((s, x) => s + x[1], 0) / list.length / 60 : null);
    const sr = ok.filter(x => !ARAM_QUEUES.includes(x[2])), aram = ok.filter(x => ARAM_QUEUES.includes(x[2]));
    return { sr: avg(sr), aram: avg(aram), srN: sr.length, aramN: aram.length, n: ok.length };
  }

  // The minutes of one game for an account: its own average on Summoner's Rift / ARAM once it has
  // enough stored games there, else the sourced average. len: avgMinutes() of the account.
  function gameMinutes(len) {
    const own = (v, n) => (v != null && n >= R.minOwnGames ? v : null);
    return { sr: own(len && len.sr, len && len.srN) ?? R.minutes.sr, aram: own(len && len.aram, len && len.aramN) ?? R.minutes.aram };
  }
  // points per game on average (playtime-rules.js: ~600, wins more, losses less)
  const pointsPerGame = () => R.pointsPerGame;
  // Points → games → hours: points ÷ points per game × (minutes per game + 7 for queue, champ select,
  // loading and the post-game screen). One number ("approx."), no range.
  // o: { aram: share 0..1 of ARAM on this champion, min: gameMinutes() of the account }
  function estimate(points, o = {}) {
    const s = o.aram || 0, m = o.min || gameMinutes(null);
    const games = points / pointsPerGame();
    const mins = (1 - s) * m.sr + s * m.aram + R.extraMinutes;
    return { games, hours: games * mins / 60, mins, aram: s };
  }
  // two significant digits: 902 → 900, 3,080 → 3,100, 47 → 47
  function roundNice(x) {
    if (!(x > 0)) return 0;
    if (x < 100) return Math.round(x);
    const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return Math.round(x / p) * p;
  }

  const api = { MILESTONES, ARAM_QUEUES, milestone, masteryTable, aramShare, avgMinutes, gameMinutes, estimate, roundNice, pointsPerGame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MastMath = api;
})(typeof window !== 'undefined' ? window : this);
