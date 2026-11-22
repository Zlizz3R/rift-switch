const $ = id => document.getElementById(id);
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins';
const iconUrl = id => `${CDRAGON}/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;
// emblem of a tier; tiers the app doesn't know get no picture (transparent pixel)
const crestUrl = tier => (RankMath.TIERS.includes(tier)
  ? `${CDRAGON}/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.svg`
  : 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');

const { TIERS, DIVS, APEX, DAY, rankScore } = RankMath;   // rankmath.js
// the ranked queues shown on tiles / in the profile: [key, label]
const QUEUES = [['solo', 'Solo/Duo'], ['flex', 'Flex'], ['r5', 'Ranked 5v5'], ['classic', 'Classic 5v5']];
const RISKY = ['ChampSelect', 'InProgress', 'GameStart', 'Reconnect', 'ReadyCheck'];

let S = { accounts: [], active: null, live: {}, pendingAdd: false, busy: false, settings: {} };
let menuFor = null;
let shownSaveError = null;

// ---------- language ----------
const lang = () => (S.settings && S.settings.lang) || 'en';
const t = (key, vars) => I18N.t(lang(), key, vars);
const locale = () => I18N.LOCALES[lang()] || 'en-GB';
// unknown tiers (new modes) are shown as their own name, e.g. SALT -> Salt
const tierName = tier => (I18N.STRINGS.en['tier.' + tier] ? t('tier.' + tier) : String(tier || '').charAt(0) + String(tier || '').slice(1).toLowerCase());
let appliedLang = null;
// fills every data-i18n / data-i18n-title / data-i18n-ph element of the static page
function applyStaticTexts() {
  if (appliedLang === lang()) return;
  appliedLang = lang();
  document.documentElement.lang = appliedLang;
  // Arabic and Urdu: text runs right to left (the layout itself stays as it is)
  document.body.classList.toggle('rtl', ['ar', 'ur'].includes(appliedLang));
  document.title = t('app.name');
  document.querySelectorAll('[data-i18n]').forEach(el => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-title]').forEach(el => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll('[data-i18n-ph]').forEach(el => (el.placeholder = t(el.dataset.i18nPh)));
  $('langSelect').value = appliedLang;
}

// ---------- what a tile shows (Customise tiles) ----------
const TILE_DEFAULTS = { icon: true, level: true, tag: true, note: true, lock: true, server: true, solo: true, flex: true, r5: false, classic: false,
  winrate: true, ranked: true, inactive: true, lastPlayed: false, wallet: false };
const TILE_GROUPS = [
  ['te.g.head', ['icon', 'level', 'tag', 'note', 'lock', 'server']],
  ['te.g.ranks', ['solo', 'flex', 'r5', 'classic', 'winrate']],
  ['te.g.extra', ['ranked', 'inactive', 'lastPlayed', 'wallet']],
];
const tileOpt = () => ({ ...TILE_DEFAULTS, ...((S.settings && S.settings.tile) || {}) });

// ---------- streamer mode: what's on screen may be seen by viewers ----------
const STREAM_DEFAULTS = { name: true, tag: true, icon: false, level: false, note: false, ranks: false, wallet: true, login: true };
const STREAM_KEYS = ['name', 'tag', 'icon', 'level', 'note', 'ranks', 'wallet', 'login'];
const streaming = () => !!(S.settings && S.settings.streamer);
const hides = k => streaming() && !!({ ...STREAM_DEFAULTS, ...((S.settings && S.settings.streamerHide) || {}) })[k];
// shown instead of the Riot name: the note (if visible), else "Account 3"
function dispName(a) {
  const real = a.gameName === 'Gespeicherter Login' ? t('tile.savedLogin') : a.gameName;
  if (!hides('name') && !(a.placeholder && !a.tagLine && hides('login'))) return real;
  if (a.note && !hides('note')) return a.note;
  return t('stream.alias', { n: S.accounts.findIndex(x => x.puuid === a.puuid) + 1 });
}
const dispTag = a => (hides('tag') || hides('name') ? '' : a.tagLine || '');
const fullName = a => dispName(a) + (dispTag(a) ? '#' + dispTag(a) : '');

// phase of the League client as text; phases without a translation are shown readable
function phaseName(p) {
  const key = 'phase.' + (p || 'None');
  return I18N.STRINGS.en[key] ? t(key) : String(p || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

const decayInfo = a => RankMath.decayInfo(a, S.active);
function scoreToLabel(v) {
  const r = RankMath.scoreToRank(v);
  return r.plus ? tierName('MASTER') + '+' : tierName(r.tier) + ' ' + r.division;
}

// ---------- rendering ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const num = n => (n == null ? '–' : n.toLocaleString(locale()));

function rankRow(label, r, showWr = true) {
  if (r && !TIERS.includes(r.tier) && !(r.wins + r.losses)) r = null;   // placeholder tier before placements
  if (!r) return `<div class="rank"><span class="ph"></span><div><div class="q">${label}</div><div class="t"><i>${t('tile.unranked')}</i></div></div></div>`;
  const div = APEX.includes(r.tier) ? '' : ' ' + r.division;
  const head = `<img src="${crestUrl(r.tier)}" alt="">
    <div><div class="q">${label}</div><div class="t">${tierName(r.tier)}${div} <i>· ${r.lp} LP</i></div></div>`;
  if (!showWr) return `<div class="rank">${head}</div>`;
  if (r.wl === false) {
    return `<div class="rank" title="${esc(t('tile.wlUnknown'))}">${head}<div class="wr"><b>–</b>${t('tile.wins', { n: r.wins })}</div></div>`;
  }
  const games = r.wins + r.losses;
  if (!games) return `<div class="rank">${head}</div>`;
  const wr = Math.round(100 * r.wins / games);
  const cls = wr >= 53 ? 'good' : wr <= 47 ? 'bad' : '';
  return `<div class="rank" title="${esc(t('tile.wlTitle', { w: r.wins, l: r.losses }) + (r.wlStale ? t('tile.wlStale') : ''))}">${head}
    <div class="wr"><b class="${cls}">${wr}%</b>${t('tile.games', { n: games })}</div></div>`;
}

const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';

function lockHtml(a, o) {
  if (!o.lock) return '';
  if (a.credBroken) return `<span class="lock broken" title="${esc(t('tile.lockBroken'))}">${LOCK}</span>`;
  return a.hasCred || a.placeholder ? `<span class="lock ready" title="${esc(t('tile.lockTitle'))}">${CHECK}</span>` : '';
}

// only real penalties (same rule as riot.rs is_penalty)
const isPenalty = code => /leaver|ban|suspension|lockout|dodge|penalty|timed|lowpriority|ranked_restricted/i.test(code || '');
// "4:32", "2 h 05 min", or a date for long ones
function leftText(until) {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000));
  if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  if (s < 86400) return Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min';
  return t('pen.until', { date: new Date(until).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
}
// the penalty or queue wait of an account that runs out last (low priority queue, leaver lock, …)
function tilePenalty(a) {
  const now = Date.now();
  // the low priority queue has its own line (games / minutes per game), not a countdown
  const lowP = c => /lowpriority/i.test(c || '');
  const list = ((a.penalties && a.penalties.list) || []).filter(p => isPenalty(p.code) && !lowP(p.code) && (!p.until || p.until > now));
  const live = S.live || {};
  if (live.clientUp && live.puuid === a.puuid) for (const w of live.waits || []) if (w.until > now && !lowP(w.code)) list.push({ code: w.code || 'LowPriorityQueue', until: w.until });
  return list.sort((x, y) => (y.until || Infinity) - (x.until || Infinity))[0] || null;
}
// "2 games · 1 min each" (whatever is known)
function lowPrioText(lp) {
  const parts = [];
  if (lp.games) parts.push(t('pen.games', { n: lp.games }));
  if (lp.perGame) parts.push(t('pen.perGame', { m: Math.max(1, Math.round(lp.perGame / 60)) }));
  return parts.join(' · ');
}
function tilePenHtml(a) {
  const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  if (a.lowPrio) return `<div class="tile-pen" title="${esc(t('restrict.LowPriorityQueue'))}">${CLOCK}<span>${esc(t('pen.lowPrio'))}</span>${lowPrioText(a.lowPrio) ? `<b>${esc(lowPrioText(a.lowPrio))}</b>` : ''}</div>`;
  const p = tilePenalty(a);
  if (!p) return '';
  const left = p.until ? `<b data-until="${p.until}">${esc(p.until - Date.now() < 86400000 ? t('pen.left', { t: leftText(p.until) }) : leftText(p.until))}</b>` : '';
  return `<div class="tile-pen" title="${esc(reasonText({ code: p.code, args: p.args }))}">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>${esc(t(/lowpriority/i.test(p.code) ? 'pen.lowPrio' : 'pen.short'))}</span>${left}</div>`;
}
// the PBE has no ranked queues: a test server box instead of two "Unranked"
function pbeHtml() {
  return `<div class="pbe-box"><svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/></svg>
    <div><b>${t('tile.pbeTitle')}</b><span>${t('tile.pbeText')}</span></div></div>`;
}

function tileHtml(a, o = tileOpt(), preview = false) {
  if (a.placeholder) return placeholderHtml(a, o);
  const pbe = a.region === 'PBE';
  const active = a.puuid === S.active;
  const p = a.profile || {};
  const extras = [];
  if (o.lastPlayed && a.lastPlayed) extras.push(`<span>${t('tile.lastPlayed', { ago: ago(a.lastPlayed) })}</span>`);
  const dc = o.inactive && !hides('ranks') ? decayInfo(a) : null;
  if (dc) extras.push(`<span class="decay${dc.days <= 3 ? ' bad' : dc.days <= 7 ? ' warn' : ''}" title="${esc(dc.est ? t('tile.decayEstT', { n: dc.bank }) : t('tile.decayT'))}">${
    (dc.days <= 0 ? t('tile.decayNow') : t(dc.est ? 'tile.decayEst' : 'tile.decayIn', { d: dc.days })) + (dc.q === 'Flex' ? ' (Flex)' : '')}</span>`);
  if (o.wallet && p.be != null && !hides('wallet')) extras.push(`<span><b class="be">${num(p.be)}</b> BE</span><span><b class="rp">${num(p.rp)}</b> RP</span>`);
  const draggable = !preview;
  const showLvl = o.level && !hides('level');
  const rk = o.ranked && !hides('ranks') ? rankedBlock(a) : '';
  return `<div class="tile ${active ? 'active' : ''}" data-id="${esc(a.puuid)}" draggable="${draggable}">
    ${active ? `<span class="badge">${t('tile.active')}</span>` : ''}
    ${o.server && a.region ? `<span class="srv${a.region === 'PBE' ? ' pbe' : ''}${active ? ' low' : ''}" title="${esc(t('tile.server'))}">${esc(a.region)}</span>` : ''}
    ${lockHtml(a, o)}
    <button class="more" data-more title="${esc(t('common.more'))}">${DOTS}</button>
    ${o.icon ? `<div class="avatar">
      ${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : '<div class="ph"></div>'}
      ${showLvl && a.level ? `<span class="level">${a.level}</span>` : ''}
    </div>` : `<div class="no-avatar"></div>`}
    <div class="name" title="${esc(fullName(a))}">${esc(dispName(a))}${o.tag && dispTag(a) ? `<small>#${esc(dispTag(a))}</small>` : ''}</div>
    ${!o.icon && showLvl && a.level ? `<div class="lvl-line">Level ${a.level}</div>` : ''}
    ${o.note && !hides('note') ? `<div class="note" data-note>${esc(a.note || '')}</div>` : '<div data-note></div>'}
    ${preview ? '' : tilePenHtml(a)}
    ${rk}
    ${pbe ? (QUEUES.some(([k]) => o[k]) ? pbeHtml() : '') : hides('ranks') ? `<div class="stream-hidden">${t('stream.ranksHidden')}</div>` : rk && !QUEUES.some(([k]) => o[k] && a[k]) ? '' : QUEUES.some(([k]) => o[k]) ? `<div class="ranks">${QUEUES.filter(([k]) => o[k]).map(([k, n]) => rankRow(n, a[k], o.winrate)).join('')}</div>` : ''}
    ${extras.length ? `<div class="tile-extra">${extras.join('')}</div>` : ''}
  </div>`;
}

// masked login names (no Riot ID given): revealed on demand, never stored in plain text
const revealed = new Map();
function placeholderHtml(a, o = tileOpt()) {
  const masked = !a.tagLine && !a.credBroken && !hides('login') && !hides('name');
  const shown = masked && revealed.has(a.puuid);
  const label = dispName(a);
  const nameHtml = masked
    ? `<span class="masked">${esc(shown ? revealed.get(a.puuid) : label)}</span><button class="reveal" data-reveal title="${esc(shown ? t('tile.hideLogin') : t('tile.showLogin'))}">${shown ? EYE_OFF : EYE}</button>`
    : `${esc(label)}${dispTag(a) ? `<small>#${esc(dispTag(a))}</small>` : ''}`;
  return `<div class="tile pending" data-id="${esc(a.puuid)}" draggable="true">
    <span class="badge new">${t('tile.new')}</span>
    ${lockHtml(a, o)}
    <button class="more" data-more title="${esc(t('common.more'))}">${DOTS}</button>
    <div class="avatar"><div class="ph q">?</div></div>
    <div class="name${masked ? ' with-eye' : ''}">${nameHtml}</div>
    <div class="note" data-note>${hides('note') ? '' : esc(a.note || '')}</div>
    <div class="first-login">
      <svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
      <b>${t('tile.notLoggedIn')}</b>
      <span>${t('tile.firstLogin')}</span>
    </div>
  </div>`;
}

async function toggleReveal(id) {
  if (revealed.has(id)) revealed.delete(id);
  else { const u = await api.getCredUser(id); if (u) revealed.set(id, u); }
  render();
}

// ---------- categories ----------
let renameCat = null;      // category whose name is being edited
let dragging = false;
const cats = () => S.categories || [];
const catOf = a => (a.category && cats().some(c => c.id === a.category)) ? a.category : '';

// how the accounts are shown: big tiles, small tiles, or one row each
const layout = () => (S.settings && S.settings.layout) || 'tiles';
// one account as a row of the list view (the same .tile class: clicks, menus, dragging and picking work alike)
function rowRank(r) {
  if (r && !TIERS.includes(r.tier) && !(r.wins + r.losses)) r = null;
  if (!r) return `<span class="r-cell un">${t('tile.unranked')}</span>`;
  const games = r.wins + r.losses, wr = games && r.wl !== false ? Math.round(100 * r.wins / games) : null;
  return `<span class="r-cell"><img src="${crestUrl(r.tier)}" alt=""><b>${tierName(r.tier)}${APEX.includes(r.tier) ? '' : ' ' + r.division}</b> <i>${r.lp} LP</i>${wr != null ? ` <em class="${wr >= 53 ? 'good' : wr <= 47 ? 'bad' : ''}">${wr} %</em>` : ''}</span>`;
}
function rowHtml(a, o = tileOpt()) {
  const active = a.puuid === S.active;
  const p = a.profile || {};
  const pen = tilePenHtml(a);
  const cells = [];
  if (o.server) cells.push(`<span class="c-srv${a.region === 'PBE' ? ' pbe' : ''}">${esc(a.region || '')}</span>`);
  if (a.placeholder) cells.push(`<span class="c-first">${t('tile.notLoggedIn')}</span>`);
  else if (hides('ranks')) cells.push(`<span class="c-first">${t('stream.ranksHidden')}</span>`);
  else for (const [k] of QUEUES.filter(([k]) => o[k])) cells.push(`<span class="c-rank" title="${esc(QUEUES.find(q => q[0] === k)[1])}">${a.region === 'PBE' ? '' : rowRank(a[k])}</span>`);
  if (o.wallet && p.be != null && !hides('wallet')) cells.push(`<span class="c-wallet"><b class="be">${num(p.be)}</b> BE · <b class="rp">${num(p.rp)}</b> RP</span>`);
  if (o.lastPlayed) cells.push(`<span class="c-last">${a.lastPlayed ? esc(ago(a.lastPlayed)) : ''}</span>`);
  return `<div class="tile row ${active ? 'active' : ''}${a.placeholder ? ' pending' : ''}" data-id="${esc(a.puuid)}" draggable="true">
    ${o.icon ? `<span class="c-av">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : ''}${o.level && !hides('level') && a.level ? `<i>${a.level}</i>` : ''}</span>` : ''}
    <span class="c-name"><b title="${esc(fullName(a))}">${esc(dispName(a))}${o.tag && dispTag(a) ? `<small>#${esc(dispTag(a))}</small>` : ''}</b>${active ? `<span class="badge">${t('tile.active')}</span>` : ''}
      ${o.note && !hides('note') && a.note ? `<span class="note" data-note>${esc(a.note)}</span>` : '<span data-note></span>'}</span>
    ${pen ? `<span class="c-pen">${pen}</span>` : ''}
    ${cells.join('')}
    ${lockHtml(a, o)}
    <button class="more" data-more title="${esc(t('common.more'))}">${DOTS}</button>
  </div>`;
}
function gridHtml(cat, list) {
  const lay = layout();
  return `<div class="grid ${lay}" data-cat="${esc(cat)}">${list.length ? list.map(a => (lay === 'list' ? rowHtml(a) : tileHtml(a))).join('')
    : `<div class="cat-empty">${t('cat.dropHere')}</div>`}</div>`;
}
function sectionHtml(c, list) {
  const nameHtml = renameCat === c.id
    ? `<input class="cat-input" data-cat-input maxlength="32" value="${esc(c.name)}">`
    : `<span class="cat-name" data-cat-name title="${esc(t('cat.rename'))}">${esc(c.name)}</span>`;
  return `<section class="cat${c.collapsed ? ' collapsed' : ''}" data-cat="${esc(c.id)}">
    <div class="cat-head">
      <button class="chev" data-cat-toggle title="${esc(c.collapsed ? t('cat.expand') : t('cat.collapse'))}">${CHEV}</button>
      ${nameHtml}<span class="cat-count">${list.length}</span>
      <span class="cat-line"></span>
      <button class="cat-more" data-cat-more title="${esc(t('cat.menu'))}">${DOTS}</button>
    </div>
    ${c.collapsed ? '' : gridHtml(c.id, list)}
  </section>`;
}
function renderBoard() {
  const accs = sortList(filterList(S.accounts));
  const searching = !!$('search').value.trim();
  if (searching && !accs.length) { $('board').innerHTML = `<div class="no-hits">${t('noHits')}</div>`; return; }
  if (!cats().length) { $('board').innerHTML = accs.length ? gridHtml('', accs) : ''; return; }
  const loose = accs.filter(a => !catOf(a));
  // tiles without a category come first, above all categories
  $('board').innerHTML = ((loose.length || dragging) ? `<section class="cat loose" data-cat="">
        <div class="cat-head"><span class="cat-name plain">${t('cat.none')}</span><span class="cat-count">${loose.length}</span><span class="cat-line"></span></div>
        ${gridHtml('', loose)}</section>` : '')
    + cats().filter(c => !searching || accs.some(a => catOf(a) === c.id))
      .map(c => sectionHtml(c, accs.filter(a => catOf(a) === c.id))).join('');
  const inp = document.querySelector('[data-cat-input]');
  if (inp) { inp.focus(); inp.select(); }
}
function finishRename(save) {
  const inp = document.querySelector('[data-cat-input]');
  const id = renameCat;
  renameCat = null;
  if (save && inp && id) api.catRename(id, inp.value); else render();
}
// order + category of every tile -> main process
function arrange(list) {
  S.accounts = list.map(x => Object.assign(S.accounts.find(a => a.puuid === x.puuid), { category: x.category || undefined }));
  render();
  api.arrange(list);
}
function moveTo(id, cat, beforeId) {
  const list = S.accounts.filter(a => a.puuid !== id).map(a => ({ puuid: a.puuid, category: catOf(a) }));
  let at = beforeId ? list.findIndex(x => x.puuid === beforeId) : -1;
  if (at < 0) {   // end of that category (or end of the list)
    let last = -1;
    list.forEach((x, i) => { if (x.category === cat) last = i; });
    at = last >= 0 ? last + 1 : list.length;
  }
  list.splice(at, 0, { puuid: id, category: cat });
  arrange(list);
}

// ---------- search, sorting ----------
function filterList(list) {
  const q = $('search').value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(a => [a.gameName, a.tagLine, a.note].some(x => (x || '').toLowerCase().includes(q)));
}
function queueScore(q) { return q ? rankScore(q) : -1; }
const sortMode = () => (S.settings && S.settings.sort) || 'level';
function sortList(list) {
  const mode = sortMode();
  const by = {
    level: (x, y) => (y.level || 0) - (x.level || 0) || queueScore(y.solo) - queueScore(x.solo),
    rank: (x, y) => queueScore(y.solo) - queueScore(x.solo),
    flex: (x, y) => queueScore(y.flex) - queueScore(x.flex),
    played: (x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0),
    name: (x, y) => (x.gameName || '').localeCompare(y.gameName || '', locale()),
  }[mode];
  return by ? [...list].sort(by) : list;
}

// ---------- dates, decay ----------
function ago(ts) {
  if (!ts) return t('common.unknown');
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) { const h = Math.floor((Date.now() - ts) / 3600000); return h <= 0 ? t('ago.now') : t('ago.hours', { n: h }); }
  return d === 1 ? t('ago.yesterday') : t('ago.days', { n: d });
}
function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'; }
// Diamond+ loses LP when inactive; warn after two weeks without a game
function decayWarning(a) {
  if (!a.solo || TIERS.indexOf(a.solo.tier) < TIERS.indexOf('DIAMOND') || !a.lastPlayed) return 0;
  const d = Math.floor((Date.now() - a.lastPlayed) / DAY);
  return d >= 14 ? d : 0;
}

// ---------- ranked readiness ----------
// Ranked needs level 30 and 20 owned champions. When the account was logged in,
// Riot's own answer (incl. bans, leaver locks …) is used on top.
const OWN_REASONS = ['PlayerMinLevelRestriction', 'PlayerAvailableChampionRestriction'];
function reasonText(x) {
  // a LeaverBuster message about the low priority queue reads like the queue wait itself
  if (/^LeaverBuster.*low/i.test(x.code || '')) x = { ...x, code: 'LowPriorityQueue' };
  const args = x.args || {};
  const n = args.playerMinLevelRestriction || args.playerAvailableChampionRestriction;
  const key = 'restrict.' + x.code;
  const known = I18N.STRINGS.en[key];
  const txt = known ? t(key, { n: n || (x.code === 'PlayerMinLevelRestriction' ? 30 : 20) })
    : String(x.code || '').replace(/Restriction$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
      + (Object.values(args).filter(v => /^\d+$/.test(String(v))).length ? ' (' + Object.values(args).filter(v => /^\d+$/.test(String(v))).join('/') + ')' : '');
  return txt + (x.until > Date.now() ? t('rk.until', { date: new Date(x.until).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }) : '');
}
function rankedStatus(a) {
  // the PBE has no ranked queues at all: nothing to be "ready" for
  if (a.placeholder || a.level == null || a.region === 'PBE') return null;
  const champs = a.profile && a.profile.champs;
  const lvlOk = a.level >= 30;
  const chOk = champs == null ? null : champs >= 20;
  // older saved checks may still hold lobby ("Team…") reasons: they don't concern the account
  const clean = x => {
    if (!x) return x;
    // ("Unknown", "GameVersion…", "in a game": the client couldn't check – says nothing about the account)
    const reasons = (x.reasons || []).filter(r => !/^Team|^Unknown$|^GameVersion|^PlayerInGameRestriction$/.test(r.code || ''));
    return { ...x, reasons, ok: x.ok || reasons.length === 0 };
  };
  const rc = a.rankedCheck && Object.fromEntries(Object.entries(a.rankedCheck).map(([k, v]) => [k, k === 'at' ? v : clean(v)]));
  const ranked = QUEUES.some(([k]) => a[k]);
  // 10 normal Summoner's Rift games (new accounts); counted from the match history
  const normals = a.normals ? a.normals.count : null;
  // a rank or any ranked game in the history = unlocked; otherwise count recent normals
  const nOk = ranked || (a.normals && a.normals.hasRanked) ? true : normals == null ? null : normals >= 10;
  // Riot's check counts, unless level/champions have changed since (then our numbers are newer)
  const riotOnlyOwn = rc && rc.solo && rc.solo.reasons.every(x => OWN_REASONS.includes(x.code));
  let ready;
  if (rc && rc.solo && !(riotOnlyOwn && lvlOk && chOk)) ready = rc.solo.ok;
  else if (ranked) ready = true;     // already has a rank
  else ready = lvlOk && chOk !== false ? (chOk ? true : null) : false;
  if (ready !== false && nOk === false) ready = false;
  return { ready, lvlOk, chOk, nOk, normals, ranked, level: a.level, champs, rc };
}
function rankedBlock(a) {
  const st = rankedStatus(a);
  if (!st || st.ready !== false) return '';
  const bar = (v, max) => `<span class="bar"><i style="width:${Math.min(100, Math.round(100 * v / max))}%"></i></span>`;
  const extra = st.rc && st.rc.solo ? st.rc.solo.reasons.filter(x => !OWN_REASONS.includes(x.code)).map(reasonText) : [];
  return `<div class="rk-block" title="${esc(t('rk.title'))}">
    <div class="rk-title">${t('rk.notReady')}</div>
    ${st.lvlOk ? '' : `<div class="rk-row"><span>${t('rk.level')}</span>${bar(st.level, 30)}<b>${st.level}/30</b></div>`}
    ${st.chOk === false ? `<div class="rk-row"><span>${t('rk.champs')}</span>${bar(st.champs, 20)}<b>${st.champs}/20</b></div>` : ''}
    ${st.nOk === false ? `<div class="rk-row" title="${esc(t('rk.normalsNote'))}"><span>${t('rk.normals')}</span>${bar(st.normals, 10)}<b>${st.normals}/10</b></div>` : ''}
    ${extra.map(x => `<div class="rk-row warn">${esc(x)}</div>`).join('')}
  </div>`;
}
function rankedChecklist(a) {
  const st = rankedStatus(a);
  if (!st) return '';
  const row = (ok, label, val) => `<div class="ck ${ok === true ? 'ok' : ok === false ? 'no' : 'na'}"><span class="ico">${ok === true ? '✓' : ok === false ? '✕' : '?'}</span>${label}<b>${val}</b></div>`;
  const q = (name, x) => !x ? row(null, t('rk.riot', { q: name }), t('rk.afterLogin'))
    : row(x.ok, t('rk.riot', { q: name }), x.ok ? t('rk.cleared') : esc(x.reasons.map(reasonText).join(', ') || t('rk.blocked')));
  return `<h3>${t('rk.section')} ${st.rc ? '<i>' + t('rk.riotAsOf', { date: fmtDate(st.rc.at) }) + '</i>' : ''}</h3>
    <div class="checklist">
      ${row(st.lvlOk, t('rk.lvl30'), st.level + '/30')}
      ${row(st.chOk, t('rk.champs20'), st.champs == null ? t('rk.afterLogin') : st.champs + '/20')}
      ${row(st.nOk, t('rk.normals10'), st.nOk === true && (st.ranked || st.normals < 10) ? t('rk.cleared') : st.normals == null ? t('rk.afterLogin') : st.normals + '/10')}
      ${QUEUES.map(([k, n]) => q(n, st.rc && st.rc[k])).join('')}
    </div>`;
}

// ---------- open with ----------
const SITE_REGION = {
  short: { EUW: 'euw', EUNE: 'eune', NA: 'na', KR: 'kr', BR: 'br', LAN: 'lan', LAS: 'las', OCE: 'oce', OC1: 'oce', TR: 'tr', RU: 'ru', JP: 'jp' },
  ugg: { EUW: 'euw1', EUNE: 'eun1', NA: 'na1', KR: 'kr', BR: 'br1', LAN: 'la1', LAS: 'la2', OCE: 'oc1', OC1: 'oc1', TR: 'tr1', RU: 'ru', JP: 'jp1' },
};
function siteUrl(a, site) {
  const R = (a.region || 'EUW').toUpperCase();
  const r = SITE_REGION.short[R] || 'euw';
  const id = encodeURIComponent(a.gameName + '-' + a.tagLine);
  const low = id.toLowerCase();
  return {
    opgg: `https://op.gg/lol/summoners/${r}/${id}`,
    poro: `https://porofessor.gg/live/${r}/${low}`,
    log: `https://www.leagueofgraphs.com/summoner/${r}/${id}`,
    moba: `https://mobalytics.gg/lol/profile/${r}/${low}/overview`,
    ugg: `https://u.gg/lol/profile/${SITE_REGION.ugg[R] || 'euw1'}/${low}/overview`,
  }[site];
}
function openSite(a, site) { const u = siteUrl(a, site); if (u) api.openExternal(u); }

