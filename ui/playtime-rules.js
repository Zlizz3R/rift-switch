// The numbers behind the play time estimate (mastery points -> games -> hours), each with its source.
// One plain number, no range: points ÷ points per game × (minutes per game + 7 around it). Sources checked
// 24.11.2026 (docs/plans/Pruefbericht.md).
(function (root) {
  const PLAYTIME_RULES = {
    // Points per game at a 50 % win rate: ~500 before Riot's mastery rework (patch 14.10, May 2024),
    // ~1,200 after. The points can't be split into before / after: the share of games played before
    // the rework is the user's to set (Mastery, a slider; 50 % by default = 850 points per game).
    pointsBefore: 500,
    pointsAfter: 1200,
    pointsPerGame: 850,
    pointsSrc: 'Jack J Gaming 2023 (before: win ~900–1,100, loss ~100–300); lolvalue.com 2026 (after: median 1,219)',
    // average game length in minutes when an account has too few stored games of its own
    minutes: {
      sr: 28.5,     // tier averages ~26–31 min (e.g. Gold 30:06, Challenger 25:52) – bo3.gg
      aram: 20,     // about 20 min on Howling Abyss – gameriv.com
    },
    minutesSrc: 'bo3.gg, gameriv.com',
    // on top of every game: queue, champ select, loading screen and the post-game screen
    extraMinutes: 7,
    // from this many stored games on a map, the account's own average length is used instead
    minOwnGames: 10,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PLAYTIME_RULES;
  else root.PLAYTIME_RULES = PLAYTIME_RULES;
})(typeof window !== 'undefined' ? window : this);
