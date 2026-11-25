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
    // Thresholds from the stored ranked games (186 games, about 1,700 player games, 25.11.2026: per
    // game the median, the lowest fifth and the best quarter per role) checked against coaching
    // sites (vision: solo lanes 0.6–0.9/min, supports 2.0–2.8 and "under 1.5 isn't warding"; kill
    // participation: 42–46 % on average, under 50 % "not with the team"; CS: 6–7/min Iron–Gold,
    // 9–10 excellent). A season average is steadier than one game: weak ≈ the lowest fifth.
    { id: 'farm', group: 'stats', type: 'metric', metric: 'csMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 1,
      levels: { great: 8.0, master: 9.5, weak: 6.0, terrible: 5.0 },     // median 7.0–7.3, lowest fifth 6.0
      jungle: { great: 7.5, master: 8.5, weak: 5.5, terrible: 4.5 } },   // jungle: median 6.9, lowest fifth 5.8
    { id: 'damage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 0,
      levels: { great: 1000, master: 1300, weak: 520, terrible: 400 } }, // median 730–850, best quarter 1000–1090, lowest fifth 500–620
    { id: 'kda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 2,
      levels: { great: 3.0, master: 4.0, weak: 1.8, terrible: 1.3 }, support: { great: 4.0, master: 5.0, weak: 2.5, terrible: 1.8 } },
    { id: 'deaths', group: 'stats', type: 'metric', metric: 'deaths', dir: -1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 1,
      levels: { great: 4.0, master: 3.0, weak: 7.5, terrible: 9.0 } },  // median 6–7 deaths, best fifth 3–4
    { id: 'vision', group: 'stats', type: 'metric', metric: 'visMin', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', dec: 2,
      levels: { great: 1.0, master: 1.4, weak: 0.5, terrible: 0.35 },   // lanes: median 0.66–0.77, lowest fifth 0.48–0.59
      jungle: { great: 1.2, master: 1.6, weak: 0.6, terrible: 0.45 },    // jungle: median 0.83, coaching 1.4–1.8
      support: { great: 2.8, master: 3.3, weak: 2.0, terrible: 1.5 } },  // support: median 2.5, lowest fifth 2.1
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
    // kill participation: median top 35 %, mid 43 %, bot 49 %, jungle 44 %, support 53 %
    { id: 'teamPlayer', group: 'fight', type: 'metric', metric: 'kp', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.55, master: 0.65, weak: 0.33, terrible: 0.25 },
      top: { great: 0.48, master: 0.58, weak: 0.25, terrible: 0.18 },
      jungle: { great: 0.58, master: 0.68, weak: 0.32, terrible: 0.25 },
      support: { great: 0.62, master: 0.72, weak: 0.42, terrible: 0.34 } },
    // dragons and barons of the own team the player was in on – the role decides what is normal
    // (few games with this data yet: thresholds from the roles' jobs, to be checked)
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