// ---------- profile window ----------
const CHAMP_ICON = id => `${CDRAGON}/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;
const SITES = [['opgg', 'op.gg'], ['poro', 'Porofessor'], ['log', 'League of Graphs'], ['moba', 'Mobalytics'], ['ugg', 'u.gg']];
let profileFor = null;
let profileHistory = [];
let profileEst = {};

// LP estimate: from the oldest real data point (or the current rank) walk back through
// the ranked games we have seen: every win was about +20 LP, every loss about -20 LP.
function lpEstimate(a, games, history) {
  const est = {};
  for (const key of ['solo', 'flex']) {
    const first = (history || []).find(e => e[key]);
    const anchor = first ? { t: first.t, v: rankScore(first[key]) } : a[key] ? { t: Date.now(), v: rankScore(a[key]) } : null;
    if (!anchor) continue;
    const older = (games || []).filter(g => g.q === key && g.t < anchor.t).sort((x, y) => y.t - x.t);
    if (!older.length) continue;
    const pts = [anchor];
    let v = anchor.v;
    for (const g of older) { v -= g.win ? 20 : -20; pts.push({ t: g.t, v }); }
    est[key] = pts.reverse();
  }
  return est;
}

function historyChart(h, est = {}, small = false) {
  const pts = (h || []).filter(e => e.solo || e.flex);
  const series = {};
  for (const key of ['solo', 'flex']) {
    series[key] = { rec: pts.filter(e => e[key]).map(e => ({ t: e.t, v: rankScore(e[key]) })), est: est[key] || [] };
  }
  const all = [...series.solo.rec, ...series.solo.est, ...series.flex.rec, ...series.flex.est];
  if (all.length < 2) return `<div class="chart-empty">${t('p.historyEmpty')}</div>`;
  const W = small ? 300 : 520, H = small ? 110 : 150, P = 8;
  const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(Math.max(...all.map(p => p.t)), t0 + 1);
  let lo = Math.min(...all.map(p => p.v)), hi = Math.max(...all.map(p => p.v));
  lo = Math.floor((lo - 30) / 100) * 100; hi = Math.ceil((hi + 30) / 100) * 100;
  const x = ts => P + (W - 2 * P) * ((ts - t0) / Math.max(1, t1 - t0));
  const y = v => H - P - (H - 2 * P) * ((v - lo) / Math.max(1, hi - lo));
  const poly = (list, cls) => list.length > 1 ? `<polyline class="${cls}" points="${list.map(p => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ')}"/>` : '';
  let grid = '';
  const step = hi - lo > 1200 ? 400 : 100;
  for (let v = lo; v <= hi; v += step) {
    if (v < 0 || v >= 2800) continue;
    grid += `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - P}" y="${y(v) - 3}">${scoreToLabel(v)}</text>`;
  }
  const hasEst = series.solo.est.length || series.flex.est.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${poly(series.flex.est, 'l-flex est')}${poly(series.solo.est, 'l-solo est')}${poly(series.flex.rec, 'l-flex')}${poly(series.solo.rec, 'l-solo')}</svg>
    <div class="chart-legend"><span class="k solo"></span>Solo/Duo <span class="k flex"></span>Flex${hasEst ? ` <span class="k est"></span>${t('p.estimated')}` : ''} <i>${fmtDate(t0)} – ${fmtDate(t1)}</i></div>`;
}

function renderProfile() {
  const a = S.accounts.find(x => x.puuid === profileFor);
  if (!a) { $('profileBox').hidden = true; return; }
  const p = a.profile || {};
  const stat = (label, val, sub) => `<div class="stat"><b>${val}</b><span>${label}</span>${sub ? '<i>' + sub + '</i>' : ''}</div>`;
  const idle = decayWarning(a);
  $('profileCard').innerHTML = `
    <button class="icon pclose" data-pclose title="${esc(t('common.close'))}"><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9"/></svg></button>
    <div class="p-head">
      <div class="avatar">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : '<div class="ph"></div>'}${a.level && !hides('level') ? `<span class="level">${a.level}</span>` : ''}</div>
      <div>
        <h2>${esc(dispName(a))}${dispTag(a) ? `<small>#${esc(dispTag(a))}</small>` : ''}</h2>
        <div class="p-sub">${esc(a.region || '')}${a.note && !hides('note') ? ' · <span class="gold">' + esc(a.note) + '</span>' : ''}</div>
        <div class="p-sub ${idle ? 'warn' : ''}">${t('p.lastPlayed', { ago: ago(a.lastPlayed) })}${a.lastPlayed ? ' (' + fmtDate(a.lastPlayed) + ')' : ''}${idle ? t('p.decay') : ''}</div>
      </div>
    </div>
    ${hides('ranks') ? `<div class="chart-empty">${t('stream.ranksHidden')}</div>` : `<div class="ranks two">${QUEUES.map(([k, n]) => rankRow(n, a[k])).join('')}</div>
    ${rankedChecklist(a)}
    <h3>${t('p.history')}</h3>
    ${historyChart(profileHistory, profileEst)}`}
    <h3>${t('p.account')} ${p.at ? '<i>' + t('p.asOf', { date: fmtDate(p.at) }) + '</i>' : ''}</h3>
    ${p.at ? `<div class="stats">
      ${stat(t('p.be'), hides('wallet') ? '•••' : num(p.be))}${stat(t('p.rp'), hides('wallet') ? '•••' : num(p.rp))}
      ${stat(t('p.champs'), num(p.champs), p.champsTotal ? t('p.of', { n: p.champsTotal }) : '')}${stat(t('p.skins'), num(p.skins))}
      ${stat(t('p.honor'), p.honor == null ? '–' : t('p.honorLvl', { n: p.honor }))}${stat(t('p.mastery'), num(p.masteryScore))}
    </div>
    ${(p.topMastery || []).length ? `<div class="top-m">${p.topMastery.map(m => `<div class="tm"><img src="${CHAMP_ICON(m.id)}" alt=""><b>${t('p.mLevel', { n: m.level })}</b><span>${t('p.points', { n: num(m.points) })}</span></div>`).join('')}</div>` : ''}`
    : `<div class="chart-empty">${t('p.loadLater')}</div>`}
    <div class="p-actions">
      <span class="p-open">${t('p.openWith')}</span>${SITES.map(([k, n]) => `<button class="chip" data-site="${k}">${n}</button>`).join('')}
      <span class="grow"></span>
      ${a.puuid === S.active && S.live && S.live.puuid === a.puuid ? '' : `<button class="btn gold" data-pswitch>${t('p.switch')}</button>`}
    </div>`;
  $('profileBox').hidden = false;
}
async function openProfile(id) {
  profileFor = id;
  profileHistory = []; profileEst = {};
  renderProfile();
  profileHistory = await api.getHistory(id);
  const acc = S.accounts.find(x => x.puuid === id);
  profileEst = acc ? lpEstimate(acc, await api.rankedGames(id), profileHistory) : {};
  if (profileFor === id) renderProfile();
}
function closeProfile() { profileFor = null; $('profileBox').hidden = true; }
$('profileBox').addEventListener('click', e => {
  if (e.target === $('profileBox') || e.target.closest('[data-pclose]')) return closeProfile();
  const a = S.accounts.find(x => x.puuid === profileFor);
  const site = e.target.closest('[data-site]');
  if (site && a) return openSite(a, site.dataset.site);
  if (e.target.closest('[data-pswitch]')) { const id = profileFor; closeProfile(); switchTo(id); }
});

// ---------- tile editor ----------
let teOpen = false;
// sample for the preview: the active account, else the one with the most data
function previewAccount() {
  const real = S.accounts.filter(a => !a.placeholder);
  return real.find(a => a.puuid === S.active) || real.sort((x, y) => (!!y.solo - !!x.solo) || ((y.level || 0) - (x.level || 0)))[0]
    || { puuid: 'preview', gameName: 'Summoner', tagLine: 'EUW', level: 120, iconId: 29, note: 'Main',
      solo: { tier: 'GOLD', division: 'II', lp: 54, wins: 48, losses: 41 }, flex: null, lastPlayed: Date.now() - 2 * DAY };
}
function renderTileEditor() {
  if (!teOpen) return;
  const o = tileOpt();
  $('tePreview').innerHTML = tileHtml(previewAccount(), o, true);
  $('teOptions').innerHTML = TILE_GROUPS.map(([g, keys]) => `<div class="te-group"><div class="te-g">${t(g)}</div>
    ${keys.map(k => `<label class="te-opt"><input type="checkbox" data-tile="${k}" ${o[k] ? 'checked' : ''}><span class="cb"></span>${t('te.' + k)}</label>`).join('')}</div>`).join('');
}
function openTileEditor() { teOpen = true; $('tileEditor').hidden = false; renderTileEditor(); }
function closeTileEditor() { teOpen = false; $('tileEditor').hidden = true; }
$('teOptions').addEventListener('change', e => {
  const k = e.target.dataset.tile;
  if (!k) return;
  const o = { ...tileOpt(), [k]: e.target.checked };
  S.settings = { ...S.settings, tile: o };    // instant feedback, main confirms
  render();
  api.setSetting('tile', o);
});
$('teReset').onclick = () => { S.settings = { ...S.settings, tile: { ...TILE_DEFAULTS } }; render(); api.setSetting('tile', { ...TILE_DEFAULTS }); };
$('teDone').onclick = closeTileEditor;
$('tileEditor').addEventListener('click', e => { if (e.target === $('tileEditor')) closeTileEditor(); });
$('editTiles').onclick = openTileEditor;
const SUPPORT_URL = 'https://buymeacoffee.com/zlizz3r';
$('supportBtn').onclick = () => api.openExternal(SUPPORT_URL);
$('navCoffee').onclick = () => api.openExternal(SUPPORT_URL);
$('openTileEditor').onclick = () => { openSettings(false); openTileEditor(); };

// ---------- streamer mode settings ----------
function renderStreamOptions() {
  const h = { ...STREAM_DEFAULTS, ...((S.settings && S.settings.streamerHide) || {}) };
  const box = $('streamOpts');
  box.hidden = !streamOpen;
  $('streamExpand').classList.toggle('open', streamOpen);
  $('streamExpand').title = streamOpen ? t('set.lessOpts') : t('set.moreOpts');
  box.classList.toggle('off', !streaming());
  box.innerHTML = `<div class="te-g">${t('stream.hides')}</div>` + STREAM_KEYS.map(k =>
    `<label class="te-opt"><input type="checkbox" data-stream="${k}" ${h[k] ? 'checked' : ''}><span class="cb"></span>${t('stream.' + k)}</label>`).join('');
}
$('streamOpts').addEventListener('change', e => {
  const k = e.target.dataset.stream;
  if (!k) return;
  const h = { ...STREAM_DEFAULTS, ...((S.settings && S.settings.streamerHide) || {}), [k]: e.target.checked };
  S.settings = { ...S.settings, streamerHide: h };
  render();
  api.setSetting('streamerHide', h);
});
let streamOpen = false;
$('streamExpand').onclick = () => { streamOpen = !streamOpen; renderStreamOptions(); };
$('streamPill').onclick = () => { S.settings = { ...S.settings, streamer: false }; render(); api.setSetting('streamer', false); };

// ---------- settings ----------
function openSettings(open) {
  $('settingsDrawer').classList.toggle('open', open);
  $('navSettings').classList.toggle('active', open);
  if (open) openDrawer(false);
  syncPush();
}
// an open side panel pushes the overview to the right instead of covering it
function syncPush() {
  document.querySelector('.body').classList.toggle('pushed',
    $('drawer').classList.contains('open') || $('settingsDrawer').classList.contains('open'));
}
document.querySelectorAll('[data-setting]').forEach(cb => cb.onchange = () => api.setSetting(cb.dataset.setting, cb.checked));
$('langSelect').innerHTML = I18N.LANGS.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
$('langSelect').onchange = () => {
  const l = $('langSelect').value;
  S.settings = { ...S.settings, lang: l };
  render();
  api.setSetting('lang', l);
};

$('scaleSelect').onchange = () => {
  const v = $('scaleSelect').value;
  S.settings = { ...S.settings, uiScale: v };
  api.setSetting('uiScale', v);
};
// export / import of accounts, categories and settings (logins and sessions stay on this PC)
$('exportBtn').onclick = async () => {
  // with saved logins only when protected by a password of its own
  const pass = await passBox({ title: t('set.export'), text: t('pw.exportText'), ok: t('pw.withLogins'),
    confirm: true, min: 8, skip: t('pw.withoutLogins') });
  if (pass === null) return;
  const r = await api.dataExport(pass === 'skip' ? null : pass);
  if (r && r.ok) toast(t('set.exported', { n: r.n }));
  else if (r && r.error) toast(t('set.ioFailed', { e: r.error }), true);
};
$('importBtn').onclick = async () => {
  let r = await api.dataImport();
  if (r && r.needPass) {
    const pass = await passBox({ title: t('set.import'), text: t('pw.importText'), ok: t('set.import'),
      skip: t('pw.withoutLogins'), check: async v => ((await api.checkImportPass(v)) ? null : t('pw.wrong')) });
    if (pass === null) return;
    r = await api.dataImport(pass === 'skip' ? 'skip' : pass);
  }
  if (r && r.ok && r.logins) toast(t('pw.loginsImported', { n: r.logins }));
  if (r && r.ok) toast(t('set.imported', { n: r.added, m: r.updated }));
  else if (r && r.error) toast(t(r.error === 'format' ? 'set.badFile' : r.error === 'pass' ? 'pw.wrong' : 'set.ioFailed', { e: r.error }), true);
};

// version + update state (Settings > About)
function renderUpdate() {
  const u = S.update || {};
  $('updVer').textContent = t('upd.version', { v: S.version || '' });
  $('updText').textContent = u.status === 'error' ? t('upd.error') : u.status === 'off' || !u.status ? t('upd.off')
    : t('upd.' + u.status, { v: u.version || '' });
  $('updBtn').hidden = !['ready', 'current', 'error', 'idle'].includes(u.status);
  $('updBtn').textContent = u.status === 'ready' ? t('upd.install') : t('upd.check');
  $('updBtn').classList.toggle('gold', u.status === 'ready');
}
$('updBtn').onclick = () => api.update(S.update && S.update.status === 'ready' ? 'install' : 'check');

// ---------- app lock ----------
function renderLock() {
  $('lockSub').textContent = S.hasLock ? t('lock.onSub') : t('lock.offSub');
  $('lockRow').hidden = !S.hasLock;
  $('sealBtn').hidden = !S.hasLock;
  $('sealSub').textContent = t(S.sealLogins ? 'seal.onSub' : 'seal.offSub');
  $('lockBtn').querySelector('.opt-title').textContent = S.hasLock ? t('lock.change') : t('lock.title');
  document.body.classList.toggle('locked', !!S.locked);
  if (S.locked && !unlocking) askUnlock();
}
let unlocking = false;
async function askUnlock() {
  unlocking = true;
  $('settingsDrawer').classList.remove('open'); $('drawer').classList.remove('open');
  await passBox({ title: t('lock.locked'), text: t('lock.enter'), ok: t('lock.unlock'), noCancel: true,
    check: async v => ((await api.unlock(v)) ? null : t('pw.wrong')) });
  unlocking = false;
}
$('lockBtn').onclick = async () => {
  let old = null;
  if (S.hasLock) { old = await passBox({ title: t('lock.change'), text: t('lock.current'), ok: t('common.next') }); if (old === null) return; }
  const p = await passBox({ title: t('lock.title'), text: t('lock.setText'), ok: t('common.save'), confirm: true, min: 4 });
  if (p === null) return;
  toast((await api.lock('set', p, old)) ? t('lock.saved') : t('pw.wrong'), false);
};
$('lockNow').onclick = () => api.lock('now');
$('sealBtn').onclick = async () => {
  const on = !S.sealLogins;
  const p = await passBox({ title: t('seal.title'), text: t(on ? 'seal.askOn' : 'seal.askOff'), ok: t('common.ok') });
  if (p === null) return;
  toast((await api.lock(on ? 'seal' : 'unseal', p)) ? t(on ? 'seal.done' : 'seal.undone') : t('pw.wrong'), false);
};
$('lockOff').onclick = async () => {
  const p = await passBox({ title: t('lock.off'), text: t('lock.current'), ok: t('lock.off') });
  if (p !== null) toast((await api.lock('off', p)) ? t('lock.removed') : t('pw.wrong'));
};

function render() {
  try { renderMain(); } finally { if (window.afterRender) window.afterRender(); }
}
function renderMain() {
  applyStaticTexts();
  document.querySelectorAll('[data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === layout()));
  $('cryptoWarn').hidden = !S.cryptoBroken;
  const accs = S.accounts;
  $('empty').hidden = accs.length > 0;
  renderBoard();

  const live = S.live || {};
  const cur = accs.find(a => a.puuid === live.puuid);
  const el = $('live');
  el.className = 'live' + (live.clientUp ? ' on' : '');
  const wait = (live.waits || []).filter(w => w.until > Date.now()).sort((a, b) => b.until - a.until)[0];
  el.innerHTML = live.clientUp
    ? `<span><span class="dot"></span>${esc(cur ? dispName(cur) : t('app.unknownAccount'))} · ${esc(phaseName(live.phase))}`
      + (wait ? ` · <b class="wait" data-until="${wait.until}" data-fmt="wait" title="${esc(reasonText({ code: wait.code }))}">${esc(t('pen.wait', { t: leftText(wait.until) }))}</b>` : '') + '</span>'
    : `<span><span class="dot"></span>${S.busy ? t('app.switching') : t('app.closed')}</span>`;

  const unknownLive = live.clientUp && !cur;
  $('optCurrent').disabled = !unknownLive;
  $('optCurrentSub').textContent = !live.clientUp ? t('add.notOpen')
    : cur ? t('add.already', { name: dispName(cur) }) : t('add.takeOver');

  $('pending').hidden = !S.pendingAdd || !!S.login;
  renderSwitching(S.switching);
  renderLogin(S.login);
  const st = S.settings || {};
  document.querySelectorAll('[data-setting]').forEach(cb => (cb.checked = !!st[cb.dataset.setting]));
  renderStreamOptions();
  renderUpdate();
  renderLock();
  $('streamPill').hidden = !streaming();
  document.body.classList.toggle('streaming', streaming());
  $('sort').value = sortMode();
  $('scaleSelect').value = String(st.uiScale || '100');
  if (profileFor) renderProfile();
  renderTileEditor();
  if (S.saveError && S.saveError !== shownSaveError) toast(t('saveFailed', { e: S.saveError }), true);
  shownSaveError = S.saveError;
}

// the steps of a login in progress (hidden by the user: until the next one)
let swHidden = 0;
const SW_KEYS = { close: 'sw.close', client: 'sw.client', signin: 'sw.signin', play: 'sw.play', launch: 'sw.launch' };
function renderSwitching(sw) {
  const show = !!sw && sw.n !== swHidden;
  $('swBox').hidden = !show;
  if (!show) return;
  const a = S.accounts.find(x => x.puuid === sw.id);
  $('swName').textContent = a ? fullName(a) : '';
  $('swAv').innerHTML = a && a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : '';
  const cur = sw.step === 'done' ? sw.steps.length : sw.steps.indexOf(sw.step);
  $('swBar').style.width = Math.round(100 * (cur + (sw.step === 'done' ? 0 : 0.5)) / sw.steps.length) + '%';
  $('swSteps').innerHTML = sw.steps.map((k, i) => {
    const st = i < cur ? 'done' : i === cur ? 'now' : '';
    const label = k === 'signin' && sw.detail && i === cur ? t('sw.signin_' + sw.detail) : t(SW_KEYS[k] || k);
    return `<li class="${st}"><span class="sw-dot">${st === 'done' ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</span>${esc(label)}</li>`;
  }).join('');
}
$('swHide').onclick = () => { swHidden = S.switching ? S.switching.n : 0; renderSwitching(S.switching); };
$('swCancel').onclick = () => api.cancelSwitch();

function renderLogin(l) {
  // while the steps screen runs, only a failure needs its own box
  if (l && l.stage !== 'failed' && S.switching && S.switching.n !== swHidden) l = null;
  $('loginBox').hidden = !l;
  if (!l) return;
  const failed = l.stage === 'failed';
  const stage = ['wait', 'typing', 'verify', 'check'].includes(l.stage) ? l.stage : 'wait';
  $('loginTitle').textContent = failed ? t('login.failed') : t('login.' + stage, { name: l.name || '' });
  $('loginText').textContent = failed ? (l.msgKey ? t(l.msgKey) : (l.msg || '')) + t('login.manual') : t('login.' + stage + 'T', { name: l.name || '' });
  $('loginSpin').hidden = failed || l.stage === 'check';
  $('loginFail').hidden = !failed;
  $('loginDismiss').textContent = failed ? t('common.close') : t('common.hide');
}

// ---------- actions ----------
let toastTimer;
function toast(msg, err) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast' + (err ? ' err' : '')), 3200);
}
// errors from the main process come as keys (m.*), older ones as plain text
const errText = r => (r.errorKey ? t(r.errorKey) : r.error);

// danger: text of a big red warning above the question; the safe button gets the focus then
function confirmBox(title, text, yes = t('common.anyway'), danger = '') {
  return new Promise(res => {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yes;
    $('confirmDanger').hidden = !danger;
    $('confirmDangerText').textContent = danger;
    $('confirm').classList.toggle('danger', !!danger);
    $('confirm').hidden = false;
    (danger ? $('confirmNo') : $('confirmYes')).focus();
    const done = v => { $('confirm').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

// asks for a password. o: { title, text, ok, confirm (type twice), skip (label of a 3rd button),
// min (minimum length), check (async v => error text or null) }. Resolves the password, 'skip' or null.
function passBox(o) {
  return new Promise(res => {
    $('passTitle').textContent = o.title;
    $('passText').textContent = o.text || '';
    $('passOk').textContent = o.ok || t('common.ok');
    $('passAgainRow').hidden = !o.confirm;
    $('passSkip').hidden = !o.skip;
    $('passSkip').textContent = o.skip || '';
    $('passCancel').hidden = !!o.noCancel;
    $('passIn').value = $('passAgain').value = '';
    $('passErr').hidden = true;
    $('passBox').hidden = false;
    $('passIn').focus();
    const err = m => { $('passErr').textContent = m; $('passErr').hidden = false; };
    const done = v => { $('passBox').hidden = true; $('passForm').onsubmit = $('passSkip').onclick = $('passCancel').onclick = null; res(v); };
    $('passForm').onsubmit = async e => {
      e.preventDefault();
      const v = $('passIn').value;
      if (v.length < (o.min || 1)) return err(t('pw.short', { n: o.min || 1 }));
      if (o.confirm && v !== $('passAgain').value) return err(t('pw.mismatch'));
      if (o.check) { const m = await o.check(v); if (m) { $('passIn').select(); return err(m); } }
      done(v);
    };
    $('passSkip').onclick = () => done('skip');
    $('passCancel').onclick = () => done(null);
  });
}

async function guardRunningGame() {
  const p = S.live && S.live.phase;
  if (!RISKY.includes(p)) return true;
  return confirmBox(t('sw.risky', { phase: t('phase.' + p) }), p === 'ChampSelect' ? t('sw.dodge') : t('sw.abort'));
}

async function switchTo(id) {
  if (S.busy) return;
  if (id === S.active && S.live && S.live.puuid === id) return toast(t('sw.already'));
  const a = S.accounts.find(x => x.puuid === id);
  const p = S.live && S.live.phase;
  if (RISKY.includes(p)) {
    // in champ select / in game: always ask, with the warning
    if (!(await guardRunningGame())) return;
  } else if (!S.settings || S.settings.confirmSwitch !== false) {
    const name = a ? fullName(a) : t('sw.this');
    const ok = await confirmBox(t('sw.confirm', { name }), S.live && S.live.clientUp ? t('sw.restart') : t('sw.start'), t('sw.btn'));
    if (!ok) return;
  }
  toast(t('sw.to', { name: a ? dispName(a) : '…' }));
  const r = await api.switchTo(id);
  if (!r.ok) toast(errText(r), true); else toast(t('sw.starting'));
}

function openDrawer(open) {
  if (open) openSettings(false);
  $('drawer').classList.toggle('open', open);
  $('navAdd').classList.toggle('active', open);
  $('navAccounts').classList.toggle('active', !open && !$('settingsDrawer').classList.contains('open') && (typeof view === 'undefined' || view === 'accounts'));
  syncPush();
}

function showMenu(id, x, y) {
  menuFor = id;
  const a = S.accounts.find(acc => acc.puuid === id);
  const here = a ? catOf(a) : '';
  const targets = cats().filter(c => c.id !== here).map(c => [c.id, c.name]);
  if (here) targets.unshift(['', t('cat.none')]);
  $('menuCats').innerHTML = targets.length
    ? `<hr><div class="menu-label">${t('menu.moveTo')}</div>` + targets.map(([cid, n]) => `<button data-act="move" data-cat="${esc(cid)}">${esc(n)}</button>`).join('')
    : '';
  $('menu').querySelectorAll('[data-real]').forEach(el => (el.hidden = !a || !!a.placeholder));
  const m = $('menu');
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - h - 8) + 'px';
}

function editNote(id) {
  const tile = document.querySelector(`.tile[data-id="${CSS.escape(id)}"]`);
  const a = S.accounts.find(x => x.puuid === id);
  if (!tile || !a) return;
  const slot = tile.querySelector('[data-note]');
  slot.className = 'note';
  slot.innerHTML = `<input class="note-edit" maxlength="24" placeholder="${esc(t('menu.notePh'))}">`;
  const inp = slot.querySelector('input');
  inp.value = a.note || '';
  inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v !== (a.note || '')) { a.note = v; api.setNote(id, v); }
    inp.blur();
    render();
  };
  inp.addEventListener('click', e => e.stopPropagation());
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}

// ---------- events ----------
$('board').addEventListener('click', e => {
  const sec = e.target.closest('section.cat');
  if (sec && e.target.closest('[data-cat-toggle]')) return api.catToggle(sec.dataset.cat);
  if (sec && e.target.closest('[data-cat-more]')) {
    const b = e.target.closest('[data-cat-more]').getBoundingClientRect();
    return showCatMenu(sec.dataset.cat, b.left, b.bottom + 4);
  }
  const tile = e.target.closest('.tile');
  if (!tile) return;
  if (e.target.closest('[data-more]')) {
    const r = e.target.closest('[data-more]').getBoundingClientRect();
    return showMenu(tile.dataset.id, r.left, r.bottom + 4);
  }
  if (e.target.closest('input')) return;
  if (e.target.closest('[data-reveal]')) return toggleReveal(tile.dataset.id);
  const id = tile.dataset.id, now = Date.now();
  if (e.ctrlKey || e.metaKey || e.shiftKey) { lastTileClick = { id: null, t: 0 }; return pickTile(id, e.shiftKey); }
  if (picked.size) { picked.clear(); lastPick = null; }
  if (lastTileClick.id === id && now - lastTileClick.t < 450) { lastTileClick = { id: null, t: 0 }; return switchTo(id); }
  lastTileClick = { id, t: now };
  selectAccount(id);
});
let lastTileClick = { id: null, t: 0 };
$('board').addEventListener('dblclick', e => {
  const tile = e.target.closest('.tile');
  if (tile) return;   // handled in the click handler above
  const sec = e.target.closest('section.cat');
  if (sec && sec.dataset.cat && e.target.closest('[data-cat-name]')) { renameCat = sec.dataset.cat; render(); }
});
$('board').addEventListener('keydown', e => {
  if (!e.target.matches('[data-cat-input]')) return;
  if (e.key === 'Enter') finishRename(true);
  if (e.key === 'Escape') { e.stopPropagation(); finishRename(false); }
});
$('board').addEventListener('focusout', e => { if (e.target.matches('[data-cat-input]')) finishRename(true); });
$('board').addEventListener('contextmenu', e => {
  const head = e.target.closest('.cat-head');
  const hsec = head && head.closest('section.cat');
  if (hsec && hsec.dataset.cat) { e.preventDefault(); return showCatMenu(hsec.dataset.cat, e.clientX, e.clientY); }
  const tile = e.target.closest('.tile');
  if (!tile) return;
  e.preventDefault();
  showMenu(tile.dataset.id, e.clientX, e.clientY);
});

$('menu').addEventListener('click', async e => {
  if (e.target.closest('.sub-btn')) return;   // just opens the submenu
  const btn = e.target.closest('[data-act]');
  const act = btn && btn.dataset.act;
  const id = menuFor;
  $('menu').hidden = true;
  if (!act || !id) return;
  const a = S.accounts.find(x => x.puuid === id);
  if (act === 'switch') switchTo(id);
  if (act === 'note') editNote(id);
  if (act === 'move') moveTo(id, btn.dataset.cat || '');
  if (act === 'cred') openCred(id);
  if (act === 'open' && a) openSite(a, btn.dataset.site);
  if (act === 'profile') openProfile(id);
  if (act === 'remove' && a && await confirmBox(t('menu.removeTitle', { name: dispName(a) }), t('menu.removeText'), t('menu.remove'))) {
    api.remove(id);
  }
});
let catMenuFor = null;
function showCatMenu(id, x, y) {
  catMenuFor = id;
  const i = cats().findIndex(c => c.id === id);
  $('catMenu').querySelector('[data-cact=up]').hidden = i <= 0;
  $('catMenu').querySelector('[data-cact=down]').hidden = i >= cats().length - 1;
  const m = $('catMenu');
  m.hidden = false;
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
}
$('catMenu').addEventListener('click', async e => {
  const act = e.target.dataset.cact, id = catMenuFor;
  $('catMenu').hidden = true;
  const c = cats().find(x => x.id === id);
  if (!act || !c) return;
  if (act === 'rename') { renameCat = id; render(); }
  if (act === 'up') api.catMove(id, -1);
  if (act === 'down') api.catMove(id, 1);
  if (act === 'del') {
    const n = S.accounts.filter(a => catOf(a) === id).length;
    if (!n || await confirmBox(t('cat.delTitle', { name: c.name }), n === 1 ? t('cat.delOne') : t('cat.delMany', { n }), t('common.delete'))) api.catDel(id);
  }
});
$('addCat').onclick = async () => {
  const id = await api.catAdd(t('cat.new'));
  renameCat = id;
  // the state push from main renders the new section with its name field open
};
document.addEventListener('click', e => {
  if (!e.target.closest('.menu') && !e.target.closest('[data-more]')) $('menu').hidden = true;
  if (!e.target.closest('#catMenu') && !e.target.closest('[data-cat-more]')) $('catMenu').hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  $('menu').hidden = true; openDrawer(false); openSettings(false); closeProfile(); closeTileEditor();
  if (!$('credBox').hidden) closeCred();
});

// drag tiles: a gold line shows where the tile will slide in (before or after the tile under the
// mouse); dropping on an empty part of a category puts it at the end of that category
let dragId = null;
function clearDrop() { document.querySelectorAll('.drop, .ins-before, .ins-after').forEach(x => x.classList.remove('drop', 'ins-before', 'ins-after')); }
// the tile under the mouse and which side of it the mouse is on
function dropSpot(e) {
  const tile = e.target.closest('.tile');
  if (!tile || tile.dataset.id === dragId) return { tile: null };
  const r = tile.getBoundingClientRect();
  if (tile.classList.contains('row')) return { tile, after: e.clientY > r.top + r.height / 2 };
  return { tile, after: e.clientX > r.left + r.width / 2 };
}
// the account the dragged tile goes in front of (null = end of the category)
function beforeIdOf(spot) {
  if (!spot.tile) return null;
  if (!spot.after) return spot.tile.dataset.id;
  let n = spot.tile.nextElementSibling;
  while (n && (!n.classList.contains('tile') || n.dataset.id === dragId)) n = n.nextElementSibling;
  return n ? n.dataset.id : null;
}
$('board').addEventListener('dragstart', e => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  dragId = tile.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  // show the "No category" drop zone while dragging
  setTimeout(() => { dragging = true; render(); document.querySelector(`.tile[data-id="${CSS.escape(dragId)}"]`)?.classList.add('dragging'); }, 0);
});
$('board').addEventListener('dragend', () => { dragId = null; dragging = false; render(); });
$('board').addEventListener('dragover', e => {
  if (!dragId) return;
  const sec = e.target.closest('[data-cat]');
  if (!sec) return;
  e.preventDefault();
  clearDrop();
  const spot = dropSpot(e);
  if (spot.tile) spot.tile.classList.add(spot.after ? 'ins-after' : 'ins-before');
  else if (!e.target.closest('.tile')) (sec.closest('section.cat') || sec).classList.add('drop');
});
$('board').addEventListener('drop', e => {
  if (!dragId) return;
  const sec = e.target.closest('[data-cat]');
  if (!sec) return;
  e.preventDefault();
  const spot = dropSpot(e);
  const onSelf = !spot.tile && e.target.closest('.tile');
  const before = beforeIdOf(spot);
  const id = dragId;
  dragId = null; dragging = false;
  clearDrop();
  if (onSelf) return render();
  // moving a tile by hand = your own order from now on, starting from what you see
  if (sortMode() !== 'custom') {
    S.accounts = sortList(S.accounts);
    S.settings = { ...S.settings, sort: 'custom' };
    api.setSetting('sort', 'custom');
    toast(t('drag.toCustom'));
  }
  moveTo(id, sec.dataset.cat || '', before);
});

$('min').onclick = () => api.win('min');
$('toTray').onclick = async () => {
  const r = await api.win('tray');
  if (r && r.hint) { toast(t('tray.balloon')); setTimeout(() => api.win('tray'), 2600); }
};
// quitting: a short notice that closes the app by itself (nothing to click away)
let quitting = false;
$('close').onclick = () => {
  if (quitting) return;
  quitting = true;
  $('quitBox').hidden = false;
  void $('quitBox').offsetWidth;                       // let it lay out first, so the bar can animate
  setTimeout(() => $('quitBox').classList.add('run'), 30);
  setTimeout(() => api.win('quit'), 2600);
};
$('navAccounts').onclick = () => { openDrawer(false); openSettings(false); };
$('navSettings').onclick = () => openSettings(!$('settingsDrawer').classList.contains('open'));
$('settingsClose').onclick = () => openSettings(false);
$('search').addEventListener('input', render);
$('sort').onchange = () => api.setSetting('sort', $('sort').value);
api.onTraySwitch(id => stateReady.then(() => switchTo(id)));   // a freshly opened window loads its state first
api.onToast(key => toast(t(key)));
$('addAcc').onclick = () => openDrawer(!$('drawer').classList.contains('open'));
$('navAdd').onclick = () => openDrawer(!$('drawer').classList.contains('open'));
$('emptyAdd').onclick = () => openDrawer(true);
$('drawerClose').onclick = () => openDrawer(false);
$('toolRefresh').onclick = async () => {
  if (!S.live || !S.live.clientUp) return toast(t('refresh.later'));
  const r = await api.refresh();
  toast(r && r.busy ? t('refresh.busy') : t('refresh.done'));
};
$('optCurrent').onclick = async () => {
  const r = await api.addCurrent();
  if (r.ok) { openDrawer(false); toast(t('add.currentSaved')); } else toast(errText(r), true);
};
$('addForm').onsubmit = async e => {
  e.preventDefault();
  const riotId = $('addRiotId').value.trim(), u = $('addUser').value.trim(), p = $('addPass').value;
  // a Riot ID (or profile link) alone is enough; a login needs both fields
  if ((!u || !p) && (u || p || !riotId)) return toast(t('add.fill'), true);
  const r = await api.addSaved({ riotId, u, p });
  if (!r.ok) return toast(errText(r), true);
  $('addRiotId').value = $('addUser').value = $('addPass').value = '';
  openDrawer(false);
  if (r.puuid) selectAccount(r.puuid);
  toast(r.existed ? t('add.existed') : r.noLogin ? t(r.found ? 'add.idFound' : 'add.idLater')
    : r.found ? t('add.savedFound') : r.riotId ? t('add.savedLater') : t('add.saved'));
};
$('optManual').onclick = async () => {
  if (!(await guardRunningGame())) return;
  openDrawer(false);
  const r = await api.addNew(null);
  if (!r.ok) toast(errText(r), true);
};

// the saved password of the login details: shown after Windows Hello (PIN, fingerprint …)
// confirms it's you – or the app password where Windows Hello isn't set up
async function revealSaved() {
  const a = S.accounts.find(x => x.puuid === credFor);
  if (!a || !a.hasCred) return false;
  let r = await api.revealPass(credFor);
  if (r && r.noHello) {
    if (!S.hasLock) { toast(t('reveal.noHello'), true); return true; }
    const p = await passBox({ title: t('cred.title'), text: t('reveal.askApp'), ok: t('reveal.show') });
    if (p === null) return true;
    r = await api.revealPass(credFor, p);
    if (!(r && r.ok)) { toast(t('pw.wrong'), true); return true; }
  }
  if (r && r.ok) { $('credPass').value = r.p; $('credPass').type = 'text'; }
  return true;
}
// show / hide password
document.querySelectorAll('[data-eye]').forEach(b => b.onclick = async () => {
  if (b.dataset.eye === 'credPass' && !$('credPass').value && $('credPass').type === 'password' && await revealSaved()) return;
  const inp = $(b.dataset.eye);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  b.classList.toggle('on', inp.type === 'text');
});

// login details for an existing account
let credFor = null;
async function openCred(id) {
  const a = S.accounts.find(x => x.puuid === id);
  if (!a) return;
  credFor = id;
  $('credFor').textContent = fullName(a);
  $('credUser').value = a.hasCred ? await api.getCredUser(id) : '';
  $('credUser').type = hides('login') ? 'password' : 'text';   // login name not readable on stream
  $('credPass').value = '';
  $('credPass').type = 'password';
  $('credPass').placeholder = a.hasCred ? t('cred.keep') : '';
  $('credDelete').hidden = !a.hasCred;
  // the Riot ID: shown when known (Riot's, can't be changed); a saved account without one can get it here
  const known = !!(a.gameName && a.tagLine);
  $('credRiotId').value = known ? (hides('name') ? '••••••' : a.gameName + (hides('tag') ? '' : '#' + a.tagLine)) : '';
  $('credRiotId').readOnly = known;
  $('credRiotRow').classList.toggle('ro', known);
  $('credBox').hidden = false;
  ($('credUser').value ? $('credPass') : $('credUser')).focus();
}
function closeCred() { $('credBox').hidden = true; $('credPass').value = ''; credFor = null; }
$('credCancel').onclick = closeCred;
$('credForm').onsubmit = async e => {
  e.preventDefault();
  const riotId = $('credRiotId').readOnly ? '' : $('credRiotId').value.trim();
  const r = await api.setCred(credFor, { u: $('credUser').value, p: $('credPass').value, riotId });
  if (!r.ok) return toast(errText(r), true);
  closeCred(); toast(riotId ? t(r.found ? 'add.savedFound' : 'add.savedLater') : t('cred.saved'));
};
$('credDelete').onclick = async () => {
  const id = credFor;
  closeCred();
  await api.delCred(id); toast(t('cred.deleted'));
};
$('loginDismiss').onclick = () => api.dismissLogin();
$('cancelAdd').onclick = () => api.cancelAdd();

// Don't rebuild the board while the user types a note / category name or drags a tile:
// that would wipe the input. Catch up as soon as they're done.
let renderLater = false;
const editing = () => dragId || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#board input'));
api.onState(s => {
  S = s;
  if (editing()) { renderLater = true; return; }
  render();
});
document.addEventListener('focusout', () => setTimeout(() => { if (renderLater && !editing()) { renderLater = false; render(); } }, 0));
$('board').addEventListener('dragend', () => { if (renderLater) { renderLater = false; render(); } });
const stateReady = api.getState().then(s => { S = s; render(); });

// ---------- settings: groups fold open on click, one at a time ----------
(function foldSettings() {
  const drawer = $('settingsDrawer');
  for (const head of [...drawer.querySelectorAll('.set-g')]) {
    const body = document.createElement('div');
    body.className = 'set-body';
    let n = head.nextElementSibling;
    while (n && !n.classList.contains('set-g') && !n.classList.contains('legal')) { const next = n.nextElementSibling; body.appendChild(n); n = next; }
    head.after(body);
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    // the text moves into its own span (the translation only replaces that), the arrow next to it
    const key = head.dataset.i18n;
    head.removeAttribute('data-i18n');
    head.innerHTML = '<span></span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    head.firstChild.dataset.i18n = key;
    head.firstChild.textContent = t(key);
    const toggle = () => {
      const open = !head.classList.contains('open');
      drawer.querySelectorAll('.set-g.open').forEach(h => h.classList.remove('open'));
      if (open) head.classList.add('open');
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
})();

// ---------- help pages ("?"): "## " heading, "- " list item, other lines paragraphs ----------
const HELP_TITLES = { keys: 'keys.title', helper: 'live.helper', tools: 'tools.title', live: 'live.title', mh: 'mh.title' };
function openHelp(topic) {
  const lines = t('help.' + topic).split('\n');
  let html = '', list = false;
  for (const l of lines) {
    const li = l.startsWith('- ');
    if (list && !li) { html += '</ul>'; list = false; }
    if (l.startsWith('## ')) html += `<h3>${esc(l.slice(3))}</h3>`;
    else if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${esc(l.slice(2))}</li>`; }
    else if (l.trim()) html += `<p>${esc(l)}</p>`;
  }
  if (list) html += '</ul>';
  $('helpTitle').textContent = t(HELP_TITLES[topic] || 'help.open');
  $('helpBody').innerHTML = html;
  $('helpBox').hidden = false;
  $('helpClose').focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-help]');
  if (b) { e.preventDefault(); e.stopPropagation(); openHelp(b.dataset.help); }
}, true);
$('helpClose').onclick = () => ($('helpBox').hidden = true);
$('helpBox').addEventListener('click', e => { if (e.target === $('helpBox')) $('helpBox').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('helpBox').hidden) { e.stopPropagation(); $('helpBox').hidden = true; } }, true);
