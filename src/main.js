const { app, BrowserWindow, ipcMain, safeStorage, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const riot = require('./riot');
const i18n = require('./i18n');
const liveData = require('./live');
const lcuEvents = require('./lcuevents');
const updater = require('./updater');
const matches = require('./matches');
const { parseRiotId, RANK_QUEUES, isId, isPlaceholder, validCred, maskLogin, bestNormals, mergeRankedGames, upsertInto } = require('./core/accounts');
const { DEFAULT_SETTINGS, cleanSetting } = require('./core/settings');
const { sealSecrets, openSecrets, makeLock, lockMatches } = require('./core/secrets');
const backup = require('./core/backup');
const store = require('./core/store');
const menu = require('./core/menu');
const LANG_CODES = i18n.LANGS.map(([l]) => l);

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

function load() { state = store.readState(STORE, logError); }
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
      store.writeAtomic(STORE, text);
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
  if (locked) return { locked: true, hasLock: true, accounts: [], categories: [], active: null,
    settings: { lang: state.settings.lang, theme: state.settings.theme, uiScale: state.settings.uiScale, tile: null },
    live: { clientUp: false }, version: app.getVersion(), update: updater.get() };
  // LP history can be long: the profile window asks for it when it opens
  const accounts = state.accounts.map(({ history, ...a }) => ({ ...a, historyLen: history ? history.length : 0 }));
  const { lock, ...rest } = state;
  return { ...rest, hasLock: !!lock, accounts, live, pendingAdd, busy, login, saveError, cryptoBroken, version: app.getVersion(), update: updater.get() };
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

const upsert = acc => upsertInto(state.accounts, acc);

// ---------- saved-but-never-logged-in accounts ----------
// They live under a temporary id ("new-…") until we learn their real puuid,
// either from the Riot ID lookup or from their first login.


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
  lcuEvents.connect(riot.lockfile(), onLcuEvent);
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
        const [p, hs, elig] = await Promise.all([riot.profileData(cur), riot.historySummary(cur.puuid), riot.rankedEligibility()]);
        const lp = hs && hs.lastPlayed, normals = hs && hs.normals;
        if (stale()) return;
        const a = state.accounts.find(x => x.puuid === cur.puuid);
        if (a) {
          a.profile = { ...(a.profile || {}), ...p };
          if (lp) a.lastPlayed = lp;
          if (elig) a.rankedCheck = elig;
          if (normals) a.normals = bestNormals(a.normals, normals);
          if (hs) { mergeRankedGames(a, hs.ranked); matches.note(cur.puuid, hs.list); }
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
          if (hit && !stale() && state.accounts.some(y => y.puuid === a.puuid)) { const old = a.puuid; resolvePlaceholder(old, hit.puuid); upsert(hit); }
          continue;
        }
        if (a.puuid === cur.puuid || (a.region && a.region !== cur.region)) continue;
        const r = await riot.rankedFor(a.puuid);
        const s = await riot.summonerByPuuid(a.puuid);
        // removed while we were waiting? then don't bring it back
        if (stale() || !state.accounts.some(y => y.puuid === a.puuid)) continue;
        if (r || s) upsert({ puuid: a.puuid, ...(r || {}),
          ...(s ? { iconId: s.profileIconId, level: s.summonerLevel, gameName: s.gameName || a.gameName, tagLine: s.tagLine || a.tagLine } : {}) });
        const hs = await riot.historySummary(a.puuid);
        const x = state.accounts.find(y => y.puuid === a.puuid);
        if (x && hs) {
          if (hs.lastPlayed) x.lastPlayed = hs.lastPlayed;
          mergeRankedGames(x, hs.ranked);
          matches.note(x.puuid, hs.list);
          // normal games only matter while the account has no rank yet
          if (!RANK_QUEUES.some(k => x[k])) x.normals = bestNormals(x.normals, hs.normals);
        }
      }
      save();
    }
  } else if (changed) push();
  if (cur && !stale() && matches.missing().length) {
    const got = await matches.fill(riot.lcu, winShown() ? 8 : 3);
    if (got && winShown()) win.webContents.send('matches-changed');
  }
}

