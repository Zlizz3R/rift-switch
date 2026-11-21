// Export / import file: accounts, categories, settings, and (optionally) saved logins sealed
// with a password of the user's own. Pure data handling – dialogs and files stay in main.js.
const { mergeSettings } = require('./settings');
const { validCred, maskLogin } = require('./accounts');

const EXPORT_FIELDS = ['puuid', 'gameName', 'tagLine', 'region', 'note', 'category', 'addedAt', 'iconId', 'level',
  'solo', 'flex', 'r5', 'classic', 'lastPlayed', 'history', 'rankedGames'];
const pickFields = x => Object.fromEntries(EXPORT_FIELDS.filter(k => x[k] !== undefined).map(k => [k, x[k]]));
const PUUID = /^[0-9a-f-]{36}$/i, ANY_ID = /^(new-)?[0-9a-f-]{36}$/i, CAT_ID = /^c[\w-]{1,40}$/;

function buildExport(state, secrets, now = Date.now()) {
  const { autostart, ...settings } = state.settings || {};
  return {
    app: 'rift-switch', version: 1, exportedAt: now,
    accounts: (state.accounts || []).filter(a => !a.placeholder).map(pickFields),
    categories: state.categories || [], settings,
    ...(secrets ? { secrets } : {}),
  };
}

// a parsed file -> the file, or null if it isn't one of ours
function checkFile(d) { return d && d.app === 'rift-switch' && Array.isArray(d.accounts) ? d : null; }

// merges the file into state (this PC's data wins, only gaps are filled); returns counts
function applyImport(state, d, { langs, newCatName = 'Category', now = Date.now() } = {}) {
  const catIds = new Set(state.categories.map(c => c.id));
  for (const c of Array.isArray(d.categories) ? d.categories : []) {
    if (c && typeof c.id === 'string' && CAT_ID.test(c.id) && !catIds.has(c.id)) {
      state.categories.push({ id: c.id, name: String(c.name || '').slice(0, 32) || newCatName, collapsed: !!c.collapsed });
      catIds.add(c.id);
    }
  }
  let added = 0, updated = 0;
  for (const x of d.accounts) {
    if (!x || !PUUID.test(x.puuid || '')) continue;
    const acc = pickFields(x);
    acc.note = String(acc.note || '').slice(0, 24);
    if (acc.category && !catIds.has(acc.category)) delete acc.category;
    const have = state.accounts.find(a => a.puuid === acc.puuid);
    if (have) {
      if (!have.note && acc.note) have.note = acc.note;
      if (!have.category && acc.category) have.category = acc.category;
      updated++;
    } else { state.accounts.push({ ...acc, addedAt: acc.addedAt || now }); added++; }
  }
  mergeSettings(state.settings, d.settings, langs);
  return { added, updated };
}

// sealed logins -> [{ puuid, cred }] to store; adds placeholder tiles for logins that only
// existed as "saved, never signed in". A login already on this PC wins.
function loginsToRestore(state, logins, now = Date.now()) {
  const out = [];
  for (const l of Array.isArray(logins) ? logins : []) {
    const cred = l && validCred({ u: l.u, p: l.p });
    if (!cred || !ANY_ID.test(l.puuid || '')) continue;
    let a = state.accounts.find(x => x.puuid === l.puuid);
    if (!a && l.placeholder) {
      a = { puuid: l.puuid, placeholder: true, note: '', addedAt: now,
        gameName: String(l.gameName || maskLogin(cred.u)).slice(0, 32), tagLine: String(l.tagLine || '').slice(0, 8) };
      state.accounts.push(a);
    }
    if (!a || (a.hasCred && !a.credBroken)) continue;
    out.push({ puuid: a.puuid, cred });
  }
  return out;
}

module.exports = { EXPORT_FIELDS, buildExport, checkFile, applyImport, loginsToRestore };
