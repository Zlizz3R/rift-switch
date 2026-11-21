const { app, BrowserWindow, ipcMain, safeStorage, shell, Tray, Menu, nativeImage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const riot = require('./riot');
const i18n = require('./i18n');

// Data always lives in %APPDATA%\rift-switch – also for the installed app, whose product
// name "Rift Switch" would otherwise give it a new, empty folder.
// dev: RS_DATA=<folder> runs a test copy on its own data, apart from the real one
app.setPath('userData', process.env.RS_DATA || path.join(app.getPath('appData'), 'rift-switch'));

// Only one copy may work on the data folder; a second start just shows the open window.
if (!process.env.RS_SHOT && !app.requestSingleInstanceLock()) { app.exit(0); }

// The UI is flat tiles and a few shadows: software rendering is plenty and saves the
// whole GPU process (~95 MB measured). Important for leaving the app running on a laptop.
app.disableHardwareAcceleration();
// Run Chromium's GPU and network helpers inside the main process instead of two extra
// processes. Measured: tray 57 -> 37 MB (one process), window open 107 -> 81 MB.
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
const DATA = app.getPath('userData');
const STORE = path.join(DATA, 'accounts.json');
const SESSIONS = path.join(DATA, 'sessions');
const CREDS = path.join(DATA, 'creds');

let win = null;
const DEFAULT_SETTINGS = { autostart: false, closeToTray: true, autoAccept: false, autoPlay: true, confirmSwitch: true,
  sort: 'level', lang: 'en', tile: null, streamer: false, streamerHide: null };
const tr = (key, vars) => i18n.t(state.settings.lang || 'en', key, vars);
let state = { accounts: [], categories: [], active: null, settings: { ...DEFAULT_SETTINGS } };
let tray = null;
let quitting = false;
let live = { puuid: null, phase: null, clientUp: false };
let pendingAdd = false;
let pendingCred = null;   // login typed in the "add" form, kept until League tells us whose account it is
let login = null;         // auto-login progress shown in the overlay
let loginToken = 0;
let busy = false;
let expecting = null;     // account we just switched to (to recognise the first login of a saved account)

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- store ----------

function load() {
  // accounts.json.bak: left by a one-time repair; read it if the real file is missing
  const src = fs.existsSync(STORE) ? STORE : (fs.existsSync(STORE + '.bak') ? STORE + '.bak' : null);
  if (src) {
    try { state = { accounts: [], categories: [], active: null, ...JSON.parse(fs.readFileSync(src, 'utf8')) }; }
    catch (e) {
      // never silently overwrite a damaged file: keep a copy first
      try { fs.copyFileSync(src, path.join(DATA, `accounts.damaged-${Date.now()}.json`)); } catch {}
      logError('load', e);
    }
  }
  if (!Array.isArray(state.categories)) state.categories = [];
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  // one-time: sorting by level became the default (existing saves had "custom")
  if (!state.settings.sortLevelDefault) { state.settings.sort = 'level'; state.settings.sortLevelDefault = true; }
}
let saveError = null;
function logError(where, e) {
  const line = `${new Date().toISOString()} ${where}: ${e && (e.stack || e.message || e)}\n`;
  try { fs.appendFileSync(path.join(DATA, 'error.log'), line); }
  catch { try { fs.appendFileSync(path.join(DATA, `error-${process.pid}.log`), line); } catch {} }
}
// Writes accounts.json only when something really changed (compact JSON),
// and refreshes tray + window only then.
let lastSaved = null;
function save() {
  try {
    const text = JSON.stringify(state);
    if (text !== lastSaved) {
      fs.mkdirSync(DATA, { recursive: true });
      const tmp = STORE + '.tmp';
      fs.writeFileSync(tmp, text);
      try { fs.renameSync(tmp, STORE); }
      catch (e) { fs.writeFileSync(STORE, text); try { fs.unlinkSync(tmp); } catch {} }
      lastSaved = text;
      updateTray();
    }
    saveError = null;
  } catch (e) {
    if (saveError !== (e.code || e.message)) logError('save', e);
    saveError = e.code || e.message || String(e);
  }
  push();
}

// Tiles whose list entry got lost (e.g. a failed save) are rebuilt from the
// encrypted login/session files that still exist.
async function recoverOrphans() {
  const ids = new Set();
  for (const dir of [CREDS, SESSIONS]) {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.bin')) ids.add(f.slice(0, -4)); } catch {}
  }
  let changed = false;
  for (const id of ids) {
    if (state.accounts.some(a => a.puuid === id)) continue;
    const acc = { puuid: id, note: '', addedAt: Date.now(), gameName: '…', tagLine: '', needsInfo: true };
    if (isPlaceholder(id)) {
      const c = await loadCred(id);
      Object.assign(acc, { placeholder: true, gameName: c ? maskLogin(c.u) : 'Gespeicherter Login' });   // renderer translates this marker
      delete acc.needsInfo;
    }
    state.accounts.push(acc);
    changed = true;
  }
  if (changed) save();
}

function snapshot() {
  // LP history can be long: the profile window asks for it when it opens
  const accounts = state.accounts.map(({ history, ...a }) => ({ ...a, historyLen: history ? history.length : 0 }));
  return { ...state, accounts, live, pendingAdd, busy, login, saveError, cryptoBroken };
}
let lastPushed = null, pushPending = false;
function push() {
  // nothing to draw while the window is closed/hidden: send once it's shown again
  if (!win || win.isDestroyed() || (!win.isVisible() && !process.env.RS_SHOT)) { pushPending = true; return; }
  const s = snapshot();
  const key = JSON.stringify(s);
  if (key === lastPushed) return;
  lastPushed = key;
  pushPending = false;
  win.webContents.send('state', s);
}
function setLogin(l) { login = l; push(); }

// Sessions and logins are encrypted with Windows DPAPI (via safeStorage):
// only this Windows user on this PC can decrypt them.
const sessionFile = puuid => path.join(SESSIONS, puuid + '.bin');
const credFile = puuid => path.join(CREDS, puuid + '.bin');

async function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await safeStorage.encryptStringAsync(text));
}
async function readSecret(file) {
  try { return (await safeStorage.decryptStringAsync(fs.readFileSync(file))).result; } catch { return null; }
}

