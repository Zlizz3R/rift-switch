// The numbers behind the play time estimate (mastery points -> games -> hours), each with its source.
// Only what is documented is in here; where a value is missing the range stays wider instead of
// guessing. Sources checked 24.11.2026 (docs/plans/Pruefbericht.md).
(function (root) {
  const PLAYTIME_RULES = {
    // Riot rebuilt champion mastery with patch 14.10 (15 May 2024): different points per game since
    rework: Date.UTC(2024, 4, 15),
    pointsPerGame: {
      // win ~900–1,100, loss ~100–300 → at a 50 % win rate 500–700 per game
      before: { low: 500, high: 700, src: 'Jack J Gaming, 24.04.2023 – Solo/Duo, patch 13.7, ~1M games (win ~900–1,100, loss ~100–300)',
        url: 'https://jackjgaming.substack.com/p/mastery-a-statistical-summary-of' },
      // median of 146 measurements (two lookups on different days, points ÷ games in between)
      after: { low: 1219, high: 1219, src: 'lolvalue.com, Oct. 2026 – median of 146 measurements',
        url: 'https://lolvalue.com/lol-mastery-chart' },
    },
    // average game length in minutes; no sourced numbers per season were found, so one range for all
    minutes: {
      sr: { low: 25, high: 32, src: 'tier averages ~26–31 min (e.g. Gold 30:06, Diamond 27:44, Challenger 25:52)',
        url: 'https://bo3.gg/lol/news/this-rank-has-longest-game-time-lol' },
      aram: { low: 20, high: 20, src: 'about 20 min on Howling Abyss',
        url: 'https://gameriv.com/how-long-is-an-average-match-in-league-of-legends/' },
    },
    // queue, champ select, loading screen and after the game, per game (plan: 5–10 min)
    overhead: { low: 5, high: 10 },
    // own readings: from this many games between two readings on, they replace the "after" value
    minCalibGames: 10,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PLAYTIME_RULES;
  else root.PLAYTIME_RULES = PLAYTIME_RULES;
})(typeof window !== 'undefined' ? window : this);
