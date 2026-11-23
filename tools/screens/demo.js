// Builds a demo copy of the window (tools/screens/site/) with a fake background part and made-up
// accounts – for the screenshots and the demo video in the README (tools/screens/capture.py).
// Nothing here talks to Riot; no real account is used.
//   node tools/screens/demo.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'ui'), OUT, { recursive: true });

const DAY = 86400000;
const now = Date.now();
const P = n => String(n).padStart(8, '0') + '-dddd-4ddd-8ddd-dddddddddddd';
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------- accounts ----------
const T = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'], DV = ['IV', 'III', 'II', 'I'];
const toR = v => { const i = Math.min(6, Math.floor(v / 400)), d = Math.floor((v - i * 400) / 100); return { tier: T[i], division: DV[d], lp: v % 100 }; };
const q = (v, w, l) => ({ ...toR(v), wins: w, losses: l, wl: true });
const ACC = [
  // name, tag, icon, level, solo score, flex score, category, note, last played (days)
  ['Moonlit Fox', 'EUW', 4568, 412, 2470, 2105, '', 'Main', 0.2],
  ['Baron Bait', 'EUW', 5367, 187, 1930, 1640, '', '', 1],
  ['Ward Hoarder', 'EUW', 4834, 96, 1520, null, 'c1', 'Support only', 3],
  ['Flash on D', 'EUW', 6271, 63, 1170, 1210, 'c1', '', 6],
  ['Mid or Feed', 'EUW', 5205, 41, 860, null, 'c1', 'Duo with Sam', 12],
  ['Tilted Toaster', 'EUNE', 3478, 230, 2010, null, 'c2', '', 2],
];
const accounts = ACC.map(([name, tag, icon, level, solo, flex, cat, note, played], i) => ({
  puuid: P(i + 1), gameName: name, tagLine: tag, region: tag === 'EUNE' ? 'EUNE' : 'EUW', level, iconId: icon, note,
  hasCred: true, category: cat || undefined, historyLen: 70, addedAt: i, lastPlayed: now - played * DAY,
  solo: q(solo, 40 + i * 7, 33 + i * 5), flex: flex ? q(flex, 12 + i, 9 + i) : null,
  profile: { at: now - DAY, be: 34120 - i * 3000, rp: 1350 - i * 200, champs: 151 - i * 20, champsTotal: 171, skins: 63 - i * 9, honor: 3, masteryScore: 812 - i * 90,
    topMastery: [{ id: 103, level: 42, points: 512340 }, { id: 222, level: 18, points: 210400 }, { id: 412, level: 12, points: 140220 }] },
}));
accounts[0].goal = { tier: 'DIAMOND', division: 'II' };
accounts[0].solo.peak = { tier: 'DIAMOND', division: 'III' }; accounts[0].solo.lastSeason = { tier: 'EMERALD', division: 'I' };
accounts[1].solo.peak = { tier: 'EMERALD', division: 'IV' }; accounts[1].solo.lastSeason = { tier: 'PLATINUM', division: 'II' };
accounts[2].lowPrio = { games: 2, perGame: 300, at: now };
accounts.push({ puuid: 'new-' + P(9), placeholder: true, gameName: 'sm•••01', tagLine: '', note: 'from the list', hasCred: true, category: 'c2' });

// LP history (a walk back from today) and the ranked games behind it
function walk(end, drift, queue) {
  const h = [], g = [];
  let v = end, t = now - 3600000;
  for (let k = 0; k < 70; k++) {
    h.unshift({ t, [queue]: toR(Math.max(0, v)) });
    const win = rnd() < 0.5 + drift;
    g.push({ id: Math.floor(rnd() * 1e9), t, q: queue, win, champ: 103 });
    v -= win ? 21 : -19;
    t -= (4 + rnd() * 26) * 3600000;
  }
  return { h, g };
}
const DRIFT = [0.06, 0.03, 0.05, -0.02, 0.08, 0.0];
const dashboard = accounts.filter(a => !a.placeholder).map((a, i) => {
  const s = walk(ACC[i][4], DRIFT[i], 'solo');
  const f = ACC[i][5] ? walk(ACC[i][5], 0.02, 'flex') : { h: [], g: [] };
  const history = [...s.h, ...f.h].sort((x, y) => x.t - y.t);
  return { puuid: a.puuid, history, games: [...s.g, ...f.g] };
});

