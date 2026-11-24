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
    { id: 'flexPool', group: 'pool', type: 'pool', champs: 5, maxShare: 0.5, min: 15, stage: 'A', color: 'info', period: 'season' },
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
    { id: 'farm', group: 'stats', type: 'metric', metric: 'csMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 1,
      levels: { great: 8.0, master: 9.5 /* V */, weak: 5.5 /* V */ } },   // TODO Schwelle prüfen (Meister, Schwach)
    { id: 'damage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 0,
      levels: { great: 800, master: 1100 /* V */, weak: 450 /* V */ } },  // TODO Schwelle prüfen (Meister, Schwach)
    { id: 'kda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 2,
      levels: { great: 3.0, master: 4.0, weak: 1.6 }, support: { great: 4.0, master: 5.0, weak: 2.5 } },
    { id: 'deaths', group: 'stats', type: 'metric', metric: 'deaths', dir: -1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 1,
      levels: { great: 3.0, terrible: 7.0 } },
    { id: 'vision', group: 'stats', type: 'metric', metric: 'visMin', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', dec: 2,
      levels: { great: 1.0, master: 1.5 /* V */, weak: 0.5 /* V */ },    // TODO Schwelle prüfen (Meister, Schwach)
      support: { great: 2.0, master: 2.8 /* V */, weak: 1.3 /* V */ } },  // TODO Schwelle prüfen (Meister, Schwach)
    // the stored gold per minute is enough for this one (no full timeline needed)
    { id: 'laneGold', group: 'stats', type: 'metric', metric: 'goldDiff15', dir: 1, min: 6, stage: 'C', roles: ALL, period: 'season', dec: 0, signed: true,
      levels: { great: 500, master: 1000 /* V */, weak: -500 /* V */ } }, // TODO Schwelle prüfen (Meister, Schwach)

    // from the timeline (game format 4)
    { id: 'earlyFarm', group: 'stats', type: 'metric', metric: 'cs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 0,
      levels: { great: 120, master: 140 /* V */, weak: 85 /* V */ } },    // TODO Schwelle prüfen (Meister, Schwach)
    { id: 'laneCs', group: 'stats', type: 'metric', metric: 'laneCs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 1, signed: true,
      levels: { great: 15, master: 25 /* V */, terrible: -15 } },         // TODO Schwelle prüfen (Meister)
    { id: 'earlyShare', group: 'stats', type: 'metric', metric: 'share0to15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.275 /* V */, master: 0.32 /* V */, weak: 0.15 /* V */ } }, // TODO Schwelle prüfen
    { id: 'midShare', group: 'stats', type: 'metric', metric: 'share15to30', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.275, master: 0.32 /* V */, weak: 0.15 /* V */ } }, // TODO Schwelle prüfen (Meister, Schwach)

    // ---------- fight & play ----------
    { id: 'teamPlayer', group: 'fight', type: 'metric', metric: 'kp', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.65, master: 0.75 /* V */ },                      // TODO Schwelle prüfen (Meister)
      support: { great: 0.70 /* V */, master: 0.80 /* V */ } },           // TODO Schwelle prüfen (Support)
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
  const TAG_CONFLICTS = [['otp', 'flexPool'], ['generalist', 'autofill'], ['hotStreak', 'lossStreak'], ['unkillable', 'gankVictim'], ['aggroJungler', 'passiveJungler']];
  // a tag stays until its value is this much past the threshold the other way (no flicker)
  const TAG_HYSTERESIS = 0.05;
  // the main role: at least this share of the games, from this many games on
  const MAIN_ROLE = { share: 0.6, min: 10 };

  const api = { TAG_RULES, TAG_CONFLICTS, TAG_HYSTERESIS, MAIN_ROLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TagRules = api;
})(typeof window !== 'undefined' ? window : this);
