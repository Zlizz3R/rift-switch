// Everything that touches the Riot Client / League Client on this PC.
// No passwords are ever stored: an account is a snapshot of the Riot Client's
// "stay signed in" session (the files in %LOCALAPPDATA%\Riot Games\Riot Client\Data).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile, spawn } = require('child_process');

const LOCAL = process.env.LOCALAPPDATA;
const RC_DATA = path.join(LOCAL, 'Riot Games', 'Riot Client', 'Data');
const INSTALLS = 'C:\\ProgramData\\Riot Games\\RiotClientInstalls.json';

const PROCESSES = [
  'League of Legends.exe', 'LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe',
  'LeagueCrashHandler64.exe', 'RiotClientServices.exe', 'Riot Client.exe', 'RiotClientUx.exe',
  'RiotClientUxRender.exe', 'RiotClientCrashHandler.exe',
];

// one HTTPS connection per client is kept open and reused (no new TLS handshake per request)
const agent = new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false });

// the install list rarely changes: read it at most once a minute
let installsCache = null, installsAt = 0;
function installs() {
  if (installsCache && Date.now() - installsAt < 60000) return installsCache;
  try { installsCache = JSON.parse(fs.readFileSync(INSTALLS, 'utf8')); } catch { installsCache = {}; }
  installsAt = Date.now();
  return installsCache;
}

