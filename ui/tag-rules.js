// The tag catalogue (docs/plans section 5) as data: every threshold lives here and only here.
// A new tag is a new entry; tags.js knows the types. Names and texts are i18n keys:
// 'tag.<id>' (short name; leveled tags: 'tag.<id>.great' / '.weak' / '.terrible', master = great + ★)
// and 'tag.<id>.t' (the exact text with the numbers). Values marked "V" are suggestions still to be
// set by the user – they carry "// TODO Schwelle prüfen".
//
// Fields: id, group (pool | form | stats | fight | mastery), type (see tags.js), min (games needed),
// stage (A match list, B full game data, C timeline, M mastery, L live), color for unleveled tags
// (good | info | warn | bad), live: only in Live (Phase 5), roles: positions it applies to (none = all),
// period: which games (season | d30 | d60 | all).
(function (root) {
  const ALL = ['top', 'jungle', 'mid', 'bot', 'support'];
  const NOT_SUP = ['top', 'jungle', 'mid', 'bot'];
  const TAG_RULES = [
    // ---------- champion & pool ----------
    { id: 'otp', group: 'pool', type: 'champShare', share: 0.8, pct: true, min: 15, stage: 'A', color: 'good', period: 'season' },
    { id: 'main', group: 'pool', type: 'champRecent', games: 11, days: 60, stage: 'A', color: 'good', period: 'd60' },
    { id: 'greatWith', group: 'pool', type: 'champWinrate', pct: true, games: 6, winrate: 0.6, min: 6, stage: 'A', color: 'good', period: 'season' },
    { id: 'newTo', group: 'pool', type: 'live', live: true, games: 2, days: 30, mastery: 20000, stage: 'A+M+L', color: 'warn' },
    { id: 'flexPool', group: 'pool', type: 'pool', champs: 5, maxShare: 0.4, min: 15, stage: 'A', color: 'info', period: 'season' },
    // the other way round: three champions take more than 90 % of the games
    { id: 'smallPool', group: 'pool', type: 'poolTop', champs: 3, share: 0.9, pct: true, min: 15, stage: 'A', color: 'bad', period: 'season' },
    { id: 'generalist', group: 'pool', type: 'roleSpread', pct: true, maxShare: 0.66, min: 15, stage: 'A', color: 'info', period: 'season' },
    { id: 'mainTaken', group: 'pool', type: 'live', live: true, stage: 'A+L', color: 'warn' },
    { id: 'mainBanned', group: 'pool', type: 'live', live: true, stage: 'A+L', color: 'warn' },
    { id: 'autofill', group: 'pool', type: 'live', live: true, min: 10, stage: 'A+L', color: 'warn' },

    // ---------- activity & form ----------
    { id: 'hotStreak', group: 'form', type: 'streak', win: true, n: 3, min: 3, stage: 'A', color: 'good', period: 'all' },
    { id: 'lossStreak', group: 'form', type: 'streak', win: false, n: 3, min: 3, stage: 'A', color: 'bad', period: 'all' },
    { id: 'backAgain', group: 'form', type: 'break', days: 14, within: 3, min: 1, stage: 'A', color: 'warn', period: 'all' },
    { id: 'grinder', group: 'form', type: 'count', games: 50, days: 30, stage: 'A', color: 'info', period: 'd30' },
    { id: 'smurf', group: 'form', type: 'level', below: 100, stage: 'A', color: 'warn' },

    // ---------- key figures with levels (per role; dir 1 = more is better) ----------
    // Thresholds per position from percentiles of the stored ranked games of the other players (the
    // own accounts left out; 186 games, 1,666 player games, 25.11.2026): weak = the lowest 25 %,
    // terrible = the lowest 10 %, great = the best 33 %, master = the best 16.6 % (deaths the other
    // way round). A season average lies between one game and a random mix of ten, so each threshold is
    // the middle of both. Lane differences are mirrored (one player's lead is the other's deficit).
    // Recalculate: node tools/tag-thresholds.js
    { id: 'farm', group: 'stats', type: 'metric', metric: 'csMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 1,
      levels: { great: 7.3, master: 7.8, weak: 6.4, terrible: 5.9 },
      top: { great: 7.4, master: 7.8, weak: 6.4, terrible: 5.9 },
      jungle: { great: 6.9, master: 7.3, weak: 6.1, terrible: 5.6 },
      mid: { great: 7.3, master: 7.8, weak: 6.4, terrible: 5.9 },
      bot: { great: 7.7, master: 8.1, weak: 6.8, terrible: 6.4 } },
    { id: 'damage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 0,
      levels: { great: 950, master: 1130, weak: 720, terrible: 610 },
      top: { great: 860, master: 980, weak: 630, terrible: 520 },
      jungle: { great: 740, master: 890, weak: 530, terrible: 450 },
      mid: { great: 950, master: 1130, weak: 720, terrible: 610 },
      bot: { great: 960, master: 1100, weak: 690, terrible: 580 },
      support: { great: 460, master: 580, weak: 290, terrible: 240 } },
    { id: 'kda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 2,
      levels: { great: 2.65, master: 3.75, weak: 1.45, terrible: 1.05 },
      top: { great: 2.1, master: 3.1, weak: 1.15, terrible: 0.85 },
      jungle: { great: 3.15, master: 4.3, weak: 1.85, terrible: 1.35 },
      mid: { great: 2.65, master: 3.75, weak: 1.45, terrible: 1.05 },
      bot: { great: 2.75, master: 3.7, weak: 1.7, terrible: 1.25 },
      support: { great: 3.25, master: 4.65, weak: 1.95, terrible: 1.5 } },
    { id: 'deaths', group: 'stats', type: 'metric', metric: 'deaths', dir: -1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 1,
      levels: { great: 5.5, master: 4.3, weak: 8.2, terrible: 9.6 },
      top: { great: 5.4, master: 4.1, weak: 8.1, terrible: 9.9 },
      jungle: { great: 4.8, master: 4, weak: 7.4, terrible: 8.8 },
      mid: { great: 5.5, master: 4.3, weak: 8.2, terrible: 9.6 },
      bot: { great: 5.5, master: 4.3, weak: 8.2, terrible: 9.5 },
      support: { great: 5.5, master: 4.2, weak: 8, terrible: 9.4 } },
    { id: 'vision', group: 'stats', type: 'metric', metric: 'visMin', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', dec: 2,
      levels: { great: 0.74, master: 0.84, weak: 0.56, terrible: 0.47 },
      top: { great: 0.77, master: 0.86, weak: 0.61, terrible: 0.52 },
      jungle: { great: 0.93, master: 1.05, weak: 0.72, terrible: 0.61 },
      mid: { great: 0.74, master: 0.84, weak: 0.56, terrible: 0.47 },
      bot: { great: 0.7, master: 0.79, weak: 0.54, terrible: 0.45 },
      support: { great: 2.63, master: 2.83, weak: 2.19, terrible: 1.89 } },
    // the stored gold per minute is enough for this one (no full timeline needed)
    { id: 'laneGold', group: 'stats', type: 'metric', metric: 'goldDiff15', dir: 1, min: 6, stage: 'C', roles: ALL, period: 'season', dec: 0, signed: true,
      levels: { great: 450, master: 1000, weak: -650, terrible: -1400 },
      top: { great: 600, master: 1200, weak: -850, terrible: -1650 },
      jungle: { great: 300, master: 800, weak: -550, terrible: -1050 },
      mid: { great: 450, master: 1000, weak: -650, terrible: -1400 },
      bot: { great: 500, master: 1100, weak: -800, terrible: -1400 },
      support: { great: 250, master: 550, weak: -400, terrible: -800 } },

    // from the timeline (game format 4)
    { id: 'earlyFarm', group: 'stats', type: 'metric', metric: 'cs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 0,
      levels: { great: 116, master: 123, weak: 101, terrible: 94 },
      top: { great: 111, master: 120, weak: 95, terrible: 87 },
      jungle: { great: 104, master: 110, weak: 94, terrible: 88 },
      mid: { great: 116, master: 123, weak: 101, terrible: 94 },
      bot: { great: 116, master: 121, weak: 103, terrible: 96 } },
    { id: 'laneCs', group: 'stats', type: 'metric', metric: 'laneCs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 1, signed: true,
      levels: { great: 8, master: 18, weak: -13, terrible: -24 },
      top: { great: 12, master: 26, weak: -19, terrible: -34 },
      jungle: { great: 7, master: 14, weak: -11, terrible: -21 },
      mid: { great: 8, master: 18, weak: -13, terrible: -24 },
      bot: { great: 8, master: 14, weak: -11, terrible: -21 } },
    { id: 'earlyShare', group: 'stats', type: 'metric', metric: 'share0to15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.25, master: 0.265, weak: 0.225, terrible: 0.21 },
      top: { great: 0.245, master: 0.26, weak: 0.215, terrible: 0.2 },
      jungle: { great: 0.23, master: 0.24, weak: 0.205, terrible: 0.195 },
      mid: { great: 0.25, master: 0.265, weak: 0.225, terrible: 0.21 },
      bot: { great: 0.255, master: 0.265, weak: 0.23, terrible: 0.215 } },
    { id: 'midShare', group: 'stats', type: 'metric', metric: 'share15to30', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.245, master: 0.265, weak: 0.2, terrible: 0.18 },
      top: { great: 0.25, master: 0.275, weak: 0.215, terrible: 0.195 },
      jungle: { great: 0.235, master: 0.255, weak: 0.2, terrible: 0.18 },
      mid: { great: 0.245, master: 0.265, weak: 0.2, terrible: 0.18 },
      bot: { great: 0.265, master: 0.285, weak: 0.225, terrible: 0.205 } },

    // ---------- fight & play ----------
    // kill participation (percentiles per position as above)
    { id: 'teamPlayer', group: 'fight', type: 'metric', metric: 'kp', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.47, master: 0.52, weak: 0.35, terrible: 0.29 },
      top: { great: 0.37, master: 0.41, weak: 0.25, terrible: 0.2 },
      jungle: { great: 0.52, master: 0.57, weak: 0.42, terrible: 0.36 },
      mid: { great: 0.47, master: 0.52, weak: 0.35, terrible: 0.29 },
      bot: { great: 0.51, master: 0.55, weak: 0.4, terrible: 0.34 },
      support: { great: 0.56, master: 0.61, weak: 0.47, terrible: 0.41 } },
    // dragons and barons of the own team the player was in on – the role decides what is normal
    // (no ranked games with this data yet: thresholds from the roles' jobs; recalculate like the
    // others once games of format 5 are stored)
    { id: 'objectives', group: 'fight', type: 'metric', metric: 'objPart', dir: 1, min: 10, stage: 'C', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.6, master: 0.75, weak: 0.3, terrible: 0.15 },  // mid
      top: { great: 0.45, master: 0.6, weak: 0.15, terrible: 0.05 },
      jungle: { great: 0.85, master: 0.95, weak: 0.55, terrible: 0.4 },
      bot: { great: 0.7, master: 0.8, weak: 0.4, terrible: 0.25 },
      support: { great: 0.75, master: 0.85, weak: 0.45, terrible: 0.3 } },
    { id: 'carry', group: 'fight', type: 'carry', pct: true, share: 0.28, kp: 0.5, min: 10, stage: 'B', roles: NOT_SUP, color: 'good', period: 'season' },
    { id: 'towerBreaker', group: 'fight', type: 'avg', metric: 'turretDmg', atLeast: 10000, min: 10, stage: 'B', roles: ALL, color: 'warn', period: 'season' },
    { id: 'noPinks', group: 'fight', type: 'avg', metric: 'pinks', below: 1 /* V */, min: 10, stage: 'B', roles: ALL, color: 'bad', period: 'season', dec: 1 }, // TODO Schwelle prüfen

    { id: 'soloFighter', group: 'fight', type: 'avg', metric: 'soloKills', atLeast: 2.5, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', dec: 1 },
    { id: 'duelist', group: 'fight', type: 'avg', metric: 'duels', atLeast: 0.66, min: 10, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'unkillable', group: 'fight', type: 'avg', metric: 'deaths10', below: 1, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', dec: 1 },
    { id: 'gankVictim', group: 'fight', type: 'avg', metric: 'gankDeaths15', atLeast: 2, min: 6, stage: 'C', roles: ALL, color: 'bad', period: 'season', dec: 1 },
    { id: 'readyToRumble', group: 'fight', type: 'avg', metric: 'firstKill5', atLeast: 0.66, min: 6, stage: 'C', roles: ALL, color: 'warn', period: 'season', pct: true },
    // off: the League client's timelines have no ward events (checked 24.11.2026) – back on if a source has them
    { id: 'earlyWarder', off: true, group: 'fight', type: 'avg', metric: 'ward3', atLeast: 0.9, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'dragonSlayer', group: 'fight', type: 'avg', metric: 'firstDrake', atLeast: 0.66, min: 10, stage: 'B', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'ganker', group: 'fight', type: 'avg', metric: 'gank', atLeast: 0.666, min: 6, stage: 'C', roles: ['jungle'], color: 'good', period: 'season', pct: true },
    { id: 'aggroJungler', group: 'fight', type: 'avg', metric: 'takedowns15', atLeast: 4, min: 6, stage: 'C', roles: ['jungle'], color: 'warn', period: 'season', dec: 1 },
    { id: 'passiveJungler', group: 'fight', type: 'avg', metric: 'takedowns15', below: 2, min: 6, stage: 'C', roles: ['jungle'], color: 'warn', period: 'season', dec: 1 },

    // ---------- mastery (all accounts together on the own accounts) ----------
    { id: 'mastery', group: 'mastery', type: 'mastery', stage: 'M', color: 'info', steps: { millionaire: 1000000, veteran: 500000, expert: 100000 }, max: 3 },
  ];
  // what may not stand next to each other (5.4); the first one wins
  const TAG_CONFLICTS = [['otp', 'flexPool'], ['otp', 'smallPool'], ['flexPool', 'smallPool'], ['generalist', 'autofill'], ['hotStreak', 'lossStreak'], ['unkillable', 'gankVictim'], ['aggroJungler', 'passiveJungler']];
  // a tag stays until its value is this much past the threshold the other way (no flicker)
  const TAG_HYSTERESIS = 0.05;
  // the main role: at least this share of the games, from this many games on
  const MAIN_ROLE = { share: 0.6, min: 10 };

  const api = { TAG_RULES, TAG_CONFLICTS, TAG_HYSTERESIS, MAIN_ROLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TagRules = api;
})(typeof window !== 'undefined' ? window : this);