// Canary: a tiny encrypted file. If it can't be decrypted on a later start, Windows gave
// this start a different key and all saved logins/sessions are unreadable -> warn loudly.
let cryptoBroken = false;
async function checkCrypto() {
  const f = path.join(DATA, 'keycheck.bin');
  if (fs.existsSync(f)) {
    cryptoBroken = (await readSecret(f)) !== 'rift-switch';
    if (cryptoBroken) logError('crypto', 'saved data was encrypted with a key this start cannot read');
  }
  if (!fs.existsSync(f) || cryptoBroken) { try { await writeSecret(f, 'rift-switch'); } catch (e) { logError('crypto', e); } }
}

// Saves the Riot Client's session for this account - but only a usable one:
// it must hold a remembered login, and (if the client is running) be signed in as this
// very account. Otherwise an empty/foreign session would overwrite a good one.
async function storeSession(puuid, { verified = false } = {}) {
  const json = riot.captureSession();
  if (!json || !riot.sessionPersisted(json)) return false;
  if (!verified) {
    const st = await riot.rcLoginState();
    if (!st.up || st.subject !== puuid) return false;
  }
  await writeSecret(sessionFile(puuid), json);
  return true;
}
const loadSession = puuid => readSecret(sessionFile(puuid));

async function storeCred(puuid, cred) {
  await writeSecret(credFile(puuid), JSON.stringify({ u: cred.u, p: cred.p }));
  const a = state.accounts.find(x => x.puuid === puuid);
  if (a) { a.hasCred = true; a.credBroken = false; }
}
async function loadCred(puuid) {
  const t = await readSecret(credFile(puuid));
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

// a login file that exists but can't be decrypted (e.g. written under another Windows context)
async function checkCreds() {
  for (const a of state.accounts) {
    a.hasCred = fs.existsSync(credFile(a.puuid));
    a.credBroken = a.hasCred && !(await loadCred(a.puuid));
    if (a.credBroken) logError('cred', 'cannot decrypt login for ' + a.puuid);
  }
}

const RANK_QUEUES = ['solo', 'flex', 'r5', 'classic'];

// The match history sometimes returns only a few games (e.g. during a game):
// never let a short answer lower a count we already saw.
function bestNormals(prev, n) {
  const hasRanked = !!(n.hasRanked || (prev && prev.hasRanked));   // once seen, stays true
  if (!prev || n.count >= prev.count || n.sample >= prev.sample) return { ...n, hasRanked };
  return { ...prev, hasRanked, at: n.at };
}

// unknown win/loss (other account) -> keep the last real numbers from its own login
function keepWL(q, prevQ) {
  if (!q || q.wl !== false || !prevQ || prevQ.wl !== true) return q;
  return { ...q, wins: prevQ.wins, losses: prevQ.losses, wl: true, wlStale: true };
}

function upsert(acc) {
  const i = state.accounts.findIndex(a => a.puuid === acc.puuid);
  const prev = i >= 0 ? state.accounts[i] : { note: '', addedAt: Date.now() };
  for (const k of RANK_QUEUES) if (acc[k]) acc[k] = keepWL(acc[k], prev[k]);
  const merged = { ...prev, ...acc };
  delete merged.updatedAt;
  // keep old rank data if a refresh came back empty
  for (const k of RANK_QUEUES) if (acc[k] === undefined) merged[k] = prev[k];
  recordHistory(merged);
  if (i >= 0) state.accounts[i] = merged; else state.accounts.push(merged);
  return merged;
}

// LP history: one entry whenever Solo/Duo or Flex changes
const rankKey = q => (q ? q.tier + '|' + q.division + '|' + q.lp : '-');
function recordHistory(a) {
  if (!a.solo && !a.flex) return;
  const pick = q => (q ? { tier: q.tier, division: q.division, lp: q.lp } : null);
  const e = { t: Date.now(), solo: pick(a.solo), flex: pick(a.flex) };
  const h = a.history || (a.history = []);
  const last = h[h.length - 1];
  if (last && rankKey(last.solo) === rankKey(e.solo) && rankKey(last.flex) === rankKey(e.flex)) return;
  h.push(e);
  if (h.length > 300) h.splice(0, h.length - 300);
}

// ---------- saved-but-never-logged-in accounts ----------
// They live under a temporary id ("new-…") until we learn their real puuid,
// either from the Riot ID lookup or from their first login.

const isPlaceholder = id => typeof id === 'string' && id.startsWith('new-');

function moveFile(from, to) {
  try { if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); } } catch {}
}