// ---------- collection ----------
const collections = [
  { puuid: P(1), at: now - DAY, champs: [103, 222, 412, 86, 157, 64, 238, 91, 84, 517], skins: [[103001, 'Dynasty Ahri', '/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin01/Images/ahri_splash_tile_1.jpg'], [103015, 'K/DA Ahri', '/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin15/Images/ahri_splash_tile_15.jpg'], [103027, 'Spirit Blossom Ahri', '/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin27/Images/ahri_splash_tile_27.jpg'], [222004, 'Star Guardian Jinx', '/lol-game-data/assets/ASSETS/Characters/Jinx/Skins/Skin04/Images/jinx_splash_tile_4.jpg']], shards: [['c', 24, 2, 'Jax', ''], ['s', 103042, 1, 'Coven Ahri', '/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin42/Images/ahri_splash_tile_42.jpg'], ['S', 412001, 1, 'Deep Terror Thresh', '/lol-game-data/assets/ASSETS/Characters/Thresh/Skins/Skin01/Images/thresh_splash_tile_1.jpg']] },
  { puuid: P(2), at: now - 2 * DAY, champs: [103, 86, 122, 24, 266], skins: [[86005, 'Rugged Garen', '/lol-game-data/assets/ASSETS/Characters/Garen/Skins/Skin05/Images/garen_splash_tile_5.jpg'], [24001, 'The Mighty Jax', '/lol-game-data/assets/ASSETS/Characters/Jax/Skins/Skin01/Images/jax_splash_tile_1.jpg']], shards: [['c', 103, 1, 'Ahri', ''], ['c', 412, 3, 'Thresh', '']] },
  { puuid: P(3), at: now - 4 * DAY, champs: [412, 117, 89, 40], skins: [[412001, 'Deep Terror Thresh', '/lol-game-data/assets/ASSETS/Characters/Thresh/Skins/Skin01/Images/thresh_splash_tile_1.jpg']], shards: [['s', 103001, 1, 'Dynasty Ahri', '/lol-game-data/assets/ASSETS/Characters/Ahri/Skins/Skin01/Images/ahri_splash_tile_1.jpg']] },
];

// ---------- match history ----------
const CH = [[103, 'Ahri', 'mid'], [64, 'Lee Sin', 'jungle'], [222, 'Jinx', 'bot'], [412, 'Thresh', 'support'], [86, 'Garen', 'top'], [24, 'Jax', 'top'], [266, 'Aatrox', 'jungle'], [238, 'Zed', 'mid'], [51, 'Caitlyn', 'bot'], [117, 'Lulu', 'support']];
const NAMES = ['Moonlit Fox', 'Jungle Diff', 'Crit Happens', 'Hookline', 'Demacia Main', 'Split Push Sam', 'Gank Plank', 'Shadow Step', 'Headshot Hero', 'Pocket Healer'];
function game(n, win, owner = P(1)) {
  const mine = [103, 238, 103, 517, 103, 157, 91, 103, 238][n % 9];   // the own account plays a few champions
  const players = CH.map(([c0, , pos], i) => {
    const champ = i === 0 ? mine : c0;
    const blue = i < 5, won = blue === win;
    return { puuid: i === 0 ? owner : 'x' + n + i, name: i === 0 ? accounts.find(a => a.puuid === owner).gameName : NAMES[i], tag: 'EUW', champ, team: blue ? 100 : 200, pos, win: won,
      k: Math.floor(rnd() * 12) + (won ? 3 : 0), d: Math.floor(rnd() * 8) + 1, a: Math.floor(rnd() * 14) + 2, cs: 120 + Math.floor(rnd() * 140), gold: 8000 + Math.floor(rnd() * 6000),
      dmg: 12000 + Math.floor(rnd() * 22000), vis: 12 + Math.floor(rnd() * 40), lvl: 13 + Math.floor(rnd() * 5),
      items: [[3157, 3020, 6655, 4645, 3089, 0, 3340], [6692, 3111, 3071, 3053, 0, 0, 3364], [3031, 3006, 3094, 3036, 3072, 0, 3363], [3190, 3117, 3109, 2065, 0, 0, 3364], [3078, 3047, 6333, 3065, 0, 0, 3340]][i % 5],
      spells: [[4, 14], [4, 11], [4, 7], [4, 3], [4, 12]][i % 5], keystone: [8112, 8010, 8008, 8439, 8010][i % 5], sub: [8300, 8100, 8200, 8400, 8200][i % 5], multi: n === 2 && i === 0 ? 3 : 0,
      x: { taken: 20000, phys: 9000, magic: 8000, true: 600, heal: 3000, mitig: 15000, cc: 10, wards: 9, wardsKilled: 3, pinks: 2, spent: 9000, turretDmg: 3000, obj: 6000, spree: 3 } };
  });
  const len = 24 + (n % 9);
  const gold = Array.from({ length: len }, (_, m) => players.map((p, i) => 500 + m * (320 + i * 9) + (p.win ? m * 22 : 0)));
  return { id: String(7000 + n), v: 3, t: now - n * 0.6 * DAY, dur: len * 60 + 12, q: [420, 420, 440, 420, 450, 420, 400, 420][n % 8], mode: n % 8 === 4 ? 'ARAM' : 'CLASSIC', remake: false,
    players, gold, teams: [{ id: 100, towers: win ? 9 : 3, drakes: win ? 3 : 1, barons: win ? 1 : 0 }, { id: 200, towers: win ? 2 : 8, drakes: win ? 1 : 3 }], owners: [owner] };
}
const games = [game(1, true), game(2, true), game(3, false), game(4, true), game(5, false), game(6, true), game(7, true, P(2)), game(8, false, P(2)), game(9, true), game(10, true), game(11, false), game(12, true)];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'rift-switch') : '';
// public CommunityDragon data the app caches (item / spell / rune pictures, champion names)
const assets = readJson(path.join(appData, 'assets.json')) || { items: {}, spells: {}, perks: {}, styles: {} };
const champs = (readJson(path.join(appData, 'champions.json')) || {}).list || CH.map(([id, name]) => ({ id, name }));

