// "Live" data: what is going on in the League client right now (lobby, champion select,
// Clash opponents), the champion list, and matchup win rates for the champ select helper.
const https = require('https');
const fs = require('fs');
const path = require('path');
const riot = require('./riot');

const lcu = riot.lcu;

// ---------- players ----------

// Riot ID + Solo/Duo + Flex rank of a player (by puuid or summoner id), cached 5 minutes
const playerCache = new Map();
async function player(ref) {
  const key = ref.puuid || 's' + ref.summonerId;
  const c = playerCache.get(key);
  if (c && Date.now() - c.at < 300000) return { ...c.p, position: ref.position || '', championId: ref.championId || 0 };
  const p = await playerFresh(ref);
  if (p) playerCache.set(key, { at: Date.now(), p });
  return p;
}
async function playerFresh(ref) {
  const s = ref.puuid
    ? await lcu('/lol-summoner/v2/summoners/puuid/' + encodeURIComponent(ref.puuid))
    : await lcu('/lol-summoner/v1/summoners/' + encodeURIComponent(ref.summonerId));
  if (!s || !s.puuid) return null;
  const r = await riot.rankedFor(s.puuid);
  return {
    puuid: s.puuid, gameName: s.gameName || s.displayName || '', tagLine: s.tagLine || '',
    iconId: s.profileIconId, level: s.summonerLevel,
    solo: r && r.solo, flex: r && r.flex,
    position: ref.position || '', championId: ref.championId || 0,
  };
}
const players = refs => Promise.all(refs.map(player)).then(list => list.filter(Boolean));

// ---------- lobby / champion select ----------

async function lobby() {
  const lb = await lcu('/lol-lobby/v2/lobby', 3000);
  if (!lb || !Array.isArray(lb.members)) return null;
  return {
    queueId: lb.gameConfig && lb.gameConfig.queueId,
    members: await players(lb.members.map(m => ({ puuid: m.puuid, summonerId: m.summonerId, position: m.firstPositionPreference }))),
  };
}

async function champSelect() {
  const cs = await lcu('/lol-champ-select/v1/session', 3000);
  if (!cs || !Array.isArray(cs.myTeam)) return null;
  const me = cs.myTeam.find(c => c.cellId === cs.localPlayerCellId) || {};
  // allies are named unless the queue hides them; enemies only show their champions
  const allies = await players(cs.myTeam.filter(c => c.puuid || c.summonerId).map(c => ({
    puuid: c.puuid, summonerId: c.summonerId, position: c.assignedPosition, championId: c.championId || c.championPickIntent,
  })));
  const enemies = (cs.theirTeam || []).map(c => ({ championId: c.championId || c.championPickIntent || 0, position: c.assignedPosition || '' }));
  return {
    myPosition: me.assignedPosition || '', myChampion: me.championId || me.championPickIntent || 0,
    allies, enemies, hiddenNames: cs.myTeam.length > allies.length,
  };
}

// ---------- Clash ----------

// the Clash bracket changes rarely: ask at most once a minute
let clashCache = { at: 0, v: null };
async function clash() {
  if (Date.now() - clashCache.at < 60000) return clashCache.v;
  const v = await clashFresh();
  clashCache = { at: Date.now(), v };
  return v;
}
async function clashFresh() {
  const sum = await lcu('/lol-clash/v1/tournament-summary', 3000);
  const t = Array.isArray(sum) && sum[0];
  if (!t || !t.bracketId || !t.rosterId) return null;
  const br = await lcu('/lol-clash/v1/bracket/' + t.bracketId, 4000);
  if (!br || !Array.isArray(br.matches)) return { state: t.state, opponents: [] };
  const mine = br.matches
    .filter(m => String(m.rosterId1) === String(t.rosterId) || String(m.rosterId2) === String(t.rosterId))
    .find(m => m.status !== 'COMPLETE') || null;
  if (!mine) return { state: t.state, opponents: [] };
  const oppId = String(mine.rosterId1) === String(t.rosterId) ? mine.rosterId2 : mine.rosterId1;
  if (!oppId) return { state: t.state, round: mine.round, opponents: [] };
  const ro = await lcu('/lol-clash/v1/roster/' + oppId, 4000);
  const members = (ro && ro.members) || [];
  return {
    state: t.state, round: mine.round, teamName: (ro && ro.name) || '', teamTag: (ro && ro.shortName) || '',
    opponents: await players(members.map(m => ({ summonerId: m.summonerId, position: m.position }))),
  };
}