// placeholder oldId turned out to be newId
function resolvePlaceholder(oldId, newId) {
  const old = state.accounts.find(a => a.puuid === oldId);
  if (!old) return;
  const real = state.accounts.find(a => a.puuid === newId);
  if (real) {
    // already saved: keep the real tile, take over the login if it had none
    if (!real.hasCred && old.hasCred) { moveFile(credFile(oldId), credFile(newId)); real.hasCred = true; }
    else { try { fs.unlinkSync(credFile(oldId)); } catch {} }
    if (!real.note && old.note) real.note = old.note;
    state.accounts = state.accounts.filter(a => a !== old);
  } else {
    moveFile(credFile(oldId), credFile(newId));
    moveFile(sessionFile(oldId), sessionFile(newId));
    old.puuid = newId;
    delete old.placeholder;
  }
  if (state.active === oldId) state.active = newId;
  if (expecting === oldId) expecting = newId;
}

function maskLogin(u) {
  return u.length <= 3 ? u[0] + '•••' : u.slice(0, 2) + '•••' + u.slice(-1);
}

// ---------- watcher: keeps tiles fresh while League is open ----------

let lastRankSweep = 0;
let lastProfileAt = 0;
let ticking = false;
let gen = 0;          // bumped by switch/add: results of a tick that started before are thrown away
async function tick() {
  if (busy || ticking) return;
  ticking = true;
  try { await tickInner(gen); } catch (e) { logError('tick', e); } finally { ticking = false; }
}
async function tickInner(myGen) {
  const stale = () => busy || myGen !== gen;
  const cur = await riot.currentAccount();
  const phase = cur ? await riot.gameflowPhase() : null;
  if (stale()) return;
  const newPuuid = (cur ? cur.puuid : null) !== live.puuid;
  const changed = newPuuid || phase !== live.phase;
  live = { puuid: cur ? cur.puuid : null, phase, clientUp: !!cur };

  if (cur) {
    // first login of an account that was only saved so far
    if (isPlaceholder(expecting) && state.accounts.some(a => a.puuid === expecting)) resolvePlaceholder(expecting, cur.puuid);
    if (expecting) expecting = null;
    const known = state.accounts.some(a => a.puuid === cur.puuid);
    if (known || pendingAdd) {
      upsert(cur);
      state.active = cur.puuid;
      // fresh login -> keep the newest session copy
      if (pendingAdd || newPuuid || !fs.existsSync(sessionFile(cur.puuid))) await storeSession(cur.puuid);
      if (pendingAdd && pendingCred) await storeCred(cur.puuid, pendingCred);
      // profile details (wallet, champions, mastery …) of the signed-in account, every 5 minutes
      if (newPuuid || Date.now() - lastProfileAt > 300000) {
        lastProfileAt = Date.now();
        const [p, lp, elig, normals] = await Promise.all([riot.profileData(cur), riot.lastPlayed(cur.puuid),
          riot.rankedEligibility(), riot.normalGames(cur.puuid)]);
        if (stale()) return;
        const a = state.accounts.find(x => x.puuid === cur.puuid);
        if (a) {
          a.profile = { ...(a.profile || {}), ...p };
          if (lp) a.lastPlayed = lp;
          if (elig) a.rankedCheck = elig;
          if (normals) a.normals = bestNormals(a.normals, normals);
        }
      }
      pendingAdd = false;
      pendingCred = null;
      if (login) { loginToken++; login = null; }
      save();
    } else if (changed) push();

    // refresh the other saved accounts of the same region every 2 minutes, 5 when hidden (sooner for rebuilt tiles)
    const sweepEvery = winShown() ? 120000 : 300000;
    if (Date.now() - lastRankSweep > sweepEvery || state.accounts.some(a => a.needsInfo)) {
      lastRankSweep = Date.now();
      for (const a of [...state.accounts]) {
        if (stale()) return;
        delete a.needsInfo;          // one attempt is enough, whatever the outcome
        if (a.placeholder) {
          if (!a.tagLine) continue;
          const hit = await riot.lookupRiotId(a.gameName, a.tagLine);
          if (hit) { const old = a.puuid; resolvePlaceholder(old, hit.puuid); upsert(hit); }
          continue;
        }
        if (a.puuid === cur.puuid || (a.region && a.region !== cur.region)) continue;
        const r = await riot.rankedFor(a.puuid);
        const s = await riot.summonerByPuuid(a.puuid);
        if (r || s) upsert({ puuid: a.puuid, ...(r || {}),
          ...(s ? { iconId: s.profileIconId, level: s.summonerLevel, gameName: s.gameName || a.gameName, tagLine: s.tagLine || a.tagLine } : {}) });
        const lp = await riot.lastPlayed(a.puuid);
        const x = state.accounts.find(y => y.puuid === a.puuid);
        if (x && lp) x.lastPlayed = lp;
        // normal games only matter while the account has no rank yet
        if (x && !RANK_QUEUES.some(k => x[k])) {
          const n = await riot.normalGames(a.puuid);
          if (n) x.normals = bestNormals(x.normals, n);
        }
      }
      save();
    }
  } else if (changed) push();
}

