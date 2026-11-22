// Pure account logic: merging fresh rank data, LP history, ids. No Electron, no files – tested in test/.

const RANK_QUEUES = ['solo', 'flex', 'r5', 'classic'];

// Riot IDs copied from the client can carry invisible direction marks (U+2066…) – remove them
const cleanText = s => String(s == null ? '' : s).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();
// "Name#Tag" -> { gameName, tagLine } or null
function parseRiotId(s) {
  const m = /^(.{2,16})#([^#\s]{2,5})$/.exec(cleanText(s));
  return m ? { gameName: m[1].trim(), tagLine: m[2] } : null;
}

// account ids from the window: a puuid or a "new-<uuid>" placeholder, nothing else
const isId = id => typeof id === 'string' && /^(new-)?[0-9a-f-]{36}$/i.test(id);
// saved-but-never-logged-in accounts live under "new-…" until their real puuid is known
const isPlaceholder = id => typeof id === 'string' && id.startsWith('new-');

function validCred(c) {
  return c && typeof c.u === 'string' && typeof c.p === 'string' && c.u.trim() && c.p ? { u: c.u.trim(), p: c.p } : null;
}
// login name shown on a placeholder tile: "ab•••z"
function maskLogin(u) {
  u = String(u || '');
  if (!u) return '•••';
  return u.length <= 3 ? u[0] + '•••' : u.slice(0, 2) + '•••' + u.slice(-1);
}

// The match history sometimes returns only a few games (e.g. during a game):
// never let a short answer lower a count we already saw.
function bestNormals(prev, n) {
  const hasRanked = !!(n.hasRanked || (prev && prev.hasRanked));   // once seen, stays true
  if (!prev || n.count >= prev.count || n.sample >= prev.sample) return { ...n, hasRanked };
  return { ...prev, hasRanked, at: n.at };
}

// Ranked games seen in match histories, kept per account (newest first, max 300).
// The client only shows a few recent games at a time, so the list grows over time.
function mergeRankedGames(a, games) {
  if (!a || !Array.isArray(games) || !games.length) return;
  const byId = new Map((a.rankedGames || []).map(g => [g.id, g]));
  for (const g of games) byId.set(g.id, g);
  a.rankedGames = [...byId.values()].sort((x, y) => y.t - x.t).slice(0, 300);
}

// unknown win/loss (other account) -> keep the last real numbers from its own login
function keepWL(q, prevQ) {
  if (!q || q.wl !== false || !prevQ || prevQ.wl !== true) return q;
  return { ...q, wins: prevQ.wins, losses: prevQ.losses, wl: true, wlStale: true };
}

// LP history: one entry whenever Solo/Duo or Flex changes (max 300)
const rankKey = q => (q ? q.tier + '|' + q.division + '|' + q.lp : '-');
function recordHistory(a, now = Date.now()) {
  if (!a.solo && !a.flex) return;
  const pick = q => (q ? { tier: q.tier, division: q.division, lp: q.lp } : null);
  const e = { t: now, solo: pick(a.solo), flex: pick(a.flex) };
  const h = a.history || (a.history = []);
  const last = h[h.length - 1];
  if (last && rankKey(last.solo) === rankKey(e.solo) && rankKey(last.flex) === rankKey(e.flex)) return;
  h.push(e);
  if (h.length > 300) h.splice(0, h.length - 300);
}

// fresh data for one account merged into the list; returns the merged account
function upsertInto(list, acc, now = Date.now()) {
  const i = list.findIndex(a => a.puuid === acc.puuid);
  const prev = i >= 0 ? list[i] : { note: '', addedAt: now };
  for (const k of RANK_QUEUES) if (acc[k]) acc[k] = keepWL(acc[k], prev[k]);
  const merged = { ...prev, ...acc };
  delete merged.updatedAt;
  // keep old rank data if a refresh came back empty
  for (const k of RANK_QUEUES) if (acc[k] === undefined) merged[k] = prev[k];
  recordHistory(merged, now);
  if (i >= 0) list[i] = merged; else list.push(merged);
  return merged;
}

module.exports = { cleanText, parseRiotId, RANK_QUEUES, isId, isPlaceholder, validCred, maskLogin, bestNormals, mergeRankedGames, keepWL, rankKey, recordHistory, upsertInto };