// everything for the Live view in one go
async function snapshot() {
  const phase = await riot.gameflowPhase();
  if (!phase) return { clientUp: false };
  const reg = await lcu('/riotclient/region-locale', 2000);
  const [lb, cs, cl] = await Promise.all([
    ['Lobby', 'Matchmaking', 'ReadyCheck'].includes(phase) ? lobby() : null,
    phase === 'ChampSelect' ? champSelect() : null,
    clash(),
  ]);
  return { clientUp: true, phase, region: reg ? reg.region : '', lobby: lb, champSelect: cs, clash: cl };
}

// ---------- champion list (CommunityDragon, cached for a day) ----------

const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json';
function getJson(url, timeout = 6000, headers = {}) {
  return new Promise(resolve => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(getJson(res.headers.location, timeout, headers)); }
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
let champCache = null;
async function champions(dataDir) {
  if (champCache) return champCache;
  const file = path.join(dataDir, 'champions.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - c.at < 86400000 && c.list.length) return (champCache = c.list);
  } catch {}
  const r = await getJson(CDRAGON);
  let list = [];
  try {
    const seen = new Set();
    list = JSON.parse(r.text).filter(c => c.id > 0 && c.id < 3000 && !seen.has(c.name) && seen.add(c.name))
      .map(c => ({ id: c.id, name: c.name, alias: c.alias }));
  } catch {}
  if (list.length) {
    list.sort((a, b) => a.name.localeCompare(b.name));
    try { fs.writeFileSync(file, JSON.stringify({ at: Date.now(), list })); } catch {}
    champCache = list;
  }
  return list;
}

// ---------- matchup win rate (same sources as the original Champ Select Helper) ----------
// counterstats.net page "enemy vs-mine": the first plausible percentage is the enemy's
// win rate in that matchup, so ours is 100 minus it. Fallback: u.gg matchup page.
// Both are web pages, not APIs: if they change their layout this returns null.
const matchupCache = new Map();
const SLUG = { 'nunu & willump': 'nunu', 'renata glasc': 'renata', 'wukong': 'wukong' };
const slug = n => SLUG[String(n || '').toLowerCase()] || String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
async function matchup(mine, enemy, lane = 'top') {
  if (!LANES.includes(lane)) lane = 'top';
  const key = mine + '|' + enemy + '|' + lane;
  if (matchupCache.has(key)) return matchupCache.get(key);
  let wr = null, source = null;
  const r = await getJson(`https://www.counterstats.net/league-of-legends/${slug(enemy)}/vs-${slug(mine)}/${lane}/all`, 4000);
  if (r && r.status === 200) {
    for (const m of r.text.matchAll(/(\d{2}\.\d{1,2})%/g)) {
      const v = parseFloat(m[1]);
      if (v >= 35 && v <= 65) { wr = Math.round((100 - v) * 10) / 10; source = 'counterstats.net'; break; }
    }
  }
  // (no u.gg fallback any more: its page only reliably shows the champion's overall win rate)
  const res = { wr, source };
  if (wr != null) matchupCache.set(key, res);   // failures are retried next time
  return res;
}

const GAME_DATA = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const assetUrl = p => (p ? GAME_DATA + String(p).replace(/^\/lol-game-data\/assets\//i, '').toLowerCase() : null);
let assetCache = null;
async function gameAssets(dataDir) {
  if (assetCache) return assetCache;
  const file = path.join(dataDir, 'assets.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - c.at < 86400000 && Object.keys(c.items).length) return (assetCache = c);
  } catch {}
  const get = async f => { const r = await getJson(GAME_DATA + 'v1/' + f, 10000); try { return r && r.status === 200 ? JSON.parse(r.text) : null; } catch { return null; } };
  const [items, spells, perks, styles] = await Promise.all([get('items.json'), get('summoner-spells.json'), get('perks.json'), get('perkstyles.json')]);
  const map = (list, f) => Object.fromEntries((Array.isArray(list) ? list : []).filter(x => x && x.id != null && x.iconPath).map(x => [x.id, f(x)]));
  const out = {
    at: Date.now(),
    items: map(items, x => [assetUrl(x.iconPath), x.name]),
    spells: map(spells, x => [assetUrl(x.iconPath), x.name]),
    perks: map(perks, x => [assetUrl(x.iconPath), x.name]),
    styles: map(styles && styles.styles, x => [assetUrl(x.iconPath), x.name]),
  };
  if (!Object.keys(out.items).length) return { items: {}, spells: {}, perks: {}, styles: {} };   // offline: try again later
  try { fs.writeFileSync(file, JSON.stringify(out)); } catch {}
  return (assetCache = out);
}

module.exports = { snapshot, champions, matchup, gameAssets };
