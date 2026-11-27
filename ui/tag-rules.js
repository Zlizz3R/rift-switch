// The tag catalogue as data: every threshold lives here and only here.
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
    // No tag needs more than 10 games: Live knows only the last 20 games of a player (and some of
    // them are ARAM or normals), so a higher minimum would hide the tag there.

    // ---------- champion & pool ----------
    { id: 'otp', group: 'pool', type: 'champShare', share: 0.8, pct: true, min: 10, stage: 'A', color: 'good', period: 'season' },
    { id: 'main', group: 'pool', type: 'champRecent', games: 10, days: 60, stage: 'A', color: 'good', period: 'd60' },
    { id: 'greatWith', group: 'pool', type: 'champWinrate', pct: true, games: 6, winrate: 0.6, min: 6, stage: 'A', color: 'good', period: 'season' },
    { id: 'newTo', group: 'pool', type: 'live', live: true, games: 2, days: 30, mastery: 20000, stage: 'A+M+L', color: 'warn' },
    { id: 'flexPool', group: 'pool', type: 'pool', champs: 5, maxShare: 0.4, min: 10, stage: 'A', color: 'info', period: 'season' },
    // the other way round: three champions take more than 90 % of the games
    { id: 'smallPool', group: 'pool', type: 'poolTop', champs: 3, share: 0.9, pct: true, min: 10, stage: 'A', color: 'bad', period: 'season' },
    { id: 'generalist', group: 'pool', type: 'roleSpread', pct: true, maxShare: 0.66, min: 10, stage: 'A', color: 'info', period: 'season' },
    // the other way round: more than 90 % of the games on one role
    { id: 'oneRole', group: 'pool', type: 'roleSpread', pct: true, minShare: 0.9, min: 10, stage: 'A', color: 'bad', period: 'season' },
    { id: 'mainTaken', group: 'pool', type: 'live', live: true, stage: 'A+L', color: 'warn' },
    { id: 'mainBanned', group: 'pool', type: 'live', live: true, stage: 'A+L', color: 'warn' },
    { id: 'autofill', group: 'pool', type: 'live', live: true, min: 10, stage: 'A+L', color: 'warn' },

    // ---------- activity & form ----------
    { id: 'hotStreak', group: 'form', type: 'streak', win: true, n: 3, min: 3, stage: 'A', color: 'good', period: 'all' },
    { id: 'lossStreak', group: 'form', type: 'streak', win: false, n: 3, min: 3, stage: 'A', color: 'bad', period: 'all' },
    { id: 'backAgain', group: 'form', type: 'break', days: 14, within: 3, min: 1, stage: 'A', color: 'info', period: 'all' },
    // 10 ranked games in 7 days (about 43 a month): reachable with the 20 games Live knows
    { id: 'grinder', group: 'form', type: 'count', games: 10, days: 7, stage: 'A', color: 'info', period: 'd7' },
    { id: 'smurf', group: 'form', type: 'level', below: 100, stage: 'A', color: 'warn' },

    // ---------- key figures with levels (per role; dir 1 = more is better) ----------
    // Thresholds per position from percentiles of the stored games of the other players (the own
    // accounts left out; 2,513 games, 23,857 player games, 27.11.2026): weak = the lowest 25 %,
    // terrible = the lowest 10 %, great = the best 33 %, master = the best 16.6 % (deaths the other
    // way round). A season average lies between one game and a random mix of ten, so each threshold is
    // the middle of both. Lane differences are mirrored (one player's lead is the other's deficit).
    // Recalculate: node tools/tag-thresholds.js – once 30 players have 10+ games on a position
    // (27.11.2026: 17–28), it gives their real season averages instead.
    { id: 'farm', group: 'stats', type: 'metric', metric: 'csMin', dir: 1, min: 10, stage: 'A', roles: NOT_SUP, period: 'season', dec: 1,
      levels: { great: 7.4, master: 7.9, weak: 6.5, terrible: 6 },
      top: { great: 7.5, master: 8, weak: 6.6, terrible: 6.1 },
      jungle: { great: 7.1, master: 7.5, weak: 6.3, terrible: 5.8 },
      mid: { great: 7.4, master: 7.9, weak: 6.5, terrible: 6 },
      bot: { great: 7.9, master: 8.3, weak: 7.1, terrible: 6.6 } },
    { id: 'damage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 0,
      levels: { great: 970, master: 1100, weak: 730, terrible: 620 },
      top: { great: 920, master: 1050, weak: 680, terrible: 580 },
      jungle: { great: 770, master: 900, weak: 560, terrible: 470 },
      mid: { great: 970, master: 1100, weak: 730, terrible: 620 },
      bot: { great: 980, master: 1130, weak: 720, terrible: 610 },
      support: { great: 440, master: 560, weak: 300, terrible: 250 } },
    { id: 'kda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 2,
      levels: { great: 2.7, master: 3.85, weak: 1.55, terrible: 1.15 },
      top: { great: 2.4, master: 3.35, weak: 1.3, terrible: 0.95 },
      jungle: { great: 3.4, master: 4.85, weak: 1.95, terrible: 1.5 },
      mid: { great: 2.7, master: 3.85, weak: 1.55, terrible: 1.15 },
      bot: { great: 2.8, master: 3.9, weak: 1.65, terrible: 1.25 },
      support: { great: 3.35, master: 4.65, weak: 1.95, terrible: 1.5 } },
    { id: 'deaths', group: 'stats', type: 'metric', metric: 'deaths', dir: -1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 1,
      levels: { great: 5.5, master: 4.2, weak: 8.1, terrible: 9.4 },
      top: { great: 5.4, master: 4.1, weak: 7.5, terrible: 9.3 },
      jungle: { great: 4.7, master: 4, weak: 7.3, terrible: 8.6 },
      mid: { great: 5.5, master: 4.2, weak: 8.1, terrible: 9.4 },
      bot: { great: 5.6, master: 4.3, weak: 8.2, terrible: 9.4 },
      support: { great: 5.5, master: 4.2, weak: 8.1, terrible: 9.4 } },
    { id: 'vision', group: 'stats', type: 'metric', metric: 'visMin', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', dec: 2,
      levels: { great: 0.77, master: 0.86, weak: 0.59, terrible: 0.5 },
      top: { great: 0.83, master: 0.92, weak: 0.65, terrible: 0.55 },
      jungle: { great: 0.96, master: 1.07, weak: 0.75, terrible: 0.64 },
      mid: { great: 0.77, master: 0.86, weak: 0.59, terrible: 0.5 },
      bot: { great: 0.7, master: 0.79, weak: 0.52, terrible: 0.44 },
      support: { great: 2.7, master: 2.92, weak: 2.21, terrible: 1.91 } },
    // the stored gold per minute is enough for this one (no full timeline needed)
    { id: 'laneGold', group: 'stats', type: 'metric', metric: 'goldDiff15', dir: 1, min: 6, stage: 'C', roles: ALL, period: 'season', dec: 0, signed: true,
      levels: { great: 400, master: 900, weak: -650, terrible: -1250 },
      top: { great: 500, master: 1100, weak: -800, terrible: -1500 },
      jungle: { great: 350, master: 800, weak: -600, terrible: -1100 },
      mid: { great: 400, master: 900, weak: -650, terrible: -1250 },
      bot: { great: 500, master: 1100, weak: -800, terrible: -1500 },
      support: { great: 250, master: 550, weak: -400, terrible: -750 } },

    // from the timeline (game format 4)
    { id: 'earlyFarm', group: 'stats', type: 'metric', metric: 'cs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 0,
      levels: { great: 118, master: 125, weak: 104, terrible: 96 },
      top: { great: 117, master: 124, weak: 101, terrible: 93 },
      jungle: { great: 109, master: 114, weak: 98, terrible: 92 },
      mid: { great: 118, master: 125, weak: 104, terrible: 96 },
      bot: { great: 119, master: 124, weak: 106, terrible: 98 } },
    { id: 'laneCs', group: 'stats', type: 'metric', metric: 'laneCs15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', dec: 1, signed: true,
      levels: { great: 7, master: 16, weak: -11, terrible: -21 },
      top: { great: 9, master: 21, weak: -15, terrible: -27 },
      jungle: { great: 6, master: 14, weak: -10, terrible: -20 },
      mid: { great: 7, master: 16, weak: -11, terrible: -21 },
      bot: { great: 7, master: 16, weak: -11, terrible: -21 } },
    { id: 'earlyShare', group: 'stats', type: 'metric', metric: 'share0to15', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.255, master: 0.265, weak: 0.23, terrible: 0.215 },
      top: { great: 0.25, master: 0.26, weak: 0.22, terrible: 0.205 },
      jungle: { great: 0.235, master: 0.245, weak: 0.215, terrible: 0.2 },
      mid: { great: 0.255, master: 0.265, weak: 0.23, terrible: 0.215 },
      bot: { great: 0.255, master: 0.265, weak: 0.23, terrible: 0.22 } },
    { id: 'midShare', group: 'stats', type: 'metric', metric: 'share15to30', dir: 1, min: 6, stage: 'C', roles: NOT_SUP, period: 'season', pct: true,
      levels: { great: 0.245, master: 0.265, weak: 0.205, terrible: 0.185 },
      top: { great: 0.26, master: 0.275, weak: 0.22, terrible: 0.195 },
      jungle: { great: 0.245, master: 0.26, weak: 0.205, terrible: 0.185 },
      mid: { great: 0.245, master: 0.265, weak: 0.205, terrible: 0.185 },
      bot: { great: 0.28, master: 0.3, weak: 0.24, terrible: 0.22 } },
    // gold per minute, destroyed wards (percentiles per position as above)
    { id: 'gold', group: 'stats', type: 'metric', metric: 'goldMin', dir: 1, min: 10, stage: 'A', roles: ALL, period: 'season', dec: 0,
      levels: { great: 445, master: 475, weak: 390, terrible: 365 },
      top: { great: 440, master: 465, weak: 380, terrible: 355 },
      jungle: { great: 470, master: 500, weak: 415, terrible: 390 },
      mid: { great: 445, master: 475, weak: 390, terrible: 365 },
      bot: { great: 510, master: 540, weak: 445, terrible: 415 },
      support: { great: 320, master: 340, weak: 290, terrible: 275 } },
    { id: 'wardHunter', group: 'stats', type: 'metric', metric: 'wardsKilled', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', dec: 1,
      levels: { great: 2, master: 2.6, weak: 0.7, terrible: 0.5 },
      top: { great: 1.8, master: 2.5, weak: 0.6, terrible: 0.4 },
      jungle: { great: 4.6, master: 5.9, weak: 2, terrible: 1.3 },
      mid: { great: 2, master: 2.6, weak: 0.7, terrible: 0.5 },
      bot: { great: 2.9, master: 3.5, weak: 1.4, terrible: 0.8 },
      support: { great: 7.8, master: 9.7, weak: 5, terrible: 3.7 } },
    // XP lead over the lane opponent at 15 minutes (game format 6; percentiles per position as above)
    { id: 'xpLead', group: 'stats', type: 'metric', metric: 'xpDiff15', dir: 1, min: 6, stage: 'C', roles: ALL, period: 'season', dec: 0, signed: true,
      levels: { great: 400, master: 850, weak: -600, terrible: -1150 },
      top: { great: 550, master: 1200, weak: -850, terrible: -1600 },
      jungle: { great: 350, master: 800, weak: -550, terrible: -1050 },
      mid: { great: 400, master: 850, weak: -600, terrible: -1150 },
      bot: { great: 300, master: 650, weak: -450, terrible: -900 },
      support: { great: 200, master: 500, weak: -350, terrible: -700 } },

    // ---------- fight & play ----------
    // kill participation (percentiles per position as above)
    { id: 'teamPlayer', group: 'fight', type: 'metric', metric: 'kp', dir: 1, min: 10, stage: 'B', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.48, master: 0.52, weak: 0.37, terrible: 0.31 },
      top: { great: 0.41, master: 0.46, weak: 0.3, terrible: 0.24 },
      jungle: { great: 0.54, master: 0.59, weak: 0.43, terrible: 0.38 },
      mid: { great: 0.48, master: 0.52, weak: 0.37, terrible: 0.31 },
      bot: { great: 0.52, master: 0.57, weak: 0.41, terrible: 0.35 },
      support: { great: 0.58, master: 0.62, weak: 0.47, terrible: 0.42 } },
    // dragons and barons of the own team the player was in on – the role decides what is normal
    // (percentiles per position as above). The jungler smites nearly all of them (a 10-game mix:
    // 96 % in the middle, 90 % for the lowest tenth): no good level there, only missing some
    { id: 'objectives', group: 'fight', type: 'metric', metric: 'objPart', dir: 1, min: 10, stage: 'C', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.44, master: 0.55, weak: 0.13, terrible: 0.1 },  // mid
      top: { great: 0.32, master: 0.43, weak: 0.1, terrible: 0.08 },
      jungle: { weak: 0.93, terrible: 0.89 },
      bot: { great: 0.62, master: 0.81, weak: 0.32, terrible: 0.19 },
      support: { great: 0.68, master: 0.83, weak: 0.41, terrible: 0.21 } },
    // first blood: in on it in a third of the games / its victim in a fifth (10-game mixes per position)
    { id: 'firstBlood', group: 'fight', type: 'metric', metric: 'fbPart', dir: 1, min: 10, stage: 'C', roles: ALL, period: 'season', pct: true,
      levels: { great: 0.3, master: 0.45 } },
    { id: 'fbVictim', group: 'fight', type: 'metric', metric: 'fbDeath', dir: -1, min: 10, stage: 'C', roles: ALL, period: 'season', pct: true,
      levels: { weak: 0.2, terrible: 0.3 }, jungle: { weak: 0.15, terrible: 0.25 } },
    // a team 2,000 gold behind at 15 wins 17.9 % of the games (and one ahead loses as often): 60 % of
    // at least 5 such games is clearly more than luck (an average player gets there about 1 in 23)
    { id: 'comeback', group: 'fight', type: 'avg', metric: 'comeback', atLeast: 0.6, min: 5, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'throws', group: 'fight', type: 'avg', metric: 'throws', atLeast: 0.6, min: 5, stage: 'C', roles: ALL, color: 'bad', period: 'season', pct: true },
    // win rate in games over 32 minutes against under 25 – only a clear difference (see tags.js 'phase';
    // its test for "clear" keeps 5 games a side honest)
    { id: 'lateGame', group: 'fight', type: 'phase', late: true, short: 25, long: 32, diff: 0.15, min: 5, stage: 'A', color: 'info', period: 'season' },
    { id: 'earlyGame', group: 'fight', type: 'phase', late: false, short: 25, long: 32, diff: 0.15, min: 5, stage: 'A', color: 'info', period: 'season' },
    // from the places of game format 6 (percentiles per position as above; roams, getting caught and
    // steals are small counts, so from the 10-game mixes alone). Checked against 186 games: the map
    // zones fit (minutes 3–8: tops 82 % on the top lane, mids 73 % mid, bots 85 % bot; early deaths
    // the same); kill places match the raw timeline exactly; 36 steals, 34 of them by junglers.
    // Bot laners roam and laners invade so rarely that a single time would be the best third: not
    // for them
    { id: 'roamer', group: 'fight', type: 'metric', metric: 'roam', dir: 1, min: 6, stage: 'C', roles: ['top', 'mid', 'support'], period: 'season', dec: 2,
      levels: { great: 1.1, master: 1.3 }, top: { great: 0.5, master: 0.7 }, support: { great: 0.6, master: 0.8 } },
    // off: "no team mate near" needs places at the moment of death, the timeline has them once a
    // minute – even killers and assisters, who were there, show up more than 2,500 units away in 37 %
    // of the kills (checked 25.11.2026). Back on with a source of exact places
    { id: 'caught', off: true, group: 'fight', type: 'metric', metric: 'caught', dir: -1, min: 6, stage: 'C', roles: ALL, period: 'season', dec: 2,
      levels: { weak: 1.1, terrible: 1.3 },  // mid
      top: { weak: 1.3, terrible: 1.5 },
      jungle: { weak: 0.8, terrible: 1 },
      bot: { weak: 0.7, terrible: 0.9 },
      support: { weak: 0.5, terrible: 0.7 } },
    { id: 'stealer', group: 'fight', type: 'metric', metric: 'steals', dir: 1, min: 10, stage: 'C', roles: ALL, period: 'season', dec: 2,
      levels: { great: 0.1, master: 0.2 } },
    { id: 'invader', group: 'fight', type: 'metric', metric: 'invade', dir: 1, min: 6, stage: 'C', roles: ['jungle'], period: 'season', dec: 0,
      levels: { great: 21, master: 28 } },
    { id: 'invaded', group: 'fight', type: 'metric', metric: 'invaded', dir: -1, min: 6, stage: 'C', roles: ['jungle'], period: 'season', dec: 0,
      levels: { weak: 27, terrible: 35 } },
    { id: 'carry', group: 'fight', type: 'carry', pct: true, share: 0.28, kp: 0.5, min: 10, stage: 'B', roles: NOT_SUP, color: 'good', period: 'season' },
    { id: 'towerBreaker', group: 'fight', type: 'avg', metric: 'turretDmg', atLeast: 10000, min: 10, stage: 'B', roles: ALL, color: 'good', period: 'season' },
    { id: 'noPinks', group: 'fight', type: 'avg', metric: 'pinks', below: 1 /* V */, min: 10, stage: 'B', roles: ALL, color: 'bad', period: 'season', dec: 1 }, // TODO Schwelle prüfen

    { id: 'soloFighter', group: 'fight', type: 'avg', metric: 'soloKills', atLeast: 2.5, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', dec: 1 },
    { id: 'duelist', group: 'fight', type: 'avg', metric: 'duels', atLeast: 0.66, min: 10, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'unkillable', group: 'fight', type: 'avg', metric: 'deaths10', below: 1, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', dec: 1 },
    { id: 'gankVictim', group: 'fight', type: 'avg', metric: 'gankDeaths15', atLeast: 2, min: 6, stage: 'C', roles: ALL, color: 'bad', period: 'season', dec: 1 },
    { id: 'readyToRumble', group: 'fight', type: 'avg', metric: 'firstKill5', atLeast: 0.66, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    // off: the League client's timelines have no ward events (checked 24.11.2026) – back on if a source has them
    { id: 'earlyWarder', off: true, group: 'fight', type: 'avg', metric: 'ward3', atLeast: 0.9, min: 6, stage: 'C', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'dragonSlayer', group: 'fight', type: 'avg', metric: 'firstDrake', atLeast: 0.66, min: 10, stage: 'B', roles: ALL, color: 'good', period: 'season', pct: true },
    { id: 'ganker', group: 'fight', type: 'avg', metric: 'gank', atLeast: 0.666, min: 6, stage: 'C', roles: ['jungle'], color: 'good', period: 'season', pct: true },
    { id: 'aggroJungler', group: 'fight', type: 'avg', metric: 'takedowns15', atLeast: 4, min: 6, stage: 'C', roles: ['jungle'], color: 'good', period: 'season', dec: 1 },
    { id: 'passiveJungler', group: 'fight', type: 'avg', metric: 'takedowns15', below: 2, min: 6, stage: 'C', roles: ['jungle'], color: 'warn', period: 'season', dec: 1 },

    // ---------- mastery (all accounts together on the own accounts) ----------
    { id: 'mastery', group: 'mastery', type: 'mastery', stage: 'M', color: 'info', steps: { legend: 10000000, multi: 5000000, millionaire: 1000000, veteran: 500000, expert: 100000 } },
  ];
  // ---------- ARAM: this season's ARAM games (no roles, no lane, no vision) ----------
  // Thresholds from the stored ARAM games of the other players (1,462 games, 3,451 player games,
  // 26.11.2026; the short match-list games count wherever a figure needs no team): weak = the lowest
  // 25 %, terrible = the lowest 10 %, great = the best 33 %, master = the best 16.6 % (deaths the other
  // way round), each the middle of one game and a mix of ten. ARAM numbers are far higher than on
  // the Rift (more fights, shorter games). Recalculate: node tools/aram-thresholds.js
  const ARAM_RULES = [
    { id: 'greatWith', group: 'pool', type: 'champWinrate', pct: true, games: 6, winrate: 0.6, min: 6, stage: 'A', color: 'good', period: 'season' },
    { id: 'arHot', group: 'form', type: 'streak', win: true, n: 3, min: 3, stage: 'A', color: 'good', period: 'all' },
    { id: 'arCold', group: 'form', type: 'streak', win: false, n: 3, min: 3, stage: 'A', color: 'bad', period: 'all' },
    { id: 'arDamage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', period: 'season', dec: 0,
      levels: { great: 2380, master: 2780, weak: 1700, terrible: 1400 } },
    { id: 'arKda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', period: 'season', dec: 2,
      levels: { great: 3.54, master: 4.25, weak: 2.59, terrible: 2.24 } },
    // per 10 minutes: ARAM games differ a lot in length
    { id: 'arDeaths', group: 'stats', type: 'metric', metric: 'deathsMin10', dir: -1, min: 10, stage: 'A', period: 'season', dec: 1,
      levels: { great: 5.7, master: 5.1, weak: 7, terrible: 7.7 } },
    { id: 'arTeam', group: 'fight', type: 'metric', metric: 'kp', dir: 1, min: 10, stage: 'B', period: 'season', pct: true,
      levels: { great: 0.69, master: 0.73, weak: 0.6, terrible: 0.55 } },
    // damage taken + mitigated, healing (own and team), crowd control – only a good side: a low value is a role, not a weakness
    { id: 'arTank', group: 'fight', type: 'metric', metric: 'tankMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 4900, master: 6530 } },
    { id: 'arHeal', group: 'fight', type: 'metric', metric: 'healMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 580, master: 840 } },
    { id: 'arCc', group: 'fight', type: 'metric', metric: 'ccMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 1.95, master: 2.53 } },
    // a triple kill or more in 27 % of all ARAM games; 45 % of ten games is about the best tenth
    { id: 'arMulti', group: 'fight', type: 'avg', metric: 'multi3', atLeast: 0.45, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    // the damage share of ten games: 22 % for the best sixth; together with a kill participation above the best third
    { id: 'arCarry', group: 'fight', type: 'carry', pct: true, share: 0.24, kp: 0.67, min: 10, stage: 'B', color: 'good', period: 'season' },
    // 27.11.2026, tools/aram-thresholds.js on 5,192 ARAM games of other players (best third / best sixth);
    // only a good side: few kills, assists or tower damage is a role, not a weakness
    { id: 'arKills', group: 'stats', type: 'metric', metric: 'killsMin10', dir: 1, min: 10, stage: 'A', period: 'season', dec: 1, levels: { great: 6.7, master: 8.1 } },
    { id: 'arAssists', group: 'stats', type: 'metric', metric: 'assistsMin10', dir: 1, min: 10, stage: 'A', period: 'season', dec: 1, levels: { great: 15, master: 17 } },
    // damage dealt ÷ damage taken: who hits from a distance and isn't hit back (the median is about 1)
    { id: 'arPoke', group: 'stats', type: 'metric', metric: 'poke', dir: 1, min: 10, stage: 'B', period: 'season', dec: 2, levels: { great: 1.13, master: 1.37 } },
    { id: 'arTowers', group: 'fight', type: 'metric', metric: 'turretMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 95, master: 140 } },
    // in on the game's first kill: 43 % of all ARAM games; 60 % of ten games is about the best sixth
    { id: 'arFirstBlood', group: 'fight', type: 'metric', metric: 'fbPart', dir: 1, min: 10, stage: 'C', period: 'season', pct: true, levels: { great: 0.6, master: 0.7 } },
    // 1,500 gold behind / ahead at minute 10: teams still win (lose) about 28 % of those games
    { id: 'arComeback', group: 'fight', type: 'avg', metric: 'comeback10', atLeast: 0.5, min: 5, stage: 'C', color: 'good', period: 'season', pct: true },
    { id: 'arThrows', group: 'fight', type: 'avg', metric: 'throws10', atLeast: 0.5, min: 5, stage: 'C', color: 'bad', period: 'season', pct: true },
    // win rate in short games (under 17 min, the shortest third) against long ones (21 min and more)
    { id: 'arLate', group: 'fight', type: 'phase', late: true, short: 17, long: 21, diff: 0.15, min: 5, stage: 'A', color: 'info', period: 'season' },
    { id: 'arEarly', group: 'fight', type: 'phase', late: false, short: 17, long: 21, diff: 0.15, min: 5, stage: 'A', color: 'info', period: 'season' },
    // 27.11.2026, from 3,252 ARAM games (5,821 player games of other players): the best third / sixth;
    // only a good side – none of these is a weakness when low
    { id: 'arGold', group: 'stats', type: 'metric', metric: 'goldMin', dir: 1, min: 10, stage: 'A', period: 'season', dec: 0, levels: { great: 975, master: 1010 } },
    { id: 'arWave', group: 'stats', type: 'metric', metric: 'csMin', dir: 1, min: 10, stage: 'A', period: 'season', dec: 1, levels: { great: 2.4, master: 2.9 } },
    { id: 'arDoubles', group: 'fight', type: 'metric', metric: 'doubles', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 2.05, master: 3.2 } },
    // a quadra kill or more: in about one ARAM game of twenty; one game in ten over ten games is the best sixth
    { id: 'arQuadra', group: 'fight', type: 'avg', metric: 'multi4', atLeast: 0.1, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    { id: 'arMitig', group: 'fight', type: 'metric', metric: 'mitigMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 2400, master: 3540 } },
    { id: 'arCrit', group: 'stats', type: 'metric', metric: 'crit', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 470, master: 770 } },
    { id: 'arSpree', group: 'fight', type: 'metric', metric: 'spree', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 3.1, master: 3.75 } },
    // what kind of damage: a play style, not a judgement (the median is 55 % magic, 35 % physical)
    { id: 'arMage', group: 'stats', type: 'avg', metric: 'magicShare', atLeast: 0.75, min: 10, stage: 'B', color: 'info', period: 'season', pct: true },
    { id: 'arWeapon', group: 'stats', type: 'avg', metric: 'physShare', atLeast: 0.7, min: 10, stage: 'B', color: 'info', period: 'season', pct: true },
    { id: 'arGrinder', group: 'form', type: 'count', games: 20, days: 7, stage: 'A', color: 'info', period: 'd7' },
    { id: 'arBack', group: 'form', type: 'break', days: 14, within: 3, min: 1, stage: 'A', color: 'info', period: 'all' },
  ];
  // ---------- Arena: this season's Arena games (six teams of three since 2026; a win = the top three) ----------
  // 27.11.2026, from 803 Arena games of other players (623 player games with their placing): the best
  // third / sixth, the lowest quarter / tenth for the few with a bad side
  const ARENA_RULES = [
    { id: 'greatWith', group: 'pool', type: 'champWinrate', pct: true, games: 5, winrate: 0.6, min: 5, stage: 'A', color: 'good', period: 'season' },
    { id: 'arnPool', group: 'pool', type: 'pool', champs: 8, maxShare: 0.25, min: 10, stage: 'A', color: 'info', period: 'season' },
    { id: 'arnHot', group: 'form', type: 'streak', win: true, n: 3, min: 3, stage: 'A', color: 'good', period: 'all' },
    { id: 'arnCold', group: 'form', type: 'streak', win: false, n: 3, min: 3, stage: 'A', color: 'bad', period: 'all' },
    { id: 'arnGrinder', group: 'form', type: 'count', games: 10, days: 7, stage: 'A', color: 'info', period: 'd7' },
    // the top three in 70 % of ten games / first in 30 %: the best sixth of the ten-game mixes
    { id: 'arnPodium', group: 'stats', type: 'avg', metric: 'top3', atLeast: 0.7, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    { id: 'arnCrown', group: 'stats', type: 'avg', metric: 'first', atLeast: 0.3, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    { id: 'arnPlace', group: 'stats', type: 'metric', metric: 'placeAvg', dir: -1, min: 10, stage: 'A', period: 'season', dec: 1,
      levels: { great: 2.6, master: 2, weak: 4.4, terrible: 5.1 } },
    { id: 'arnDamage', group: 'stats', type: 'metric', metric: 'dmgMin', dir: 1, min: 10, stage: 'A', period: 'season', dec: 0,
      levels: { great: 1780, master: 2200, weak: 1130, terrible: 870 } },
    { id: 'arnKda', group: 'stats', type: 'metric', metric: 'kda', dir: 1, min: 10, stage: 'A', period: 'season', dec: 2,
      levels: { great: 3.06, master: 3.8, weak: 1.82, terrible: 1.37 } },
    { id: 'arnDeaths', group: 'stats', type: 'metric', metric: 'deathsMin10', dir: -1, min: 10, stage: 'A', period: 'season', dec: 1,
      levels: { great: 2.73, master: 2.49, weak: 3.34, terrible: 3.77 } },
    { id: 'arnKills', group: 'stats', type: 'metric', metric: 'killsMin10', dir: 1, min: 10, stage: 'A', period: 'season', dec: 1, levels: { great: 3.3, master: 4.2 } },
    { id: 'arnAssists', group: 'stats', type: 'metric', metric: 'assistsMin10', dir: 1, min: 10, stage: 'A', period: 'season', dec: 1, levels: { great: 5, master: 6.1 } },
    { id: 'arnTank', group: 'fight', type: 'metric', metric: 'tankMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 3900, master: 5250 } },
    { id: 'arnHeal', group: 'fight', type: 'metric', metric: 'healMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 425, master: 675 } },
    { id: 'arnCc', group: 'fight', type: 'metric', metric: 'ccMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 2.6, master: 3.2 } },
    { id: 'arnMulti', group: 'fight', type: 'avg', metric: 'multi3', atLeast: 0.3, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    { id: 'arnSpree', group: 'fight', type: 'metric', metric: 'spree', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 3.9, master: 5.2 } },
    { id: 'arnCrit', group: 'fight', type: 'metric', metric: 'crit', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 280, master: 525 } },
    // twelve more (27.11.2026; 812 stored Arena games of other players, 1,515 player games – the team
    // figures from the games with every player stored). A quadra kill is all but impossible in Arena
    // (0.3 % of the games): no hunter for it
    { id: 'arnGold', group: 'stats', type: 'metric', metric: 'goldMin', dir: 1, min: 10, stage: 'A', period: 'season', dec: 0, levels: { great: 620, master: 685 } },
    { id: 'arnDoubles', group: 'fight', type: 'metric', metric: 'doubles', dir: 1, min: 10, stage: 'B', period: 'season', dec: 1, levels: { great: 1.2, master: 1.85 } },
    { id: 'arnMitig', group: 'fight', type: 'metric', metric: 'mitigMin', dir: 1, min: 10, stage: 'B', period: 'season', dec: 0, levels: { great: 2600, master: 3750 } },
    { id: 'arnMage', group: 'stats', type: 'avg', metric: 'magicShare', atLeast: 0.75, min: 10, stage: 'B', color: 'info', period: 'season', pct: true },
    { id: 'arnWeapon', group: 'stats', type: 'avg', metric: 'physShare', atLeast: 0.7, min: 10, stage: 'B', color: 'info', period: 'season', pct: true },
    // true damage: a tenth is usual, a fifth the best sixth
    { id: 'arnTrue', group: 'stats', type: 'avg', metric: 'trueShare', atLeast: 0.2, min: 10, stage: 'B', color: 'info', period: 'season', pct: true },
    // the last two teams in half of ten games: the best sixth of the ten-game mixes
    { id: 'arnFinal', group: 'stats', type: 'avg', metric: 'top2', atLeast: 0.5, min: 10, stage: 'A', color: 'good', period: 'season', pct: true },
    // against an even share of the team (1 = as much as each team mate; a team of three: 1.2 = 40 %)
    { id: 'arnCarry', group: 'fight', type: 'avg', metric: 'arenaDmgShare', atLeast: 1.2, min: 10, stage: 'B', color: 'good', period: 'season', dec: 2 },
    { id: 'arnKillShare', group: 'fight', type: 'avg', metric: 'arenaKillShare', atLeast: 1.35, min: 10, stage: 'B', color: 'good', period: 'season', dec: 2 },
    // in Arena nearly every kill is the whole team's (85 % on average): 92 % is the best twentieth
    { id: 'arnTeam', group: 'fight', type: 'avg', metric: 'arenaKp', atLeast: 0.92, min: 10, stage: 'B', color: 'good', period: 'season', pct: true },
    { id: 'arnSpecialist', group: 'pool', type: 'champShare', share: 0.4, pct: true, min: 10, stage: 'A', color: 'good', period: 'season' },
    { id: 'arnBack', group: 'form', type: 'break', days: 14, within: 3, min: 1, stage: 'A', color: 'info', period: 'all' },
  ];
  // what may not stand next to each other (5.4); the first one wins
  const TAG_CONFLICTS = [['otp', 'flexPool'], ['otp', 'smallPool'], ['flexPool', 'smallPool'], ['generalist', 'autofill'], ['hotStreak', 'lossStreak'], ['unkillable', 'gankVictim'], ['aggroJungler', 'passiveJungler'],
    ['arHot', 'arCold'], ['arComeback', 'arThrows'], ['arLate', 'arEarly'], ['arMage', 'arWeapon'], ['arnHot', 'arnCold'], ['arnCrown', 'arnPodium'], ['arnMage', 'arnWeapon'], ['arnCrown', 'arnFinal'], ['arnSpecialist', 'arnPool']];
  // a tag stays until its value is this much past the threshold the other way (no flicker)
  const TAG_HYSTERESIS = 0.05;
  // the main role: at least this share of the games, from this many games on
  const MAIN_ROLE = { share: 0.6, min: 10 };

  const api = { TAG_RULES, ARAM_RULES, ARENA_RULES, TAG_CONFLICTS, TAG_HYSTERESIS, MAIN_ROLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TagRules = api;
})(typeof window !== 'undefined' ? window : this);
