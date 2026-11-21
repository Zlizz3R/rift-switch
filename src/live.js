// "Live" data: what is going on in the League client right now (lobby, champion select,
// Clash opponents), the champion list, and matchup win rates for the champ select helper.
const https = require('https');
const fs = require('fs');
const path = require('path');
const riot = require('./riot');

const lcu = riot.lcu;

// ---------- players ----------

// Riot ID + Solo/Duo + Flex rank of a player (by puuid or summoner id)
async function player(ref) {
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

async function clash() {
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
  const [lb, cs, cl] = await Promise.all([
    ['Lobby', 'Matchmaking', 'ReadyCheck'].includes(phase) ? lobby() : null,
    phase === 'ChampSelect' ? champSelect() : null,
    clash(),
  ]);
  return { clientUp: true, phase, lobby: lb, champSelect: cs, clash: cl };
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
const slug = n => String(n || '').toLowerCase().replace(/['\s.&]/g, '');
async function matchup(mine, enemy, lane = 'top') {
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
  if (wr == null) {
    const u = await getJson(`https://u.gg/lol/champions/${slug(mine)}/build/${lane}?opp=${slug(enemy)}`, 5000);
    if (u && u.status === 200) {
      const m = /"win_rate":\s*([\d.]+)/.exec(u.text) || /(\d{2}\.\d{1,2})%\s*Win Rate/i.exec(u.text);
      if (m) { const v = parseFloat(m[1]); wr = v <= 1 ? Math.round(v * 1000) / 10 : v; source = 'u.gg'; }
    }
  }
  const res = { wr, source };
  matchupCache.set(key, res);
  return res;
}

module.exports = { snapshot, champions, matchup };