// ---------- auto-login ----------

const AUTOFILL_ERR = ['nowindow', 'nofocus', 'lostfocus', 'badinput', 'error'];

// Waits for the Riot Client; if it shows the login screen, types the login.
// settleMs: how long the client must stay signed out before we type
// (longer after restoring a session, which may still be signing in by itself).
async function autoLogin(cred, name, settleMs) {
  const token = ++loginToken;
  setLogin({ name, stage: 'wait' });
  const t0 = Date.now();
  let signedOutSince = null, typedAt = null;
  while (token === loginToken && Date.now() - t0 < 120000) {
    const st = await riot.rcLoginState();
    if (token !== loginToken) return;
    if (st.subject) { setLogin(null); return; }
    if (st.up) {
      if (signedOutSince === null) signedOutSince = Date.now();
      if (!typedAt && Date.now() - signedOutSince >= settleMs) {
        setLogin({ name, stage: 'typing' });
        const r = await riot.autofill(cred.u, cred.p);
        if (token !== loginToken) return;
        if (r !== 'ok' && r !== 'ok-nopersist') return setLogin({ name, stage: 'failed', msgKey: 'af.' + (AUTOFILL_ERR.includes(r) ? r : 'error') });
        if (r === 'ok-nopersist') {
          logError('autofill', '"Stay signed in" could not be ticked');
          if (winShown()) win.webContents.send('toast', 'login.noPersist');
        }
        typedAt = Date.now();
        setLogin({ name, stage: 'verify' });
      }
      if (typedAt && login && login.stage === 'verify' && Date.now() - typedAt > 10000) setLogin({ name, stage: 'check' });
    }
    await sleep(1200);
  }
  if (token === loginToken) setLogin({ name, stage: 'failed', msgKey: 'm.timeout' });
}

