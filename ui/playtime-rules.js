// The numbers behind the play time estimate (mastery points -> games -> hours), each with its source.
// One plain number, no range: points ÷ points per game × (minutes per game + 7 around it). Sources checked
// 24.11.2026; points per game set by the user on 27.11.2026.
(function (root) {
  const PLAYTIME_RULES = {
    // Points per game on average: a win gives much more, a loss much less – about 600 both before and
    // after Riot's mastery rework of May 2024 (patch 14.10). The user's own search through players'
    // reports from before and after the rework (Reddit) – Riot publishes no numbers.
    pointsPerGame: 600,
    pointsSrc: 'players\' reports from before and after the rework of May 2024 (Reddit)',
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