function riotClientExe() {
  const j = installs();
  const exe = j.rc_live || j.rc_default || 'C:/Riot Games/Riot Client/RiotClientServices.exe';
  return exe.replace(/\//g, '\\');
}

// League install folders: live and (if installed) PBE
function leagueDirs() {
  const keys = Object.keys(installs().associated_client || {});
  const find = re => keys.find(d => re.test(d));
  const win = d => d && d.replace(/\//g, '\\');
  return {
    live: win(find(/League of Legends\/?$/i) || 'C:/Riot Games/League of Legends/'),
    pbe: win(find(/League of Legends \(PBE\)\/?$/i)),
  };
}
const leagueDir = () => leagueDirs().live;

// ---------- League Client API (LCU) ----------

function readLock(file) {
  try {
    const [, , port, password] = fs.readFileSync(file, 'utf8').split(':');
    return port && password ? { port, password } : null;
  } catch { return null; }
}
// The running League client: live or PBE (both can't run at once). A lockfile can be left
// behind by a crash, so the newer one wins; patchline() says which one it was.
let currentPatchline = 'live';
function lockfile() {
  const d = leagueDirs();
  let best = null;
  for (const pl of ['live', 'pbe']) {
    if (!d[pl]) continue;
    const f = path.join(d[pl], 'lockfile');
    let t = 0;
    try { t = fs.statSync(f).mtimeMs; } catch { continue; }
    const lf = readLock(f);
    if (lf && (!best || t > best.t)) best = { ...lf, t, pl };
  }
  if (!best) return null;
  currentPatchline = best.pl;
  return { port: best.port, password: best.password };
}
const patchline = () => currentPatchline;

// one request to a local Riot API; always resolves (null on any error or non-2xx)
function apiRequest(lf, p, timeout, method, raw) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const req = https.request({
      method, host: '127.0.0.1', port: lf.port, path: p, agent, timeout,
      headers: { Authorization: 'Basic ' + Buffer.from('riot:' + lf.password).toString('base64') },
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('error', () => finish(raw ? { up: true, status: 0, body: null } : null));
      res.on('aborted', () => finish(raw ? { up: true, status: 0, body: null } : null));
      res.on('end', () => {
        let j = null;
        try { j = d ? JSON.parse(d) : null; } catch {}
        if (raw) return finish({ up: true, status: res.statusCode, body: j });
        if (res.statusCode < 200 || res.statusCode > 299) return finish(null);
        finish(d ? (j === null ? true : j) : true);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => finish(raw ? { up: false } : null));
    req.end();
  });
}

function lcu(p, timeout = 4000, method = 'GET') {
  const lf = lockfile();
  return lf ? apiRequest(lf, p, timeout, method, false) : Promise.resolve(null);
}

// own: data of the signed-in account. For other accounts the client only
// reports wins (losses come back as 0), so win/loss is marked unknown there.
const KNOWN_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
function pickQueue(stats, q, own) {
  const x = stats && stats.queueMap && stats.queueMap[q];
  if (!x || !x.tier || x.tier === 'NONE' || x.tier === 'NA' || x.tier === '') return null;
  // tiers Riot uses as a placeholder before placements (e.g. 'SALT' in Classic 5v5) count as unranked
  if (!KNOWN_TIERS.includes(x.tier) && !((x.wins || 0) + (x.losses || 0))) return null;
  const wl = own || !(x.losses === 0 && x.wins > 0);
  return { tier: x.tier, division: x.division, lp: x.leaguePoints, wins: x.wins, losses: x.losses, wl };
}

// Riot's own decay counter – only reported for the signed-in account, per queue
// (Solo/Duo and Flex, Diamond and up). The client shows it even when the warning flag is off.
function decayOf(stats) {
  const qs = {};
  for (const [k, key] of [['solo', 'RANKED_SOLO_5x5'], ['flex', 'RANKED_FLEX_SR']]) {
    const w = stats && stats.queueMap && stats.queueMap[key] && stats.queueMap[key].warnings;
    const d = w ? Number(w.daysUntilDecay) : NaN;
    if (Number.isFinite(d) && d >= 0) qs[k] = d;
  }
  return Object.keys(qs).length ? { q: qs, at: Date.now() } : null;
}

// One match-history request for everything the app needs about recent games:
// last played, ranked games (for the LP estimate) and the normal-games count.
async function historySummary(puuid) {
  const mh = await lcu('/lol-match-history/v1/products/lol/' + encodeURIComponent(puuid) + '/matches?begIndex=0&endIndex=50', 6000);
  return summarizeGames(mh && mh.games && mh.games.games);
}
// one page of an account's match list (older games: higher begIndex) -> [{ id, t, q }] or null
async function matchList(puuid, beg, end) {
  const mh = await lcu('/lol-match-history/v1/products/lol/' + encodeURIComponent(puuid) + '/matches?begIndex=' + beg + '&endIndex=' + end, 8000);
  const games = mh && mh.games && mh.games.games;
  return Array.isArray(games) ? games.map(g => ({ id: g.gameId, t: g.gameCreation, q: g.queueId })) : null;
}

// the match list -> last played, ranked games, normal-games count (pure, tested)
function summarizeGames(games, now = Date.now()) {
  if (!Array.isArray(games)) return null;
  const ranked = games.filter(g => g.queueId === 420 || g.queueId === 440).map(g => {
    const p = g.participants && g.participants[0];
    return { id: g.gameId, t: g.gameCreation, q: g.queueId === 420 ? 'solo' : 'flex', win: !!(p && p.stats && p.stats.win), champ: p && p.championId };
  });
  return {
    lastPlayed: games.length ? Math.max(...games.map(g => g.gameCreation || 0)) : null,
    list: games.map(g => ({ id: g.gameId, t: g.gameCreation, q: g.queueId })),
    ranked,
    normals: {
      count: games.filter(g => NORMAL_SR_QUEUES.includes(g.queueId)).length,
      hasRanked: games.some(g => RANKED_QUEUE_IDS.includes(g.queueId)),
      sample: games.length, at: now,
    },
  };
}


async function rankedFor(puuid, own = false) {
  const s = await lcu('/lol-ranked/v1/ranked-stats/' + encodeURIComponent(puuid));
  if (!s) return null;
  return {
    ...(own ? { decay: decayOf(s) } : {}),
    solo: pickQueue(s, 'RANKED_SOLO_5x5', own), flex: pickQueue(s, 'RANKED_FLEX_SR', own),
    r5: pickQueue(s, 'RANKED_PREMADE_5x5', own),          // "Ranked 5s" (ranked 5v5)
    classic: pickQueue(s, 'JADE_RANKED_SOLO_5x5', own),   // "Classic 5v5"
  };
}

async function currentAccount() {
  const me = await lcu('/lol-summoner/v1/current-summoner');
  if (!me || !me.puuid) return null;
  const region = await lcu('/riotclient/region-locale');
  const ranked = await rankedFor(me.puuid, true);
  return {
    puuid: me.puuid,
    summonerId: me.summonerId,
    gameName: me.gameName || me.displayName,
    tagLine: me.tagLine || '',
    iconId: me.profileIconId,
    level: me.summonerLevel,
    region: region ? region.region : '',
    ...(ranked || {}),
  };
}

async function summonerByPuuid(puuid) {
  return lcu('/lol-summoner/v2/summoners/puuid/' + encodeURIComponent(puuid));
}

// Name#Tag -> account data, without logging in (needs League open on any account of the same region)
async function lookupRiotId(gameName, tagLine) {
  const q = `?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`;
  const hit = await lcu('/lol-summoner/v1/alias/lookup' + q);
  if (!hit || !hit.puuid) return null;
  const s = await summonerByPuuid(hit.puuid);
  const r = await rankedFor(hit.puuid);
  const region = await lcu('/riotclient/region-locale');
  return {
    puuid: hit.puuid,
    gameName: (s && s.gameName) || gameName, tagLine: (s && s.tagLine) || tagLine,
    ...(s ? { iconId: s.profileIconId, level: s.summonerLevel } : {}),
    region: region ? region.region : '',
    ...(r || {}),
  };
}


// everything only the signed-in account can see about itself
async function profileData(me) {
  const [wallet, honor, mastery, score, champs, skins] = await Promise.all([
    lcu('/lol-inventory/v1/wallet?currencyTypes=%5B%22RP%22,%22lol_blue_essence%22%5D'),
    lcu('/lol-honor-v2/v1/profile'),
    lcu('/lol-champion-mastery/v1/local-player/champion-mastery', 6000),
    lcu('/lol-champion-mastery/v1/local-player/champion-mastery-score'),
    lcu('/lol-champions/v1/inventories/' + me.summonerId + '/champions-minimal', 6000),
    lcu('/lol-champions/v1/inventories/' + me.summonerId + '/skins-minimal', 6000),
  ]);
  const p = { at: Date.now() };
  if (wallet) { p.be = wallet.lol_blue_essence; p.rp = wallet.RP; }
  if (honor) p.honor = honor.honorLevel;
  if (typeof score === 'number') p.masteryScore = score;
  if (Array.isArray(mastery)) {
    p.masteryChamps = mastery.length;
    p.topMastery = [...mastery].sort((a, b) => b.championPoints - a.championPoints).slice(0, 3)
      .map(m => ({ id: m.championId, level: m.championLevel, points: m.championPoints }));
  }
  if (Array.isArray(champs)) {
    p.champs = champs.filter(c => c.id > 0 && c.ownership && c.ownership.owned).length;
    p.champsTotal = champs.filter(c => c.id > 0).length;
  }
  if (Array.isArray(skins)) p.skins = skins.filter(x => !x.isBase && x.ownership && x.ownership.owned).length;
  return p;
}

// Riot's own answer whether the signed-in account may queue Solo/Duo (420) and Flex (440)
async function rankedEligibility() {
  const list = await lcu('/lol-lobby/v2/eligibility/self', 5000, 'POST');
  if (!Array.isArray(list)) return null;
  const one = id => {
    const q = list.find(x => x.queueId === id);
    if (!q) return null;
    // "Team…" reasons (party too big, rank spread, …) are about the current lobby,
    // not the account – they must not mark the account as not ranked-ready
    const reasons = (q.restrictions || []).filter(r => !/^Team/.test(r.restrictionCode || '')).map(r => ({
      code: r.restrictionCode, args: r.restrictionArgs || {}, until: r.expiredTimestamp || 0 }));
    return { ok: !!q.eligible || reasons.length === 0, reasons };
  };
  return { at: Date.now(), solo: one(420), flex: one(440), r5: one(710), classic: one(4310) };
}

// queue pop: accept if we haven't answered yet
async function acceptReadyCheck() {
  const rc = await lcu('/lol-matchmaking/v1/ready-check', 2000);
  if (!rc || rc.state !== 'InProgress' || rc.playerResponse !== 'None') return false;
  return !!(await lcu('/lol-matchmaking/v1/ready-check/accept', 3000, 'POST'));
}

// Leave lobby / queue before switching: otherwise the old lobby often "sticks"
// and the new account appears to still be in it.
async function leaveLobby() {
  const phase = await gameflowPhase();
  if (!['Lobby', 'Matchmaking', 'ReadyCheck'].includes(phase)) return false;
  if (phase !== 'Lobby') await lcu('/lol-lobby/v2/lobby/matchmaking/search', 3000, 'DELETE');
  await lcu('/lol-lobby/v2/lobby', 3000, 'DELETE');
  return true;
}

// Riot: new accounts must play 10 normal PvP games on Summoner's Rift before ranked.
// Counted from the recent match history (enough for accounts that are still below 10).
const NORMAL_SR_QUEUES = [400, 430, 480, 490];   // Draft, Blind, Swiftplay, Quickplay
const RANKED_QUEUE_IDS = [420, 440, 710, 4310];   // Solo/Duo, Flex, Ranked 5s, Classic 5v5

async function gameflowPhase() {
  return lcu('/lol-gameflow/v1/gameflow-phase', 2000);
}

// ---------- session files ----------

function readDir(dir, base = dir, out = {}) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) readDir(full, base, out);
    else out[path.relative(base, full)] = fs.readFileSync(full).toString('base64');
  }
  return out;
}