// ---------- auto "Play" ----------
// After a switch the Riot Client sometimes stops on its home screen (always after a
// typed login). Once it is signed in and League hasn't started, press Play for the user.
let playToken = 0;
async function autoPlay() {
  if (!state.settings.autoPlay) return;
  const token = ++playToken;
  const t0 = Date.now();
  let signedInSince = null, presses = 0;
  while (token === playToken && Date.now() - t0 < 180000) {
    if (await riot.leagueRunning()) return;
    const st = await riot.rcLoginState();
    if (st.subject) {
      if (signedInSince === null) signedInSince = Date.now();
      // give the client a moment to start League by itself; retry once if nothing happens
      if (Date.now() - signedInSince > (presses ? 15000 : 2000)) {
        if (presses >= 2) return;
        await riot.pressPlay();
        presses++;
        signedInSince = Date.now();
      }
    } else signedInSince = null;
    await sleep(1000);
  }
}

// ---------- actions ----------

async function saveActiveBeforeLeaving() {
  gen++;
  // leave lobby / queue first, otherwise the new account often still "sits" in the old lobby
  if (await riot.leaveLobby()) await sleep(1200);
  // the Riot Client may have refreshed its tokens: keep the newest copy
  const who = live.puuid || state.active;
  const known = who && state.accounts.some(a => a.puuid === who);
  // is the Riot Client really signed in as that account right now?
  const st = known ? await riot.rcLoginState() : {};
  const signedInAsWho = known && st.subject === who;
  if (signedInAsWho) await storeSession(who, { verified: true });
  if (!(await riot.closeClients())) return false;
  // the client may write its newest tokens on exit: keep that copy (same account, checked above)
  if (signedInAsWho) await storeSession(who, { verified: true });
  return true;
}

