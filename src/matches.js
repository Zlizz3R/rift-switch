// Match history across all saved accounts, like a small op.gg: every recent game with all ten
// players and the rough numbers (KDA, CS, damage, gold, items). Read from the local League
// client while it runs and kept in matches.json, so the page also works with League closed.
const fs = require('fs');
const path = require('path');

const KEEP_PER_ACCOUNT = 200;    // newest games remembered per account
const KEEP_GAMES = 1500;         // details kept at most (~2 KB each)
let file = null, db = { games: {}, by: {} }, dirty = false, saveTimer = null;

function load(dataDir) {
  file = path.join(dataDir, 'matches.json');
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d && d.games && d.by) db = d;
  } catch {}
}
function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty || !file) return;
    dirty = false;
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); } catch {}
  }, 2000);
}

// list = [{ id, t, q }] from an account's match list (newest first)
function note(puuid, list) {
  if (!puuid || !Array.isArray(list)) return;
  const ids = new Set([...list.map(g => String(g.id)), ...(db.by[puuid] || [])]);
  const all = [...ids].sort((a, b) => Number(b) - Number(a)).slice(0, KEEP_PER_ACCOUNT);
  if (JSON.stringify(all) !== JSON.stringify(db.by[puuid] || [])) { db.by[puuid] = all; save(); }
}

function missing() {
  const out = new Set();
  for (const ids of Object.values(db.by)) for (const id of ids) if (!db.games[id]) out.add(id);
  return [...out].sort((a, b) => Number(b) - Number(a));
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// the client's game detail -> what the page needs (about 2 KB per game)
function compact(g) {
  if (!g || !Array.isArray(g.participants) || !Array.isArray(g.participantIdentities)) return null;
  const who = new Map(g.participantIdentities.map(x => [x.participantId, x.player || {}]));
  const players = g.participants.map(p => {
    const s = p.stats || {}, id = who.get(p.participantId) || {};
    return {
      puuid: id.puuid || '', name: id.gameName || id.summonerName || '', tag: id.tagLine || '',
      team: p.teamId, champ: p.championId, lvl: num(s.champLevel),
      k: num(s.kills), d: num(s.deaths), a: num(s.assists),
      cs: num(s.totalMinionsKilled) + num(s.neutralMinionsKilled),
      gold: num(s.goldEarned), dmg: num(s.totalDamageDealtToChampions), vis: num(s.visionScore),
      items: [0, 1, 2, 3, 4, 5, 6].map(i => num(s['item' + i])),
      spells: [num(p.spell1Id), num(p.spell2Id)], keystone: num(s.perk0), sub: num(s.perkSubStyle),
      win: !!s.win, multi: num(s.largestMultiKill),
    };
  });
  if (players.length < 2) return null;
  return { id: String(g.gameId), t: num(g.gameCreation), dur: num(g.gameDuration), q: num(g.queueId), mode: g.gameMode || '',
    remake: num(g.gameDuration) < 300, players };
}

// fetch up to `max` missing game details through lcu(path) -> json|null
async function fill(lcu, max = 6) {
  let got = 0;
  for (const id of missing().slice(0, max)) {
    const g = compact(await lcu('/lol-match-history/v1/games/' + encodeURIComponent(id), 6000));
    if (!g) continue;
    db.games[id] = g; got++;
  }
  if (got) { prune(); save(); }
  return got;
}

function prune() {
  const used = new Set(Object.values(db.by).flat());
  for (const id of Object.keys(db.games)) if (!used.has(id)) delete db.games[id];
  const ids = Object.keys(db.games).sort((a, b) => Number(b) - Number(a));
  for (const id of ids.slice(KEEP_GAMES)) delete db.games[id];
}

// forget an account that was removed from the app
function forget(puuid) { if (db.by[puuid]) { delete db.by[puuid]; prune(); save(); } }

// newest first; a game played together by two own accounts shows once, with both as owners
function list(accountIds, filter = {}) {
  const mine = new Set(accountIds);
  const rows = new Map();
  for (const [puuid, ids] of Object.entries(db.by)) {
    if (!mine.has(puuid) || (filter.puuid && filter.puuid !== puuid)) continue;
    for (const id of ids) {
      const g = db.games[id];
      if (!g) continue;
      if (filter.queue && !queueMatch(g.q, filter.queue)) continue;
      const r = rows.get(id) || { ...g, owners: [] };
      r.owners.push(puuid);
      rows.set(id, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.t - a.t).slice(0, filter.limit || 60);
  // (all accounts mixed, newest first: one timeline)
}
const QUEUE_GROUPS = { solo: [420], flex: [440], normal: [400, 430, 490, 480], aram: [450, 2400], arena: [1700, 1710] };
function queueMatch(q, group) { return (QUEUE_GROUPS[group] || []).includes(q); }

const known = puuid => (db.by[puuid] || []).length;

// Current Solo/Duo + Flex of players seen in games, kept 12 hours ({ s, f, at }; s/f = [tier, division, lp] or null).
// Riot only tells the rank now, not the one at the time of the game.
const RANK_TTL = 12 * 3600000;
const packRank = q => (q ? [q.tier, q.division || '', q.lp || 0] : null);
function ranksFor(puuids, now = Date.now()) {
  const r = db.ranks || {};
  return Object.fromEntries(puuids.filter(p => r[p]).map(p => [p, r[p]]));
}
function staleRanks(puuids, now = Date.now()) {
  const r = db.ranks || {};
  return [...new Set(puuids)].filter(p => p && (!r[p] || now - r[p].at > RANK_TTL));
}
// rankedFor(puuid) -> { solo, flex } | null; asks at most `max` players, 4 at a time
async function fetchRanks(puuids, rankedFor, max = 30) {
  const todo = staleRanks(puuids).slice(0, max);
  db.ranks = db.ranks || {};
  for (let i = 0; i < todo.length; i += 4) {
    const part = todo.slice(i, i + 4);
    const res = await Promise.all(part.map(p => rankedFor(p).catch(() => null)));
    part.forEach((p, k) => { if (res[k]) db.ranks[p] = { s: packRank(res[k].solo), f: packRank(res[k].flex), at: Date.now() }; });
  }
  // keep the cache small: players not in any kept game go
  const inGames = new Set(Object.values(db.games).flatMap(g => g.players.map(x => x.puuid)));
  for (const p of Object.keys(db.ranks)) if (!inGames.has(p)) delete db.ranks[p];
  if (todo.length) save();
  return todo.length;
}
module.exports = { ranksFor, staleRanks, fetchRanks, load, note, fill, list, forget, compact, missing, known, QUEUE_GROUPS, _db: () => db };