// ---------- live: champion select with the helper ----------
const live = { clientUp: true, phase: 'ChampSelect', region: 'EUW', me: P(1), champSelect: { myPosition: 'middle', hiddenNames: true,
  allies: [[P(1), 'Moonlit Fox', 103, 'middle'], ['a2', 'Jungle Diff', 64, 'jungle'], ['a3', 'Crit Happens', 222, 'bottom'], ['a4', 'Hookline', 412, 'utility'], ['a5', 'Demacia Main', 86, 'top']]
    .map(([puuid, gameName, championId, position], i) => ({ puuid, gameName, tagLine: 'EUW', championId, position, iconId: 20 + i, solo: q(1800 + i * 150, 30 + i, 25), flex: i % 2 ? q(1500 + i * 100, 10, 9) : null })),
  enemies: [{ championId: 238 }, { championId: 24 }, { championId: 51 }, { championId: 0 }, { championId: 0 }] } };
const counters = { Zed: { share: 88, list: [{ name: 'Ahri', wr: 51.8, rating: 6.4 }, { name: 'Lulu', wr: 50.9, rating: 5.6 }, { name: 'Galio', wr: 53.2, rating: 7.1 }, { name: 'Malzahar', wr: 54.0, rating: 7.6 }, { name: 'Syndra', wr: 48.7, rating: 4.2 }] } };

const state = {
  accounts, categories: [{ id: 'c1', name: 'Smurfs', collapsed: false }, { id: 'c2', name: 'Other servers', collapsed: false }], active: P(1),
  settings: { lang: process.env.DEMO_LANG || 'en', theme: 'dark', uiScale: '100', confirmSwitch: true, autoPlay: true, sort: 'custom', tile: null, layout: 'tiles',
    champPool: [103, 238, 517, 157, 91], lane: 'mid', seenVersion: '1.2.0', askedStart: true },
  live: { clientUp: true, puuid: P(1), phase: 'ChampSelect', waits: [] }, hasLock: false, sealLogins: false, pendingAdd: false, busy: false, login: null,
  version: '1.2.0', update: { status: 'current' }, switching: null,
};

const shim = `<script>
(function () {
  const D = ${JSON.stringify({ state, dashboard, collections, games, assets, champs, live, counters })};
  const listeners = {};
  const answer = (ch, args) => {
    switch (ch) {
      case 'get-state': return D.state;
      case 'dashboard': return D.dashboard;
      case 'collections': return D.collections;
      case 'champions': return D.champs;
      case 'live': return D.live;
      case 'counters': { const c = D.counters[args[0]]; return c ? { ok: true, share: c.share, list: c.list } : { ok: true, share: 0, list: [] }; }
      case 'matches': return { index: D.games.map(g => [g.id, g.t, g.q, ...g.owners]), waiting: 0, loadingOlder: false, clientUp: true };
      case 'matches-get': return D.games.filter(g => args[0].includes(g.id));
      case 'mh-assets': return D.assets;
      case 'mh-storage': return { bytes: 2400000, games: 1312 };
      case 'player-ranks': return { ranks: {}, pending: 0 };
      case 'get-history': { const d = D.dashboard.find(x => x.puuid === args[0]); return d ? d.history : []; }
      case 'ranked-games': { const d = D.dashboard.find(x => x.puuid === args[0]); return d ? d.games : []; }
      default: return { ok: true };
    }
  };
  window.__TAURI__ = {
    core: { invoke: (cmd, { ch, args }) => Promise.resolve(answer(ch, args)) },
    event: { listen: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return Promise.resolve(() => {}); } },
    window: { getCurrentWindow: () => ({ startDragging() {}, toggleMaximize() {} }) },
  };
  // the capture script pushes a new state (login steps screen …)
  window.__demoPush = st => (listeners.state || []).forEach(f => f({ payload: Object.assign(D.state, st) }));
})();
</script>
`;
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('<script src="tauri-api.js"></script>', shim + '<script src="tauri-api.js"></script>');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('demo site:', OUT);