async function withBusy(fn) {
  if (busy) return { ok: false, errorKey: 'm.busy' };
  busy = true; push();
  try { return await fn(); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  finally { busy = false; push(); }
}

function validCred(c) {
  return c && typeof c.u === 'string' && typeof c.p === 'string' && c.u.trim() && c.p ? { u: c.u.trim(), p: c.p } : null;
}

ipcMain.handle('get-state', () => { lastPushed = null; return snapshot(); });
ipcMain.handle('get-history', (_e, puuid) => {
  const a = state.accounts.find(x => x.puuid === puuid);
  return a && a.history ? a.history : [];
});

ipcMain.handle('switch', (_e, puuid) => withBusy(async () => {
  const acc = state.accounts.find(a => a.puuid === puuid);
  const json = await loadSession(puuid);
  const cred = await loadCred(puuid);
  if (!json && !cred) return { ok: false, errorKey: acc && acc.credBroken ? 'm.credBroken' : 'm.noSession' };
  loginToken++; login = null;

  // First look where the Riot Client stands – a full restart is only needed when another
  // account is signed in or League is running.
  const rc = await riot.rcLoginState();
  if (rc.up && !(await riot.leagueRunning())) {
    // already signed in as this account, League just isn't open: only press Play
    if (rc.subject === puuid) {
      gen++;
      state.active = puuid;
      save();
      await riot.pressPlay();
      return { ok: true, fast: 'play' };
    }
    // login screen already open and we have the password: type it straight in
    if (!rc.subject && cred) {
      gen++;
      state.active = puuid;
      expecting = puuid;
      live = { puuid: null, phase: null, clientUp: false };
      save();
      autoLogin(cred, acc ? acc.gameName : cred.u, 0);
      autoPlay();
      return { ok: true, fast: 'login' };
    }
  }

  if (!(await saveActiveBeforeLeaving())) return { ok: false, errorKey: 'm.closeFailed' };
  if (json) riot.restoreSession(json); else riot.clearSession();
  state.active = puuid;
  expecting = puuid;
  live = { puuid: null, phase: null, clientUp: false };
  save();
  riot.launchLeague();
  if (cred) autoLogin(cred, acc ? acc.gameName : cred.u, json ? 4000 : 1500);
  autoPlay();
  return { ok: true };
}));

ipcMain.handle('add-new', (_e, c) => withBusy(async () => {
  const cred = validCred(c);
  loginToken++; login = null;
  if (!(await saveActiveBeforeLeaving())) return { ok: false, errorKey: 'm.closeFailed' };
  riot.clearSession();
  state.active = null;
  live = { puuid: null, phase: null, clientUp: false };
  pendingAdd = true;
  pendingCred = cred && c.save !== false ? cred : null;   // "save" unticked: type it once, keep nothing
  save();
  riot.launchLeague();
  if (cred) autoLogin(cred, cred.u, 1500);
  autoPlay();
  return { ok: true };
}));

// save a login for later – nothing is closed or logged in now
ipcMain.handle('add-saved', async (_e, c) => {
  const cred = validCred(c);
  if (!cred) return { ok: false, errorKey: 'm.fill' };
  let gameName = '', tagLine = '';
  const rid = typeof c.riotId === 'string' ? c.riotId.trim() : '';
  if (rid) {
    const m = /^(.{2,16})#([^#\s]{2,5})$/.exec(rid);
    if (!m) return { ok: false, errorKey: 'm.riotIdFormat' };
    gameName = m[1].trim(); tagLine = m[2];
  }
  const hit = gameName ? await riot.lookupRiotId(gameName, tagLine) : null;
  let id;
  if (hit) {
    id = hit.puuid;
    upsert(hit);
    if (live.puuid === id) state.active = id;
  } else {
    id = 'new-' + crypto.randomUUID();
    upsert({ puuid: id, placeholder: true, gameName: gameName || maskLogin(cred.u), tagLine });
  }
  await storeCred(id, cred);
  save();
  return { ok: true, found: !!hit, riotId: !!gameName };
});

ipcMain.handle('add-current', () => withBusy(async () => {
  gen++;
  const cur = await riot.currentAccount();
  if (!cur) return { ok: false, errorKey: 'm.notLoggedIn' };
  upsert(cur);
  state.active = cur.puuid;
  const stored = await storeSession(cur.puuid);
  save();
  return stored ? { ok: true, puuid: cur.puuid } : { ok: false, errorKey: 'm.noSessionFound' };
}));

ipcMain.handle('cancel-add', () => {
  pendingAdd = false; pendingCred = null;
  loginToken++; login = null;
  push();
});
ipcMain.handle('dismiss-login', () => { loginToken++; setLogin(null); });

// the password never goes back to the window – only the username, for the edit form
ipcMain.handle('get-cred-user', async (_e, puuid) => {
  const c = await loadCred(puuid);
  return c ? c.u : '';
});
ipcMain.handle('set-cred', async (_e, puuid, c) => {
  const a = state.accounts.find(x => x.puuid === puuid);
  if (!a || !c || typeof c.u !== 'string' || !c.u.trim()) return { ok: false, errorKey: 'm.userMissing' };
  let p = typeof c.p === 'string' ? c.p : '';
  if (!p) { const old = await loadCred(puuid); if (old) p = old.p; }
  if (!p) return { ok: false, errorKey: 'm.passMissing' };
  await storeCred(puuid, { u: c.u.trim(), p });
  save();
  return { ok: true };
});
ipcMain.handle('del-cred', (_e, puuid) => {
  try { fs.unlinkSync(credFile(puuid)); } catch {}
  const a = state.accounts.find(x => x.puuid === puuid);
  if (a) a.hasCred = false;
  save();
});

ipcMain.handle('remove', (_e, puuid) => {
  state.accounts = state.accounts.filter(a => a.puuid !== puuid);
  if (state.active === puuid) state.active = null;
  for (const f of [sessionFile(puuid), credFile(puuid)]) { try { fs.unlinkSync(f); } catch {} }
  save();
});

ipcMain.handle('note', (_e, puuid, note) => {
  const a = state.accounts.find(x => x.puuid === puuid);
  if (a) { a.note = String(note).slice(0, 24); save(); }
});

// ---------- categories ----------
const findCat = id => state.categories.find(c => c.id === id);
ipcMain.handle('cat-add', (_e, name) => {
  const c = { id: 'c' + crypto.randomUUID().slice(0, 8), name: String(name || tr('cat.new')).trim().slice(0, 32) || tr('cat.new'), collapsed: false };
  state.categories.push(c);
  save();
  return c.id;
});
ipcMain.handle('cat-rename', (_e, id, name) => {
  const c = findCat(id);
  const n = String(name || '').trim().slice(0, 32);
  if (c && n) { c.name = n; save(); } else push();
});
ipcMain.handle('cat-toggle', (_e, id) => { const c = findCat(id); if (c) { c.collapsed = !c.collapsed; save(); } });
ipcMain.handle('cat-move', (_e, id, dir) => {
  const i = state.categories.findIndex(c => c.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= state.categories.length) return;
  [state.categories[i], state.categories[j]] = [state.categories[j], state.categories[i]];
  save();
});
ipcMain.handle('cat-del', (_e, id) => {
  state.categories = state.categories.filter(c => c.id !== id);
  for (const a of state.accounts) if (a.category === id) delete a.category;
  save();
});
// new order + category of every tile (drag & drop, "move to")
ipcMain.handle('arrange', (_e, list) => {
  if (!Array.isArray(list)) return;
  const byId = new Map(state.accounts.map(a => [a.puuid, a]));
  const next = [];
  for (const item of list) {
    const a = byId.get(item && item.puuid);
    if (!a || next.includes(a)) continue;
    if (item.category && findCat(item.category)) a.category = item.category; else delete a.category;
    next.push(a);
  }
  for (const a of state.accounts) if (!next.includes(a)) next.push(a);
  state.accounts = next;
  save();
});

ipcMain.handle('reorder', (_e, order) => {
  const byId = new Map(state.accounts.map(a => [a.puuid, a]));
  const next = order.map(id => byId.get(id)).filter(Boolean);
  for (const a of state.accounts) if (!next.includes(a)) next.push(a);
  state.accounts = next;
  save();
});

ipcMain.handle('refresh', async () => { lastRankSweep = 0; await tick(); push(); });
let toTray = false;   // the window is closing because it was sent to the tray
ipcMain.handle('win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  if (what === 'tray') {
    toTray = true;
    if (tray && !state.settings.trayHintShown) {
      // once: tell the user where the app went
      tray.displayBalloon({ iconType: 'info', title: tr('app.name'), content: tr('tray.balloon') });
      state.settings.trayHintShown = true;
      save();
    }
    win.close();
  }
  if (what === 'quit' || what === 'close') { quitting = true; app.quit(); }
});
ipcMain.handle('open-external', (_e, url) => {
  if (/^https:\/\/(www\.)?(op\.gg|u\.gg|leagueofgraphs\.com|porofessor\.gg|mobalytics\.gg|buymeacoffee\.com)\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('set-setting', (_e, key, value) => {
  if (!(key in DEFAULT_SETTINGS)) return;
  if (key === 'tile' || key === 'streamerHide') {
    // only known on/off switches
    state.settings[key] = value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[a-zA-Z0-9]{1,20}$/.test(k) && typeof v === 'boolean')) : null;
  } else if (key === 'lang') {
    state.settings.lang = i18n.LANGS.some(([l]) => l === value) ? value : 'en';
  } else state.settings[key] = typeof DEFAULT_SETTINGS[key] === 'boolean' ? !!value : String(value);
  if (key === 'autostart') applyAutostart();
  save();
});

// ---------- autostart, tray, auto-accept ----------

function applyAutostart() {
  if (process.env.RS_DATA) return;   // test copies never touch Windows settings
  app.setLoginItemSettings({
    openAtLogin: !!state.settings.autostart,
    path: process.execPath,
    // installed app: the .exe itself; from source: electron.exe + the project folder
    args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
  });
}

// The window only exists while it's on screen. In the tray it is closed completely,
// which frees its whole render process (~30 MB); opening it again rebuilds it (~0.3 s).
const winShown = () => !!(win && !win.isDestroyed() && win.isVisible());
let afterLoad = [];   // things to send once a freshly built window has loaded
function showWindow(then) {
  if (then) afterLoad.push(then);
  if (!win || win.isDestroyed()) { createWindow(true); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!win.webContents.isLoading()) { const q = afterLoad; afterLoad = []; q.forEach(f => f()); }
}

// streamer mode in the tray menu: same rules as the window (see renderer.js)
const STREAM_DEFAULTS = { name: true, tag: true, ranks: false, note: false, login: true };
const hides = k => !!state.settings.streamer && !!({ ...STREAM_DEFAULTS, ...(state.settings.streamerHide || {}) })[k];
function trayName(a) {
  if (!hides('name') && !(a.placeholder && !a.tagLine && hides('login')))
    return (a.gameName === 'Gespeicherter Login' ? tr('tile.savedLogin') : a.gameName) + (a.tagLine && !hides('tag') ? '#' + a.tagLine : '');
  if (a.note && !hides('note')) return a.note;
  return tr('stream.alias', { n: state.accounts.indexOf(a) + 1 });
}
const SUPPORT_URL = 'https://buymeacoffee.com/zlizz3r';
const rankText = q => (q ? tr('tier.' + q.tier) + (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(q.tier) ? '' : ' ' + q.division) : '');

function updateTray() {
  if (!tray) return;
  const accItem = a => ({
    label: trayName(a) + (a.solo && !hides('ranks') ? '   ·   ' + rankText(a.solo) : ''),
    type: 'radio', checked: a.puuid === state.active,
    click: () => showWindow(() => win.webContents.send('tray-switch', a.puuid)),
  });
  const items = [];
  const catIds = new Set(state.categories.map(c => c.id));
  const loose = state.accounts.filter(a => !catIds.has(a.category));
  if (loose.length) items.push(...loose.map(accItem), { type: 'separator' });
  for (const c of state.categories) {
    const list = state.accounts.filter(a => a.category === c.id);
    if (!list.length) continue;
    items.push({ label: c.name, enabled: false }, ...list.map(accItem), { type: 'separator' });
  }
  items.push(
    { label: tr('tray.accept'), type: 'checkbox', checked: !!state.settings.autoAccept,
      click: i => { state.settings.autoAccept = i.checked; save(); } },
    { label: tr('tray.streamer'), type: 'checkbox', checked: !!state.settings.streamer,
      click: i => { state.settings.streamer = i.checked; save(); } },
    { type: 'separator' },
    { label: tr('tray.support'), click: () => shell.openExternal(SUPPORT_URL) },
    { type: 'separator' },
    { label: tr('tray.open'), click: () => showWindow() },
    { label: tr('tray.quit'), click: () => { quitting = true; app.quit(); } },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
  const cur = state.accounts.find(a => a.puuid === state.active);
  tray.setToolTip(tr('app.name') + (cur ? ' – ' + trayName(cur) : ''));
  if (win && !win.isDestroyed()) win.setTitle(tr('app.name'));   // taskbar / Alt+Tab name
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', () => showWindow());
  updateTray();
}

// a queue pop only lasts ~10 s, so this checks every second while queueing
let accepting = false;
setInterval(async () => {
  if (!state.settings.autoAccept || accepting || !['Matchmaking', 'ReadyCheck'].includes(live.phase)) return;
  accepting = true;
  try { if ((await riot.acceptReadyCheck()) && winShown()) win.webContents.send('toast', 'tray.accepted'); }
  finally { accepting = false; }
}, 1000);

// ---------- window ----------

function createWindow(show) {
  win = new BrowserWindow({
    width: 1040, height: 640, minWidth: 720, minHeight: 460,
    frame: false, show: false,
    backgroundColor: '#0b0e14',
    title: tr('app.name'),
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // the window only ever shows our own page; links go through open-external
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('show', () => { lastPushed = null; push(); scheduleTick(0); });
  win.webContents.on('did-finish-load', () => { const q = afterLoad; afterLoad = []; q.forEach(f => f()); });
  win.on('closed', () => { win = null; lastPushed = null; });
  win.once('ready-to-show', () => { if (show && !process.env.RS_SHOT) win.show(); });
  // closing: with "close to tray" the window really closes but the app keeps running in the tray

  // dev helper: RS_SHOT=file.png runs RS_JS (renderer code, ';;'-separated steps), saves a screenshot and quits
  if (process.env.RS_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await sleep(5000);
      for (const js of (process.env.RS_JS || '').split(';;').filter(Boolean)) {
        try { await win.webContents.executeJavaScript(js + ';0'); } catch (e) { console.log('RS_JS step failed:', e.message); }
        await sleep(1500);
      }
      fs.writeFileSync(process.env.RS_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(async () => {
  load();
  // older saves don't have the flag yet
  // started with --hidden (autostart): no window at all until the tray icon is clicked
  if (process.env.RS_SHOT || !process.argv.includes('--hidden')) createWindow(true);
  if (!process.env.RS_SHOT) createTray();
  applyAutostart();
  await checkCrypto();
  await recoverOrphans();
  await checkCreds();
  save();
  scheduleTick(0);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // sent to the tray: keep running there; anything else (quit button, Alt+F4) ends the app
  if (toTray && tray && !quitting && !process.env.RS_SHOT) { toTray = false; return; }
  app.quit();
});
app.on('second-instance', () => showWindow());

// Polling pace: every 4 s while the window is open or something waits on League
// (queue for auto-accept, a login, an add); every 15 s when the app sits in the tray.
let tickTimer = null;
function scheduleTick(ms) {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(async () => {
    await tick();
    const eager = winShown() || pendingAdd || login || expecting
      || (state.settings.autoAccept && ['Lobby', 'Matchmaking', 'ReadyCheck'].includes(live.phase));
    scheduleTick(eager ? 4000 : 15000);
  }, ms);
}
