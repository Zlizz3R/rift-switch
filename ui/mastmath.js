// Mastery across accounts, shared by the window and the tests (no DOM): the champion × account
// table, milestones, the calibration from own readings and the play time estimate.
(function (root) {
  const R = typeof module !== 'undefined' && module.exports ? require('./playtime-rules.js') : root.PLAYTIME_RULES;
  const MILESTONES = [100000, 500000, 1000000, 2000000];
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

  // A game counts from when it ended (the points arrive then); remakes and custom games never.
  const gameEnd = g => g[0] + (g[1] || 0) * 1000;
  const counts = g => !g[5] && g[2] > 0;

  // The real points per game of one account: between two readings, the points each champion
  // gained ÷ the stored games on it in between. A stretch where a champion gained points without
  // a stored game (the store missed games) is left out. history: [{ at, c: { id: points } }] oldest
  // first; games: [[time, seconds, queue, champion, win, remake]].
  // → { ppg, games, points } once there are enough games (R.minCalibGames), else null.
  function calibrate(history, games) {
    const h = (history || []).filter(x => x && x.at && x.c).sort((a, b) => a.at - b.at);
    const g = (games || []).filter(counts);
    let pts = 0, n = 0;
    const cur = {};
    h.forEach((line, i) => {
      const prev = { ...cur };
      Object.assign(cur, line.c);
      if (i === 0) return;
      const from = h[i - 1].at, to = line.at;
      const inside = g.filter(x => gameEnd(x) > from && gameEnd(x) <= to);
      const per = {};
      for (const x of inside) per[x[3]] = (per[x[3]] || 0) + 1;
      // not in this line: unchanged; not seen before: 0 points (the client lists only played champions)
      const gain = id => (line.c[id] == null ? 0 : line.c[id] - (prev[id] || 0));
      let dPts = 0, ok = true;
      for (const id of Object.keys(line.c)) {
        const d = gain(id);
        if (d > 0 && !per[id]) ok = false;          // points without a stored game: the store missed one
        if (d > 0) dPts += d;
      }
      // games without points (not read yet, or a mode without mastery): can't tell, left out
      for (const id of Object.keys(per)) if (gain(id) <= 0) ok = false;
      if (!ok || !inside.length) return;
      pts += dPts;
      n += inside.length;
    });
    return n >= R.minCalibGames ? { ppg: pts / n, games: n, points: pts } : null;
  }

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
    return { sr: avg(ok.filter(x => !ARAM_QUEUES.includes(x[2]))), aram: avg(ok.filter(x => ARAM_QUEUES.includes(x[2]))),
      n: ok.length };
  }

  // Points → games → hours, always a range. The points can't be split into before / after the 2024
  // rework, so the range spans both rates; own readings replace the "after" rate.
  // o: { ppg: own points per game or null, aram: share 0..1 or null }
  function estimate(points, o = {}) {
    const before = R.pointsPerGame.before;
    const after = o.ppg ? { low: o.ppg, high: o.ppg } : R.pointsPerGame.after;
    const rMin = Math.min(before.low, after.low), rMax = Math.max(before.high, after.high);
    const s = o.aram || 0;
    const m = k => (1 - s) * R.minutes.sr[k] + s * R.minutes.aram[k] + R.overhead[k];
    const gLow = points / rMax, gHigh = points / rMin;
    return { gLow, gHigh, hLow: gLow * m('low') / 60, hHigh: gHigh * m('high') / 60, ppg: o.ppg || null, aram: s,
      rMin, rMax };
  }
  // two significant digits: 902 → 900, 3,080 → 3,100, 47 → 47
  function roundNice(x) {
    if (!(x > 0)) return 0;
    if (x < 100) return Math.round(x);
    const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return Math.round(x / p) * p;
  }

  const api = { MILESTONES, ARAM_QUEUES, milestone, masteryTable, calibrate, aramShare, avgMinutes, estimate, roundNice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MastMath = api;
})(typeof window !== 'undefined' ? window : this);