function captureSession() {
  const files = readDir(RC_DATA);
  if (!Object.keys(files).length) return null;
  return JSON.stringify({ v: 1, files });
}

// Does a captured session hold a remembered ("Stay signed in") login?
// Without it the Riot Client keeps only "persist: null" and restoring it lands on the login screen.
function sessionPersisted(json) {
  try {
    const y = Buffer.from(JSON.parse(json).files['RiotGamesPrivateSettings.yaml'] || '', 'base64').toString();
    const m = /riot-login:\s*\r?\n\s+persist:\s*(\S*)/.exec(y);
    return !!m && m[1] !== 'null' && m[1] !== '';
  } catch { return false; }
}

function clearSession() {
  if (fs.existsSync(RC_DATA)) fs.rmSync(RC_DATA, { recursive: true, force: true });
  fs.mkdirSync(RC_DATA, { recursive: true });
}

function restoreSession(json) {
  const { files } = JSON.parse(json);
  clearSession();
  for (const [rel, b64] of Object.entries(files)) {
    const full = path.join(RC_DATA, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(b64, 'base64'));
  }
}

// ---------- processes ----------

function runningRiotProcesses() {
  return new Promise(resolve => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      if (err) return resolve([]);
      const names = new Set(PROCESSES.map(p => p.toLowerCase()));
      resolve(out.split(/\r?\n/).map(l => (l.split('","')[0] || '').replace(/^"/, ''))
        .filter(n => names.has(n.toLowerCase())));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function closeClients() {
  for (let i = 0; i < 20; i++) {
    const running = await runningRiotProcesses();
    if (!running.length) return true;
    const args = ['/F', '/T'];
    for (const n of new Set(running)) args.push('/IM', n);
    await new Promise(r => execFile('taskkill', args, { windowsHide: true }, () => r()));
    await sleep(500);
  }
  return false;
}

// platform id of the Riot Client's signed-in account ("EUW1", "PBE1" …) -> short region
const platformRegion = p => (p ? String(p).replace(/\d+$/, '').toUpperCase() : '');
// The account signed in to the Riot Client: puuid, Riot ID and League platform (PBE1 = PBE account).
async function rcAccount() {
  const lf = readLock(path.join(LOCAL, 'Riot Games', 'Riot Client', 'Config', 'lockfile'));
  if (!lf) return null;
  const u = await apiRequest(lf, '/riot-client-auth/v1/userinfo', 3000, 'GET', false);
  if (!u || !u.lol) return null;
  return { gameName: (u.acct && u.acct.game_name) || '', tagLine: (u.acct && u.acct.tag_line) || '',
    platform: u.lol.cpid || u.lol.pid || '', region: platformRegion(u.lol.cpid || u.lol.pid) };
}

// patchline 'live' or 'pbe'; with the Riot Client already open this hands the launch to it
// (the same as a desktop shortcut or picking the version next to Play)
// closes the Riot Client's "can't play with your PBE account" dialog (src/rcmodal.ps1)
function dismissPbeDialog() {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'rcmodal.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)],
    { windowsHide: true, timeout: 15000 }, (_e, out) => resolve(String(out || '').trim().split(/\r?\n/).pop() || 'error'));
  });
}

// ends only League (LeagueClient*), the Riot Client and its sign-in stay
async function closeLeagueOnly() {
  await new Promise(res => execFile('taskkill', ['/F', '/T', '/IM', 'LeagueClient.exe', '/IM', 'LeagueClientUx.exe'], { windowsHide: true }, () => res()));
  await sleep(1500);
}
function launchLeague(pl = 'live') {
  const args = ['--launch-product=league_of_legends', '--launch-patchline=' + (pl === 'pbe' ? 'pbe' : 'live')];
  const child = spawn(riotClientExe(), args,
    { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

// ---------- Riot Client API (login state) ----------

function rcApi(p, method = 'GET') {
  const lf = readLock(path.join(LOCAL, 'Riot Games', 'Riot Client', 'Config', 'lockfile'));
  return lf ? apiRequest(lf, p, 3000, method, true) : Promise.resolve({ up: false });
}

// the "Play" button of the Riot Client
async function pressPlay(pl = 'live') {
  const r = await rcApi('/product-launcher/v1/products/league_of_legends/patchlines/' + (pl === 'pbe' ? 'pbe' : 'live'), 'POST');
  return r.up && r.status >= 200 && r.status < 300;
}

async function leagueRunning() {
  const p = await runningRiotProcesses();
  return p.some(n => /^LeagueClient(Ux)?\.exe$/i.test(n));
}

// { up: Riot Client API reachable, subject: puuid of the signed-in account or null }
async function rcLoginState() {
  const r = await rcApi('/rso-auth/v1/authorization');
  return { up: r.up, subject: r.status === 200 && r.body ? r.body.subject : null };
}

// Types username + password into the Riot Client login window.
// since: only type into a Riot Client started after this moment (ms) – set after a restart
function autofill(username, password, since) {
  return new Promise(resolve => {
    const ps = spawn('powershell.exe',
      // in the installed app the script is unpacked next to the archive (PowerShell can't read inside app.asar)
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'autofill.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)],
      { windowsHide: true });
    let out = '';
    ps.stdout.on('data', d => (out += d));
    ps.on('close', () => resolve(out.trim().split(/\r?\n/).pop() || 'error'));
    ps.on('error', () => resolve('error'));
    ps.stdin.end(JSON.stringify({ u: username, p: password, since: since || null }));
  });
}

module.exports = {
  pickQueue, decayOf, summarizeGames, matchList,
  lcu, historySummary,
  currentAccount, rankedFor, summonerByPuuid, gameflowPhase, lookupRiotId,
  profileData, acceptReadyCheck, rankedEligibility,
  captureSession, restoreSession, clearSession, sessionPersisted, closeClients, launchLeague, lockfile,
  rcLoginState, autofill, pressPlay, leagueRunning, leaveLobby, patchline, rcAccount, platformRegion, closeLeagueOnly, dismissPbeDialog,
};
