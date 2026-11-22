// Rank arithmetic shared by the window and the tests (no DOM, no Electron):
// rank scores and the decay countdown.
(function (root) {
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const DIVS = ['IV', 'III', 'II', 'I'];
  const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const DAY = 86400000;

  // one number per rank: 400 per tier, 100 per division, LP on top (Master+: LP stacks)
  function rankScore(r) {
    const i = TIERS.indexOf(r.tier);
    if (APEX.includes(r.tier)) return 700 * 4 + r.lp;
    return i * 400 + DIVS.indexOf(r.division) * 100 + Math.min(r.lp, 100);
  }
  // score -> { tier, division } ('MASTER+' above 2800)
  function scoreToRank(s) {
    if (s >= 2800) return { tier: 'MASTER', plus: true };
    s = Math.max(0, s);
    const i = Math.min(6, Math.floor(s / 400));
    const d = Math.min(3, Math.floor((s - i * 400) / 100));
    return { tier: TIERS[i], division: DIVS[d] };
  }

  // Ranked decay (Diamond and up, Solo/Duo and Flex): Riot keeps a bank of days. It only tells
  // the signed-in account; that number is kept and counted down. Without it: estimate from the
  // last game, assuming the bank was full then (Diamond 28 days, Master and up 14).
  // -> { days, est, q: 'Solo/Duo'|'Flex', bank? } for the queue that decays first, or null
  function decayInfo(a, activePuuid, now = Date.now()) {
    const high = q => q && TIERS.indexOf(q.tier) >= TIERS.indexOf('DIAMOND');
    const queues = ['solo', 'flex'].filter(k => high(a[k]));
    if (!queues.length) return null;
    const riot = a.decay && a.decay.q && a.decay.at ? a.decay : null;
    const gone = !riot || a.puuid === activePuuid ? 0 : Math.floor((now - riot.at) / DAY);
    let best = null;
    for (const k of queues) {
      let x;
      if (riot && riot.q[k] != null) x = { days: Math.max(0, riot.q[k] - gone), est: false };
      else if (a.lastPlayed) {
        const bank = APEX.includes(a[k].tier) ? 14 : 28;
        x = { days: Math.max(0, bank - Math.floor((now - a.lastPlayed) / DAY)), est: true, bank };
      } else continue;
      x.q = k === 'solo' ? 'Solo/Duo' : 'Flex';
      if (!best || x.days < best.days) best = x;
    }
    return best;
  }

  const api = { TIERS, DIVS, APEX, DAY, rankScore, scoreToRank, decayInfo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RankMath = api;
})(typeof window !== 'undefined' ? window : this);