// ---------- auto-login ----------

const AUTOFILL_ERR = ['noform', 'nowindow', 'nofocus', 'lostfocus', 'badinput', 'error'];

// Waits for the Riot Client; if it shows the login screen, types the login.
// settleMs: how long the client must stay signed out before we type
// (longer after restoring a session, which may still be signing in by itself).
// since: the Riot Client was restarted at that moment – only type into a window started after it
async function autoLogin(cred, name, settleMs, since) {
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
        const r = await riot.autofill(cred.u, cred.p, since);
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
// League product line of an account: PBE accounts start the PBE client. An account whose
// server isn't known yet starts normally; after the login the Riot Client tells its platform.
const plOf = acc => (acc && acc.region === 'PBE' ? 'pbe' : 'live');
let playLine = 'live';
async function autoPlay(pl) {
  if (pl) playLine = pl;
  const token = ++playToken;
  const t0 = Date.now();
  let signedInSince = null, presses = 0, checked = false;
  while (token === playToken && Date.now() - t0 < 180000) {
    const st = await riot.rcLoginState();
    if (st.subject) {
      if (signedInSince === null) signedInSince = Date.now();
      // once per login: which platform is this account on? (PBE1 = PBE account)
      if (!checked) {
        const rc = await riot.rcAccount();
        if (token !== playToken) return;
        if (rc && rc.region) {
          checked = true;
          const acc = state.accounts.find(x => x.puuid === st.subject) || state.accounts.find(x => x.puuid === expecting);
          if (acc && acc.region !== rc.region) { acc.region = rc.region; save(); }
          if (rc.region === 'PBE' && playLine !== 'pbe') {
            // the client may have started (or tried to start) live League: close that, start PBE –
            // the same as picking "League of Legends PBE" next to Play
            playLine = 'pbe';
            if (await riot.leagueRunning() && riot.patchline() !== 'pbe') await riot.closeLeagueOnly();
            // the client already tried live League and shows "can't play with your PBE account": close it first
            const d = await riot.dismissPbeDialog();
            if (d !== 'closed') await sleep(800);
            await riot.pressPlay('pbe');   // = picking 'League of Legends PBE' next to Play
            setTimeout(() => riot.dismissPbeDialog(), 2500);   // in case the dialog popped up only now
            presses++;
            signedInSince = Date.now();
          }
        }
      }
      if (await riot.leagueRunning()) return;
      if (!state.settings.autoPlay) { if (checked) return; }
      // give the client a moment to start League by itself; retry once if nothing happens
      else if (!presses || Date.now() - signedInSince > 12000) {
        if (presses >= 2) return;
        await riot.pressPlay(playLine === 'pbe' ? 'pbe' : 'live');
        presses++;
        signedInSince = Date.now();
      }
    } else signedInSince = null;
    await sleep(presses ? 1500 : 600);
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

// ---------- app lock ----------
// Optional password asked on start and whenever the window comes back from the tray.
// While locked the window gets no account data and every action except unlocking is refused.
// (Protects against someone else at the PC switching accounts – the data files are
// encrypted for the Windows user anyway.)
let locked = false;
const LOCK_FREE = new Set(['get-state', 'unlock', 'win']);
function lockNow() { if (state.lock) { locked = true; lastPushed = null; push(); updateTray(); } }
{
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (ch, fn) => handle(ch, (...args) => (locked && !LOCK_FREE.has(ch) ? null : fn(...args)));
}
let unlockFails = 0;
ipcMain.handle('unlock', async (_e, pass) => {
  await sleep(Math.min(5000, 400 * unlockFails));      // slows down guessing
  if (!lockMatches(state.lock, pass)) { unlockFails++; return false; }
  unlockFails = 0; locked = false; lastPushed = null; push(); updateTray();
  return true;
});
ipcMain.handle('lock', (_e, what, pass, oldPass) => {
  if (what === 'now') return lockNow(), true;
  if (what === 'set') {
    if (typeof pass !== 'string' || pass.length < 4) return false;
    if (state.lock && !lockMatches(state.lock, oldPass)) return false;
    state.lock = makeLock(pass);
    save(); push(); return true;
  }
  if (what === 'off') {
    if (state.lock && !lockMatches(state.lock, pass)) return false;
    delete state.lock; save(); push(); return true;
  }
  return false;
});

// account ids coming from the window: a puuid or a "new-<uuid>" placeholder, nothing else
ipcMain.handle('get-state', () => { lastPushed = null; return snapshot(); });
ipcMain.handle('get-history', (_e, puuid) => {
  const a = state.accounts.find(x => x.puuid === puuid);
  return a && a.history ? a.history : [];
});

ipcMain.handle('switch', (_e, puuid) => withBusy(async () => {
  if (!isId(puuid)) return { ok: false };
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
      const rcA = await riot.rcAccount();
      await riot.pressPlay((rcA && rcA.region === 'PBE') || plOf(acc) === 'pbe' ? 'pbe' : 'live');
      return { ok: true, fast: 'play' };
    }
    // login screen already open and we have the password: type it straight in
    if (!rc.subject && cred) {
      gen++;
      state.active = puuid;
      expecting = puuid;
      live = { puuid: null, phase: null, clientUp: false };
      save();
      autoLogin(cred, acc ? acc.gameName : cred.u, 1500);
      autoPlay(plOf(acc));
      return { ok: true, fast: 'login' };
    }
  }

  if (!(await saveActiveBeforeLeaving())) return { ok: false, errorKey: 'm.closeFailed' };
  if (json) riot.restoreSession(json); else riot.clearSession();
  state.active = puuid;
  expecting = puuid;
  live = { puuid: null, phase: null, clientUp: false };
  save();
  const started = Date.now();
  riot.launchLeague(plOf(acc));
  if (cred) autoLogin(cred, acc ? acc.gameName : cred.u, json ? 4000 : 1500, started);
  autoPlay(plOf(acc));
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
  const started = Date.now();
  riot.launchLeague();
  if (cred) autoLogin(cred, cred.u, 1500, started);
  autoPlay('live');
  return { ok: true };
}));

// save a login for later – nothing is closed or logged in now
ipcMain.handle('add-saved', async (_e, c) => {
  gen++;
  const cred = validCred(c);
  if (!cred) return { ok: false, errorKey: 'm.fill' };
  let gameName = '', tagLine = '';
  const rid = typeof c.riotId === 'string' ? c.riotId.trim() : '';
  if (rid) {
    const m = parseRiotId(rid);
    if (!m) return { ok: false, errorKey: 'm.riotIdFormat' };
    ({ gameName, tagLine } = m);
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
  // Riot ID for a saved account that had none yet
  const rid = a.placeholder && !a.tagLine && typeof c.riotId === 'string' ? c.riotId.trim() : '';
  const m = rid ? parseRiotId(rid) : null;
  if (rid && !m) return { ok: false, errorKey: 'm.riotIdFormat' };
  await storeCred(puuid, { u: c.u.trim(), p });
  let found = false;
  if (m) {
    gen++;
    const hit = await riot.lookupRiotId(m.gameName, m.tagLine);
    if (hit && state.accounts.some(x => x.puuid === puuid)) { resolvePlaceholder(puuid, hit.puuid); upsert(hit); found = true; }
    else { a.gameName = m.gameName; a.tagLine = m.tagLine; }   // looked up later, once League runs
  }
  save();
  return { ok: true, found };
});
ipcMain.handle('del-cred', (_e, puuid) => {
  if (!isId(puuid)) return;
  try { fs.unlinkSync(credFile(puuid)); } catch {}
  const a = state.accounts.find(x => x.puuid === puuid);
  if (a) a.hasCred = false;
  save();
});

ipcMain.handle('remove', (_e, puuid) => {
  if (!isId(puuid)) return;
  gen++;
  state.accounts = state.accounts.filter(a => a.puuid !== puuid);
  matches.forget(puuid);
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
  gen++;
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
  gen++;
  const byId = new Map(state.accounts.map(a => [a.puuid, a]));
  const next = order.map(id => byId.get(id)).filter(Boolean);
  for (const a of state.accounts) if (!next.includes(a)) next.push(a);
  state.accounts = next;
  save();
});

ipcMain.handle('live', () => liveData.snapshot());
ipcMain.handle('champions', () => liveData.champions(DATA));
ipcMain.handle('matchup', (_e, mine, enemy, lane) => liveData.matchup(String(mine), String(enemy), String(lane || 'top')));
ipcMain.handle('ranked-games', (_e, puuid) => {
  const a = state.accounts.find(x => x.puuid === puuid);
  return (a && a.rankedGames) || [];
});
ipcMain.handle('tool', (_e, what) => withBusy(async () => {
  const RC = path.join(process.env.LOCALAPPDATA, 'Riot Games', 'Riot Client');
  // closing tools keep the newest sign-in of the current account first (like a switch)
  if (what === 'closeAll') return { ok: await saveActiveBeforeLeaving() };
  if (what === 'restart') {
    if (!(await saveActiveBeforeLeaving())) return { ok: false };
    const pl = plOf(state.accounts.find(x => x.puuid === state.active));
    riot.launchLeague(pl); autoPlay(pl);
    return { ok: true };
  }
  if (what === 'clearCache') {
    // only the Riot Client's web cache and logs – never its Data folder (that holds the sign-in)
    if (!(await saveActiveBeforeLeaving())) return { ok: false };
    for (const d of ['HttpCache', 'Logs']) { try { fs.rmSync(path.join(RC, d), { recursive: true, force: true }); } catch {} }
    return { ok: true };
  }
  if (what === 'openLogs') {
    const logs = path.join(RC, 'Logs');
    if (!fs.existsSync(logs)) return { ok: false };
    return { ok: !(await shell.openPath(logs)) };
  }
  if (what === 'openData') { shell.openPath(DATA); return { ok: true }; }
  return { ok: false };
}));
ipcMain.handle('open-multi', (_e, region, ids) => {
  // op.gg multisearch for up to 5 Riot IDs (Clash opponents)
  if (!Array.isArray(ids) || !ids.length) return;
  const list = ids.slice(0, 5).map(x => String(x).replace(/[^\p{L}\p{N} #_.-]/gu, '')).join(',');
  const reg = String(region || 'euw').toLowerCase().replace(/[^a-z]/g, '');
  shell.openExternal('https://op.gg/multisearch/' + reg + '?summoners=' + encodeURIComponent(list));
});

ipcMain.handle('refresh', async () => {
  if (ticking || busy) return { ok: false, busy: true };
  lastRankSweep = 0; await tick(); push();
  return { ok: true };
});
let toTray = false;   // the window is closing because it was sent to the tray
ipcMain.handle('matches', async (_e, filter) => {
  const f = filter && typeof filter === 'object' ? filter : {};
  return {
    games: matches.list(state.accounts.map(a => a.puuid), {
      puuid: isId(f.puuid) ? f.puuid : null, queue: Object.keys(matches.QUEUE_GROUPS).includes(f.queue) ? f.queue : null,
      limit: Math.min(2000, Math.max(20, Number(f.limit) || 80)) }),
    waiting: matches.missing().length, loadingOlder,
    assets: await liveData.gameAssets(DATA),
    clientUp: live.clientUp,
  };
});
// "Load older games": the next 20 games of every account the running client can see
// (same server), then their details in the background.
let loadingOlder = false;
// ranks of the players in the shown games: cached ones right away, missing ones fetched
// from the League client (a few at a time) – the page asks again until none are missing
let fetchingRanks = false;
ipcMain.handle('player-ranks', async (_e, puuids) => {
  const ids = Array.isArray(puuids) ? puuids.filter(p => typeof p === 'string' && /^[0-9a-f-]{36}$/i.test(p)).slice(0, 500) : [];
  let pending = 0;
  if (live.clientUp && !fetchingRanks && matches.staleRanks(ids).length) {
    fetchingRanks = true;
    try { await matches.fetchRanks(ids, p => riot.rankedFor(p)); } finally { fetchingRanks = false; }
    pending = matches.staleRanks(ids).length;
  }
  return { ranks: matches.ranksFor(ids), pending: live.clientUp ? pending : 0 };
});
ipcMain.handle('matches-more', async () => {
  if (loadingOlder || !live.clientUp) return { ok: false, offline: !live.clientUp };
  loadingOlder = true;
  try {
    const cur = state.accounts.find(a => a.puuid === live.puuid);
    const region = cur && cur.region;
    let added = 0;
    for (const a of state.accounts) {
      if (a.placeholder || (region && a.region && a.region !== region)) continue;
      const beg = matches.known(a.puuid);
      const list = await riot.matchList(a.puuid, beg, beg + 20);
      if (list && list.length) { const before = matches.known(a.puuid); matches.note(a.puuid, list); added += matches.known(a.puuid) - before; }
    }
    // details: a few at a time so the client isn't flooded; the page refreshes as they come
    (async () => {
      for (let i = 0; i < 40 && matches.missing().length && live.clientUp; i++) {
        const got = await matches.fill(riot.lcu, 4);
        if (got && winShown()) win.webContents.send('matches-changed');
        if (!got) break;
      }
      loadingOlder = false;
      if (winShown()) win.webContents.send('matches-changed');
    })();
    return { ok: true, added };
  } catch (e) { loadingOlder = false; logError('matches-more', e); return { ok: false }; }
});
ipcMain.handle('update', (_e, what) => {
  if (what === 'install') { quitting = true; updater.installNow(); } else updater.check();
});
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
  const r = cleanSetting(key, value, LANG_CODES);
  if (!r.ok) return;
  state.settings[key] = r.value;
  if (key === 'uiScale') applyScale();
  if (key === 'autostart') applyAutostart();
  save();
});

// ---------- autostart, tray, auto-accept ----------

function applyScale() {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(Number(state.settings.uiScale || 100) / 100);
}

// ---------- export / import ----------
// Accounts, categories and settings. Saved logins and sessions are encrypted for this
// Windows user only, so they are never part of the file.
let importFile = null;   // the file picked for an import that still waits for its password

ipcMain.handle('data-export', async (_e, pass) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'rift-switch-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  let secrets;
  if (typeof pass === 'string' && pass.length >= 8) {
    const logins = [];
    for (const a of state.accounts) {
      const c = a.hasCred || a.placeholder ? await loadCred(a.puuid) : null;
      if (c) logins.push({ puuid: a.puuid, u: c.u, p: c.p, ...(a.placeholder ? { placeholder: true, gameName: a.gameName, tagLine: a.tagLine || '' } : {}) });
    }
    secrets = sealSecrets({ logins }, pass);
  }
  const file = backup.buildExport(state, secrets);
  try {
    fs.writeFileSync(r.filePath, JSON.stringify(file, null, 1));
    return { ok: true, n: file.accounts.length };
  } catch (e) { return { ok: false, error: e.code || e.message }; }
});
function readImport(file) {
  try { return backup.checkFile(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); } catch { return null; }
}
ipcMain.handle('check-import-pass', (_e, pass) => {
  const d = importFile && readImport(importFile);
  return !!(d && d.secrets && openSecrets(d.secrets, pass));
});
// pass: null = pick a file; a string = the password for the file picked before; 'skip' = without logins
ipcMain.handle('data-import', async (_e, pass) => {
  if (pass == null) {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    importFile = r.filePaths[0];
  }
  const d = importFile && readImport(importFile);
  if (!d) return { ok: false, error: 'format' };
  if (d.secrets && pass == null) return { needPass: true, logins: '' };
  let logins = [];
  if (d.secrets && pass !== 'skip') {
    const s = openSecrets(d.secrets, pass);
    if (!s) return { ok: false, error: 'pass' };
    logins = Array.isArray(s.logins) ? s.logins : [];
  }
  importFile = null;
  gen++;
  const { added, updated } = backup.applyImport(state, d, { langs: LANG_CODES, newCatName: tr('cat.new') });
  applyScale();
  // saved logins: stored encrypted for this Windows user again
  const restore = backup.loginsToRestore(state, logins);
  for (const x of restore) await storeCred(x.puuid, x.cred);
  const nLogins = restore.length;
  save(); push();
  return { ok: true, added, updated, logins: nLogins };
});

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
  if (!win || win.isDestroyed()) { if (state.lock) locked = true; createWindow(true); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!win.webContents.isLoading()) { const q = afterLoad; afterLoad = []; q.forEach(f => f()); }
}

// streamer mode in the tray menu: same rules as the window (see renderer.js)
const trayName = a => menu.displayName(a, state, tr);
const SUPPORT_URL = 'https://buymeacoffee.com/zlizz3r';

function updateTray() {
  if (!tray) return;
  const items = menu.accountItems(state, { locked, tr }).map(x =>
    x.type === 'account' ? { label: x.label, type: 'radio', checked: x.checked,
      click: () => showWindow(() => win.webContents.send('tray-switch', x.puuid)) }
    : x.type === 'separator' ? { type: 'separator' } : { label: x.label, enabled: false });
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
  updateJumpList();
  const cur = state.accounts.find(a => a.puuid === state.active);
  tray.setToolTip(tr('app.name') + (cur ? ' – ' + trayName(cur) : ''));
  if (win && !win.isDestroyed()) win.setTitle(tr('app.name'));   // taskbar / Alt+Tab name
}

// Right-click on the taskbar button: "switch to <account>" for each account (up to 10).
// Starting the app with --switch=<id> hands the id to the running copy.
let lastJump = null;
function updateJumpList() {
  if (process.platform !== 'win32' || process.env.RS_DATA) return;
  const tasks = menu.jumpTasks(state, { locked, tr, program: process.execPath,
    baseArgs: app.isPackaged ? [] : [JSON.stringify(path.resolve(__dirname, '..'))] });
  const key = JSON.stringify(tasks);
  if (key === lastJump) return;
  lastJump = key;
  try { app.setUserTasks(tasks); } catch {}
}
const switchArg = argv => menu.switchArg(argv, state.accounts);
function switchFromOutside(argv) {
  const id = switchArg(argv);
  showWindow(id && !locked ? () => win.webContents.send('tray-switch', id) : undefined);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', () => showWindow());
  updateTray();
}

// a queue pop only lasts ~10 s: with the client's events it is accepted the moment it pops;
// without them (events not connected) this checks every second while queueing
let accepting = false;
async function tryAccept() {
  if (!state.settings.autoAccept || accepting) return;
  accepting = true;
  try { if ((await riot.acceptReadyCheck()) && winShown()) win.webContents.send('toast', 'tray.accepted'); }
  finally { accepting = false; }
}
setInterval(() => {
  if (lcuEvents.connected() && live.phase !== 'ReadyCheck') return;
  if (['Matchmaking', 'ReadyCheck'].includes(live.phase)) tryAccept();
}, 1000);

// events from the League client: react at once instead of waiting for the next poll
let eventTick = null;
function soonTick(ms) {
  if (eventTick) return;
  eventTick = setTimeout(() => { eventTick = null; scheduleTick(0); }, ms);
}
function onLcuEvent(uri, data) {
  if (uri === '/lol-gameflow/v1/gameflow-phase') {
    if (typeof data === 'string' && data !== live.phase) {
      live = { ...live, phase: data };
      push();
      if (data === 'ReadyCheck') tryAccept();
    }
    soonTick(300);
  } else if (uri === '/lol-matchmaking/v1/ready-check') {
    if (data && data.state === 'InProgress' && data.playerResponse === 'None') tryAccept();
  } else if (uri === '/lol-end-of-game/v1/eog-stats-block') {
    lastProfileAt = 0;          // a game just ended: fresh ranks, history and LP right away
    soonTick(3000);
  } else soonTick(800);
}

// ---------- window ----------

function createWindow(show) {
  win = new BrowserWindow({
    width: 1040, height: 640, minWidth: 720, minHeight: 460,
    frame: false, show: false,
    backgroundColor: '#0b0e14',
    title: tr('app.name'),
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
      // test screenshots: the hidden window must keep painting
      ...(process.env.RS_SHOT ? { backgroundThrottling: false, offscreen: false } : {}) },
    ...(process.env.RS_SHOT ? { paintWhenInitiallyHidden: true, width: Number(process.env.RS_W) || 1040 } : {}),
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // the window only ever shows our own page; links go through open-external
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('show', () => { lastPushed = null; push(); scheduleTick(0); });
  win.webContents.on('did-finish-load', () => { applyScale(); const q = afterLoad; afterLoad = []; q.forEach(f => f()); });
  win.on('closed', () => { win = null; lastPushed = null; });
  win.once('ready-to-show', () => { if (show && !process.env.RS_SHOT) win.show(); });
  // test screenshots: shown far off-screen and without focus, so Chromium really paints every change
  if (process.env.RS_SHOT) win.once('ready-to-show', () => { win.setPosition(-4000, 0); win.showInactive(); });
  // closing: with "close to tray" the window really closes but the app keeps running in the tray

  // dev helper: RS_SHOT=file.png runs RS_JS (renderer code, ';;'-separated steps), saves a screenshot and quits
  if (process.env.RS_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await sleep(5000);
      for (const js of (process.env.RS_JS || '').split(';;').filter(Boolean)) {
        try { await win.webContents.executeJavaScript(js + ';0'); } catch (e) { console.log('RS_JS step failed:', e.message); }
        await sleep(1500);
      }
      win.webContents.invalidate(); await sleep(400);   // the hidden test window may not have repainted
      fs.writeFileSync(process.env.RS_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(async () => {
  load();
  matches.load(DATA);
  locked = !!state.lock;
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
  updater.init(app, () => push());
  if (switchArg(process.argv)) switchFromOutside(process.argv);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // sent to the tray: keep running there; anything else (quit button, Alt+F4) ends the app
  if (toTray && tray && !quitting && !process.env.RS_SHOT) { toTray = false; return; }
  app.quit();
});
app.on('second-instance', (_e, argv) => switchFromOutside(argv));

// Polling pace: every 4 s while the window is open or something waits on League
// (queue for auto-accept, a login, an add); every 15 s when the app sits in the tray.
let tickTimer = null;
function scheduleTick(ms) {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(async () => {
    await tick();
    const eager = winShown() || pendingAdd || login || expecting
      || (state.settings.autoAccept && ['Lobby', 'Matchmaking', 'ReadyCheck'].includes(live.phase));
    const ev = lcuEvents.connected();
    scheduleTick(eager ? (ev && !pendingAdd && !login && !expecting ? 10000 : 4000) : (ev ? 60000 : 15000));
  }, ms);
}
