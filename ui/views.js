// Views on top of renderer.js: appearance, the auto-accept switch, the right detail panel,
// and the Live / Tools pages. Uses the globals of renderer.js (S, t, $, esc, api, …).

// ---------- appearance: system / light / dark ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = (S.settings && S.settings.theme) || 'system';
  const theme = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  $('themeSelect').value = pref;
}
darkQuery.addEventListener('change', applyTheme);
$('themeSelect').onchange = () => {
  S.settings = { ...S.settings, theme: $('themeSelect').value };
  applyTheme();
  api.setSetting('theme', $('themeSelect').value);
};

// ---------- auto-accept in the title bar ----------
$('aaToggle').onchange = () => {
  S.settings = { ...S.settings, autoAccept: $('aaToggle').checked };
  api.setSetting('autoAccept', $('aaToggle').checked);
};

// ---------- pages: Accounts / Live / Tools ----------
let view = 'accounts';
function showView(v) {
  view = v;
  openDrawer(false); openSettings(false);
  $('viewAccounts').hidden = v !== 'accounts';
  $('viewLive').hidden = v !== 'live';
  $('viewDash').hidden = v !== 'dash';
  $('viewColl').hidden = v !== 'coll';
  $('viewTools').hidden = v !== 'tools';
  $('viewMatches').hidden = v !== 'matches';
  $('detail').hidden = v !== 'accounts';
  $('navAccounts').classList.toggle('active', v === 'accounts');
  $('navLive').classList.toggle('active', v === 'live');
  $('navDash').classList.toggle('active', v === 'dash');
  $('navColl').classList.toggle('active', v === 'coll');
  $('navTools').classList.toggle('active', v === 'tools');
  $('navMatches').classList.toggle('active', v === 'matches');
  if (v === 'live') pollLive(true);
  if (v === 'matches') { renderMatches(); loadMatches(); }
  if (v === 'dash') { renderDash(); loadDash(); if (typeof showDashTab === 'function') showDashTab(dashTab()); }
  if (v === 'coll') { renderColl(); loadColl(); }
}
$('navAccounts').onclick = () => showView('accounts');
// tiles / small tiles / list
document.querySelector('.layout-seg').addEventListener('click', e => {
  const b = e.target.closest('[data-layout]');
  if (!b) return;
  S.settings = { ...S.settings, layout: b.dataset.layout };
  render();
  api.setSetting('layout', b.dataset.layout);
});
$('navLive').onclick = () => showView('live');
$('navDash').onclick = () => showView('dash');
$('navColl').onclick = () => showView('coll');
$('navTools').onclick = () => showView('tools');
$('navMatches').onclick = () => showView('matches');

// ---------- several accounts at once ----------
let picked = new Set(), lastPick = null;
// Ctrl+click: add/remove one tile; Shift+click: every tile between the last picked one and this one
function pickTile(id, range) {
  if (!picked.size && selectedId && selectedId !== id) picked.add(selectedId);   // the open one counts
  const order = [...document.querySelectorAll('#board .tile[data-id]')].map(x => x.dataset.id);
  if (range && (lastPick || selectedId) && order.includes(lastPick || selectedId)) {
    const [i, j] = [order.indexOf(lastPick || selectedId), order.indexOf(id)].sort((x, y) => x - y);
    order.slice(i, j + 1).forEach(x => picked.add(x));
  } else if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  lastPick = id;
  if (picked.size === 1) { selectedId = [...picked][0]; picked.clear(); }
  render();
}
function pickedAccounts() { return S.accounts.filter(a => picked.has(a.puuid)); }
function clearPicks() { if (picked.size) { picked.clear(); lastPick = null; render(); } }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && picked.size && !document.querySelector('.overlay:not([hidden])')) clearPicks(); });
// a short text (note) – resolves to the text, or null when cancelled
function askText(title, placeholder, max) {
  return new Promise(res => {
    $('textTitle').textContent = title;
    $('textIn').value = '';
    $('textIn').placeholder = placeholder || '';
    $('textIn').maxLength = max || 64;
    $('textBox').hidden = false;
    $('textIn').focus();
    const done = v => { $('textBox').hidden = true; $('textForm').onsubmit = $('textCancel').onclick = null; res(v); };
    $('textForm').onsubmit = e => { e.preventDefault(); done($('textIn').value.trim()); };
    $('textCancel').onclick = () => done(null);
  });
}

// drawing a box over the board (mouse held on an empty spot) picks every tile it covers by more
// than half; Ctrl/Shift keep the tiles picked before
let box = null;
$('board').addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('.tile, button, input, select, a, [data-cat-name], [data-cat-toggle], [data-cat-more]')) return;
  e.preventDefault();
  const el = document.createElement('div');
  el.className = 'select-box';
  document.body.appendChild(el);
  box = { x: e.clientX, y: e.clientY, el, keep: e.ctrlKey || e.metaKey || e.shiftKey, hits: [] };
});
document.addEventListener('mousemove', e => {
  if (!box) return;
  const r = { l: Math.min(box.x, e.clientX), t: Math.min(box.y, e.clientY), r: Math.max(box.x, e.clientX), b: Math.max(box.y, e.clientY) };
  Object.assign(box.el.style, { left: r.l + 'px', top: r.t + 'px', width: r.r - r.l + 'px', height: r.b - r.t + 'px' });
  box.hits = [];
  for (const tl of document.querySelectorAll('#board .tile[data-id]')) {
    const q = tl.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.r, q.right) - Math.max(r.l, q.left)), h = Math.max(0, Math.min(r.b, q.bottom) - Math.max(r.t, q.top));
    const hit = q.width > 0 && q.height > 0 && w > 0 && h > 0;
    tl.classList.toggle('box-hit', hit);
    if (hit) box.hits.push(tl.dataset.id);
  }
});
document.addEventListener('mouseup', () => {
  if (!box) return;
  const { el, hits, keep } = box;
  box = null;
  el.remove();
  document.querySelectorAll('.box-hit').forEach(x => x.classList.remove('box-hit'));
  if (!hits.length) return;
  if (!keep) picked.clear();
  hits.forEach(id => picked.add(id));
  lastPick = hits[hits.length - 1];
  if (picked.size === 1) { selectedId = [...picked][0]; picked.clear(); }
  render();
});

// all picked tiles into one category (one save)
// several accounts on one site: op.gg's multi-search (5 Riot IDs of one server), else a tab each
function openMany(list, site) {
  const named = list.filter(x => !x.placeholder && x.gameName && x.tagLine);
  if (!named.length) return;
  if (site === 'multi') {
    if (named.length > 5) toast(t('multi.first5'));
    return api.openMulti(named[0].region || 'euw', named.slice(0, 5).map(x => x.gameName + '#' + x.tagLine));
  }
  named.forEach(x => openSite(x, site));
}
function moveMany(ids, cat) {
  const set = new Set(ids);
  const list = S.accounts.map(a => ({ puuid: a.puuid, category: set.has(a.puuid) ? cat : catOf(a) }));
  arrange(list);
}
function renderMulti() {
  const list = pickedAccounts();
  document.querySelectorAll('.tile.selected, .tile.picked').forEach(el => el.classList.remove('selected', 'picked'));
  list.forEach(a => document.querySelector(`.tile[data-id="${CSS.escape(a.puuid)}"]`)?.classList.add('picked'));
  const ic = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  $('detail').innerHTML = `
    <div class="m-head"><h2>${t('multi.title', { n: list.length })}</h2><span class="info" title="${esc(t('multi.hint'))}">?</span></div>
    <div class="m-list">${list.map(a => `<div class="m-acc"><span class="m-av">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : ''}</span><span>${esc(dispName(a))}</span></div>`).join('')}</div>
    <div class="d-actions m-actions">
      <button data-m="note">${ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>')}<span>${t('d.edit')}</span></button>
      <button data-m="move">${ic('<path d="M3 7h7l2 2h9v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>')}<span>${t('d.move')}</span></button>
      <button data-m="open">${ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')}<span>${t('menu.openWith')}</span></button>
      <button data-m="remove" class="danger">${ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}<span>${t('menu.remove')}</span></button>
    </div>
    <button class="btn wide m-clear" data-m="clear">${t('multi.clear')}</button>`;
}

// ---------- right detail panel ----------
let selectedId = null;
let detailData = { id: null, hist: [], est: {} };
function selectAccount(id) {
  selectedId = id;
  render();
}
function selected() {
  return S.accounts.find(a => a.puuid === selectedId) || S.accounts.find(a => a.puuid === S.active) || S.accounts[0];
}
// Riot's own decay counter (signed-in account only); fallback: our inactivity guess
function decayText(a) {
  const dc = decayInfo(a);
  if (dc) return (dc.days <= 0 ? t('tile.decayNow') : t(dc.est ? 'tile.decayEst' : 'tile.decayIn', { d: dc.days })) + ' (' + dc.q + ')';
  const idle = decayWarning(a);
  return idle ? t('d.inactive', { d: idle }) : '';
}
async function loadDetailChart(a) {
  const key = a && a.puuid + '|' + (a.historyLen || 0) + '|' + ((a.rankedGames || []).length);
  if (!a || a.placeholder || detailData.key === key) return;
  detailData = { id: a.puuid, key, hist: detailData.id === a.puuid ? detailData.hist : [], est: detailData.id === a.puuid ? detailData.est : {} };
  const [hist, games] = await Promise.all([api.getHistory(a.puuid), api.rankedGames(a.puuid)]);
  if (detailData.id !== a.puuid) return;
  detailData = { id: a.puuid, key, hist, est: lpEstimate(a, games, hist) };
  renderDetail();
}
function renderDetail() {
  // picked tiles that no longer exist (removed) drop out
  for (const id of [...picked]) if (!S.accounts.some(a => a.puuid === id)) picked.delete(id);
  if (picked.size > 1) return renderMulti();
  document.querySelectorAll('.tile.picked').forEach(el => el.classList.remove('picked'));
  const a = selected();
  const box = $('detail');
  if (!a) { box.innerHTML = `<div class="d-empty">${t('empty.text')}</div>`; return; }
  selectedId = a.puuid;
  document.querySelectorAll('.tile.selected').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.tile[data-id="${CSS.escape(a.puuid)}"]`)?.classList.add('selected');
  const signedIn = a.puuid === S.active && S.live && S.live.puuid === a.puuid;
  const st = !a.placeholder && rankedStatus(a);
  const dec = !a.placeholder ? decayText(a) : '';
  const dci = !a.placeholder && decayInfo(a), decClose = !dci || dci.days <= 7;
  const ranks = QUEUES.filter(([k]) => a[k] || k === 'solo' || k === 'flex');
  const ic = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
  box.innerHTML = `
    <div class="d-head">
      <div class="avatar sm">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : '<div class="ph"></div>'}${a.level && !hides('level') ? `<span class="level">${a.level}</span>` : ''}</div>
      <div class="d-names">
        <h2>${esc(dispName(a))}</h2>
        <div class="p-sub">${dispTag(a) ? esc(dispName(a)) + '#' + esc(dispTag(a)) + ' · ' : ''}${esc(a.region || '')}${a.note && !hides('note') ? ' · <span class="gold">' + esc(a.note) + '</span>' : ''}</div>
      </div>
    </div>
    ${a.placeholder ? `<div class="chart-empty">${t('tile.firstLogin')}</div>` : `
    ${hides('ranks') ? `<div class="chart-empty">${t('stream.ranksHidden')}</div>` : `<div class="ranks">${ranks.map(([k, n]) => rankRow(n, a[k])).join('')}</div>`}
    <div class="d-lines">
      <div>${ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}${t('p.lastPlayed', { ago: ago(a.lastPlayed) })}</div>
      ${dec ? `<div class="${decClose ? 'warn' : ''}">${ic('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h0"/>')}${esc(dec)}</div>` : ''}
      ${st && st.ready === false ? `<div class="warn">${ic('<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8"/>')}${t('rk.notReady')}</div>` : ''}
    </div>
    ${hides('ranks') ? '' : `<div class="d-chart">${detailData.id === a.puuid ? historyChart(detailData.hist, detailData.est, true) : ''}</div>`}
    <div class="d-last" data-last="${esc(a.puuid)}">${lastOf.has(a.puuid) && lastOf.get(a.puuid).g ? `<span class="d-sec-t">${t('last.title')}</span>${gameRowShort(lastOf.get(a.puuid).g)}` : ''}</div>`}
    ${a.placeholder ? '' : `<div class="d-load"><button class="btn load-btn" data-loadall="${esc(a.puuid)}"></button></div>`}
    <button class="btn gold d-switch" id="dSwitch" title="${esc(t('d.hint'))}" ${signedIn ? 'disabled' : ''}>${ic('<path d="M7 4l12 8-12 8z"/>')}${signedIn ? t('d.signedIn') : t('d.switch')}</button>
    <div class="d-actions">
      ${a.placeholder ? '' : `<button data-d="profile">${ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')}<span>${t('d.profile')}</span></button>`}
      <button data-d="login">${ic('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>')}<span>${t('d.login')}</span></button>
      ${a.placeholder ? '' : `<button data-d="open">${ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')}<span>${t('menu.openWith')}</span></button>`}
      <button data-d="note">${ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>')}<span>${t('d.edit')}</span></button>
      <button data-d="move">${ic('<path d="M3 7h7l2 2h9v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>')}<span>${t('d.move')}</span></button>
      <button data-d="remove" class="danger">${ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}<span>${t('menu.remove')}</span></button>
    </div>
`;
  loadDetailChart(a);
  if (!a.placeholder) loadLastGame(a.puuid);
  if (typeof refreshLoadBtns === 'function') refreshLoadBtns();
}
// the newest stored game of one account (for the panel); asked again when the match history changes
const lastOf = new Map();   // puuid -> { id, g }
async function loadLastGame(puuid, again) {
  const had = lastOf.get(puuid);
  if (had && !again) return;
  lastOf.set(puuid, had || { id: null, g: null });
  const d = await api.matches({ puuid, queue: null });
  const row = d && d.index && d.index[0];
  if (!row || (had && had.id === row[0])) return;
  const [g] = (await api.matchesGet([row[0]])) || [];
  if (!g) return;
  lastOf.set(puuid, { id: row[0], g: { ...g, owners: row.slice(3) } });
  const box = document.querySelector(`#detail [data-last="${CSS.escape(puuid)}"]`);
  if (box && typeof gameRowShort === 'function') box.innerHTML = `<span class="d-sec-t">${t('last.title')}</span>${gameRowShort(lastOf.get(puuid).g)}`;
}
api.onMatchesChanged(() => { const a = selected(); if (a && !a.placeholder) loadLastGame(a.puuid, true); });
$('detail').addEventListener('click', async e => {
  const m = e.target.closest('[data-m]');
  if (m && picked.size > 1) {
    const list = pickedAccounts();
    const what = m.dataset.m;
    if (what === 'clear') return clearPicks();
    if (what === 'note') {
      // one note for all of them (empty = remove)
      const n = await askText(t('multi.noteTitle', { n: list.length }), t('menu.notePh'), 24);
      if (n === null) return;
      for (const x of list) await api.setNote(x.puuid, n);
      return toast(t('multi.noteDone', { n: list.length }));
    }
    if (what === 'open') {
      // op.gg multi-search first, then every site (one tab per account)
      e.stopPropagation();
      const menu = $('siteMenu');
      menu.innerHTML = `<button data-site="multi">${esc(t('multi.opgg'))}</button><div class="menu-sep"></div>`
        + SITES.map(([k, n]) => `<button data-site="${k}">${n}</button>`).join('');
      menu.dataset.id = '';
      menu.dataset.many = JSON.stringify(list.map(x => x.puuid));
      const r = m.getBoundingClientRect();
      menu.hidden = false;
      menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px';
      return;
    }
    if (what === 'remove') {
      if (await confirmBox(t('multi.removeTitle', { n: list.length }), t('menu.removeText'), t('menu.remove'), t('mh.clearWarn'))) {
        for (const x of list) await api.remove(x.puuid);
        picked.clear();
      }
      return;
    }
    if (what === 'move') {
      e.stopPropagation();
      const targets = [['', t('cat.none')], ...cats().map(c => [c.id, c.name])];
      const menu = $('siteMenu');
      menu.innerHTML = targets.map(([cid, n]) => `<button data-cat="${esc(cid)}">${esc(n)}</button>`).join('');
      menu.dataset.id = '';
      menu.dataset.many = JSON.stringify(list.map(x => x.puuid));
      const r = m.getBoundingClientRect();
      menu.hidden = false;
      menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px';
    }
    return;
  }
  const a = selected();
  if (!a) return;
  if (e.target.closest('#dSwitch')) return switchTo(a.puuid);
  const btn = e.target.closest('[data-d]');
  if (!btn) return;
  const act = btn.dataset.d;
  if (act === 'move' || act === 'open') e.stopPropagation();
  if (act === 'profile') openProfile(a.puuid);
  if (act === 'login') openCred(a.puuid);
  if (act === 'open') {
    const r = btn.getBoundingClientRect();
    const m = $('siteMenu');
    m.innerHTML = SITES.map(([k, n]) => `<button data-site="${k}">${n}</button>`).join('');
    m.dataset.id = a.puuid;
    m.hidden = false;
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  }
  if (act === 'note') editNote(a.puuid);
  if (act === 'move') {
    // categories to move this account to (the panel's small menu)
    const here = catOf(a);
    const targets = cats().filter(c => c.id !== here).map(c => [c.id, c.name]);
    if (here) targets.unshift(['', t('cat.none')]);
    const m = $('siteMenu');
    m.innerHTML = targets.length ? targets.map(([cid, n]) => `<button data-cat="${esc(cid)}">${esc(n)}</button>`).join('')
      : `<div class="menu-label">${t('d.noCats')}</div>`;
    m.dataset.id = a.puuid;
    const r = btn.getBoundingClientRect();
    m.hidden = false;
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  }
  if (act === 'remove' && await confirmBox(t('menu.removeTitle', { name: dispName(a) }), t('menu.removeText'), t('menu.remove'))) api.remove(a.puuid);
});

const siteMenu = document.createElement('div');
siteMenu.className = 'menu'; siteMenu.id = 'siteMenu'; siteMenu.hidden = true;
document.body.appendChild(siteMenu);
siteMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-site]');
  const c = e.target.closest('[data-cat]');
  const a = S.accounts.find(x => x.puuid === siteMenu.dataset.id);
  const p = siteMenu.dataset.player ? JSON.parse(siteMenu.dataset.player) : null;
  const many = siteMenu.dataset.many ? JSON.parse(siteMenu.dataset.many) : null;
  siteMenu.hidden = true;
  siteMenu.dataset.player = '';
  siteMenu.dataset.many = '';
  if (c && many) return moveMany(many, c.dataset.cat || '');
  if (b && many) return openMany(many.map(id => S.accounts.find(x => x.puuid === id)).filter(Boolean), b.dataset.site);
  if (b && p) openSite(p, b.dataset.site);
  else if (b && a) openSite(a, b.dataset.site);
  if (c && a) moveTo(a.puuid, c.dataset.cat || '');
});
document.addEventListener('click', e => { if (!e.target.closest('#siteMenu')) siteMenu.hidden = true; });

// ---------- Tools ----------
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = async () => {
  const what = b.dataset.tool;
  if (['closeAll', 'restart', 'clearCache'].includes(what) && RISKY.includes(S.live && S.live.phase)) {
    if (!(await guardRunningGame())) return;
  }
  b.classList.add('busy');
  const r = await api.tool(what);
  b.classList.remove('busy');
  toast(r && r.ok ? t('tools.done') : t('tools.failed'), !(r && r.ok));
});

// ---------- Live: lobby check, champ select helper, Clash ----------
let liveData = null, liveTimer = null, champs = [];
let helper = { enemy: 0, load: null };
const champById = id => champs.find(c => c.id === id);
// typed name -> champion (ignores case, spaces and apostrophes: "kai sa" finds Kai'Sa)
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const champByName = s => { const n = norm(s); return n ? champs.find(c => norm(c.name) === n || norm(c.alias) === n) || champs.find(c => norm(c.name).startsWith(n)) : null; };
const champIcon = id => `${CDRAGON}/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;
function pool() {
  const p = S.settings && S.settings.champPool;
  return Array.isArray(p) ? p : [];   // empty until the user adds their own champions
}
function savePool(p) { S.settings = { ...S.settings, champPool: p }; api.setSetting('champPool', p); }

let liveRun = 0;
let champsLoading = false;
async function pollLive() {
  clearTimeout(liveTimer);
  const run = ++liveRun;              // a newer call replaces this loop
  if (view !== 'live') return;
  // the page stands at once; the champion list never holds up the live data
  if (!liveData) renderLive();
  if (!champs.length && !champsLoading) {
    champsLoading = true;
    api.champions().then(c => { champsLoading = false; if (Array.isArray(c) && c.length) { champs = c; if (view === 'live') renderLive(); } });
  }
  try {
    const d = await api.live();
    if (run !== liveRun || view !== 'live') return;
    // a game just ended: look for it right away
    const ended = liveData && ['InProgress', 'GameStart', 'Reconnect', 'WaitingForStats', 'PreEndOfGame'].includes(liveData.phase) && d && !['InProgress', 'GameStart', 'Reconnect'].includes(d.phase);
    liveData = d;
    renderLive();
    if (typeof loadPostgame === 'function') loadPostgame(ended);
  } catch (e) { console.warn('live', e); }
  if (run === liveRun) liveTimer = setTimeout(pollLive, 3000);
}
// one queue's rank, labelled: "SOLO/DUO  Gold II · 45 LP  · 54% (120)"
function queueRank(label, r) {
  if (!r) return `<div class="q-rank none"><span class="q-l">${label}</span><span>${t('tile.unranked')}</span></div>`;
  const games = r.wins + r.losses;
  const wr = r.wl !== false && games ? ` · ${Stats.winPct(r.wins, games)}%` : r.wins ? ` · ${t('tile.wins', { n: r.wins })}` : '';
  const tip = r.wl !== false && games ? t('tile.wlTitle', { w: r.wins, l: r.losses }) : t('tile.wlUnknown');
  return `<div class="q-rank" title="${esc(tip)}"><span class="q-l">${label}</span><img src="${crestUrl(r.tier)}" alt="">
    <span><b>${tierName(r.tier)}${APEX.includes(r.tier) ? '' : ' ' + r.division}</b> · ${r.lp} LP<i>${wr}</i></span></div>`;
}
function playerRow(p) {
  return `<div class="p-row${p.puuid && liveData && p.puuid === liveData.me ? ' me' : ''}">
    ${p.championId ? `<img class="ch" src="${champIcon(p.championId)}" alt="">` : p.iconId != null ? `<img class="ch round" src="${iconUrl(p.iconId)}" alt="">` : '<span class="ch"></span>'}
    <div class="p-name"><b>${esc(p.gameName || '?')}</b><small>${p.tagLine ? '#' + esc(p.tagLine) : ''}${p.position ? ' · ' + esc(p.position) : ''}</small></div>
    <div class="p-ranks">${queueRank('Solo/Duo', p.solo)}${queueRank('Flex', p.flex)}</div>
    ${p.gameName ? `<button class="chip" data-opgg="${esc(p.gameName + '#' + p.tagLine)}">op.gg</button>` : ''}
  </div>`;
}
// the own accounts that matter on the Live page: the signed-in one and any in the lobby, champion
// select or the game – another account's penalty is no concern here (its tile shows it)
function liveAccounts() {
  const d = liveData || {};
  const ids = new Set([S.live && S.live.puuid, d.me].filter(Boolean));
  const add = list => (list || []).forEach(p => p && p.puuid && ids.add(p.puuid));
  if (d.lobby) add(d.lobby.members);
  if (d.champSelect) add(d.champSelect.allies);
  if (d.inGame) { add(d.inGame.teamOne); add(d.inGame.teamTwo); }
  return (S.accounts || []).filter(a => ids.has(a.puuid));
}
// their known penalties (from each one's own last login) that haven't run out
function activePenalties() {
  const now = Date.now();
  const out = [];
  for (const a of liveAccounts()) {
    const list = (a.penalties && a.penalties.list) || [];
    for (const p of list) if (isPenalty(p.code) && !(a.lowPrio && /lowpriority/i.test(p.code)) && (!p.until || p.until > now)) out.push({ a, p, asOf: a.penalties.at });
    if (a.lowPrio) out.push({ a, p: { code: 'LowPriorityQueue', low: a.lowPrio }, asOf: a.lowPrio.at });
  }
  return out.sort((x, y) => (x.p.until || Infinity) - (y.p.until || Infinity));
}
function penaltiesHtml() {
  const list = activePenalties();
  if (!list.length) return '';
  return `<div class="live-card pen-card"><div class="lc-head"><h3>${t('pen.title')} <span class="info" title="${esc(t('pen.note'))}">?</span></h3></div>
    ${list.map(({ a, p, asOf }) => `<div class="pen-row">
      <span class="pen-av">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="">` : ''}</span>
      <div class="pen-name"><b>${esc(dispName(a))}</b><small>${esc(reasonText({ code: p.code, args: p.args }))}</small></div>
      ${p.low ? `<span class="pen-left">${esc(lowPrioText(p.low) || t('pen.noEnd'))}</span>` : p.until ? `<span class="pen-left" data-until="${p.until}">${esc(p.until - Date.now() < 86400000 ? t('pen.left', { t: leftText(p.until) }) : leftText(p.until))}</span>`
        : `<span class="pen-left none" title="${esc(t('pen.asOf', { date: fmtDate(asOf) }))}">${t('pen.noEnd')}</span>`}
    </div>`).join('')}
</div>`;
}
// running countdowns (live page, title bar) tick every second while there is one
setInterval(() => {
  for (const el of document.querySelectorAll('[data-until]')) {
    const u = Number(el.dataset.until);
    if (u <= Date.now()) { el.textContent = '✓'; continue; }
    el.textContent = el.dataset.fmt === 'wait' ? t('pen.wait', { t: leftText(u) })
      : u - Date.now() < 86400000 ? t('pen.left', { t: leftText(u) }) : leftText(u);
  }
}, 1000);

function renderLive(force) {
  if (!force && document.activeElement && document.activeElement.closest && document.activeElement.closest('#liveBody input')) return;
  const d = liveData || {};
  $('liveSub').textContent = !d.clientUp ? t('app.closed') : phaseName(d.phase);
  $('liveDot').hidden = !(d.clash && d.clash.opponents && d.clash.opponents.length) && !d.champSelect && !d.lobby && !d.inGame;
  const parts = [];
  const pens = penaltiesHtml();
  // a game on: the ten players first (all of them on screen), the penalties below
  if (pens && !d.inGame) parts.push(pens);
  if (d.clash && d.clash.opponents && d.clash.opponents.length) {
    const ids = d.clash.opponents.filter(o => o.gameName).map(o => o.gameName + '#' + o.tagLine);
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.clash')} – ${esc(d.clash.teamName || '')} ${d.clash.teamTag ? '[' + esc(d.clash.teamTag) + ']' : ''}</h3>
      <button class="btn gold ext-btn" id="clashAll" data-ids="${esc(ids.join('|'))}"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${t('live.multiOpgg')}</button></div>
      ${d.clash.opponents.map(playerRow).join('')}</div>`);
  }
  // a game on (loading screen and after): the ten players as cards (scout-view.js)
  if (d.inGame && (d.inGame.teamOne.length || d.inGame.teamTwo.length)) parts.push(scoutBoardHtml(d));
  if (pens && d.inGame) parts.push(pens);
  if (d.lobby && d.lobby.members.length) {
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.lobby')}</h3></div>${d.lobby.members.map(playerRow).join('')}</div>`);
  }
  if (d.champSelect) {
    const cs = d.champSelect;
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.champSelect')}</h3></div>
      ${cs.allies.map(playerRow).join('')}
      ${cs.hiddenNames ? `<p class="fine">${t('live.hidden')}</p>` : ''}
      ${cs.enemies.some(e => e.championId) ? `<div class="enemy-row">${t('live.enemies')}: ${cs.enemies.filter(e => e.championId).map(e => `<img class="ch" title="${esc((champById(e.championId) || {}).name || '')}" src="${champIcon(e.championId)}" alt="">`).join('')}</div>` : ''}
      ${dmgMixHtml([{ label: t('live.enemies'), champs: cs.enemies.map(e => ({ puuid: '', champ: e.championId })) }, { label: t('live.allies'), champs: cs.allies.map(a => ({ puuid: a.puuid, champ: a.championId })) }])}
    </div>`);
    // a new champ select ends the post-game overview
    if (typeof pg !== 'undefined' && pg.game) pg.closedId = String(pg.game.id);
    // enemy laner known? (same position) -> preselect for the helper
    const opp = enemyPicks().find(p => p.laner);
    if (opp && (!helper.enemy || (helper.autoEnemy && helper.enemy !== opp.id))) { helper.enemy = opp.id; helper.autoEnemy = true; }
    // every enemy pick, ahead of time (the laner first)
    want(cs.enemies.map(e => e.championId).filter(Boolean));
  } else if (helper.autoEnemy && !d.inGame) { helper.enemy = 0; helper.autoEnemy = false; }
  const post = !d.champSelect && !d.inGame && typeof postgameHtml === 'function' ? postgameHtml() : '';
  if (post) parts.push(post);
  // no game, no post-game overview: the last game, small
  const last = !post && liveData && !d.champSelect && !d.inGame && typeof lastGameHtml === 'function' ? lastGameHtml() : '';
  if (last) parts.push(last);
  if (!liveData) parts.push(`<div class="live-card"><p class="fine">${t('live.loading')}</p></div>`);
  else if (!post && !last && (!parts.length || (parts.length === 1 && pens))) parts.push(`<div class="live-card"><p class="fine">${t('live.nothing')}</p></div>`);
  parts.push(helperByPhase(d));
  // keep focus/scroll of the helper's inputs: only replace when something changed
  const html = parts.join('');
  if ($('liveBody').dataset.html !== html) { $('liveBody').innerHTML = html; $('liveBody').dataset.html = html; }
}
// ---------- counters, loaded ahead ----------
// counterstats.net has one page per champion: every champion with enough games against him on a
// lane, with win rate and counter rating. One request per enemy covers the whole pool. Loaded in
// the background as soon as an enemy is known – in champion select every enemy pick.
// A matchup's win rates add up to 100 (Garen 53 % against Darius = Darius 47 % against Garen,
// checked on 50+ pages): so the pages of my own champions answer every enemy too – "pre-load" needs
// one request per champion of the pool, not one per possible enemy.
const csCache = new Map();          // "enemyId|lane" -> { list: [{name, wr, rating}] (empty = no data), share: % of his games on this lane }
const csKey = (id, lane) => id + '|' + lane;
let csQueue = [], csBusy = false;
const lane = () => (S.settings && S.settings.lane) || 'top';
function want(ids) {
  const l = lane();
  for (const id of ids) {
    const k = csKey(id, l);
    if (!id || csCache.has(k) || csQueue.some(q => q.k === k)) continue;
    csQueue.push({ k, id, l });
  }
  if (csQueue.length) runQueue();
}
async function runQueue() {
  if (csBusy) return;
  csBusy = true;
  helper.load = { done: 0, total: csQueue.length };
  while (csQueue.length) {
    // the enemy shown right now first
    csQueue.sort((x, y) => (y.id === helper.enemy) - (x.id === helper.enemy));
    const q = csQueue.shift();
    const c = champById(q.id);
    const r = c ? await api.counters(c.name, q.l) : null;
    if (r && r.ok) csCache.set(q.k, { list: r.list || [], share: r.share || 0 });
    helper.load = { done: helper.load.done + 1, total: Math.max(helper.load.total, helper.load.done + 1 + csQueue.length) };
    if (view === 'live') renderLive();
  }
  helper.load = null;
  csBusy = false;
  if (view === 'live') renderLive();
}
// "pre-load": the pages of my own champions – every enemy they meet on this lane is on them
function preloadPool() { want(pool()); }

// my pool against the chosen enemy, best first (wr undefined = still loading, null = no data):
// from the enemy's page, else turned round from my champion's own page (no counter rating there)
function bestPicks() {
  if (!helper.enemy) return null;
  const l = lane();
  const list = (csCache.get(csKey(helper.enemy, l)) || {}).list;
  const en = norm((champById(helper.enemy) || {}).name);
  return pool().filter(id => id !== helper.enemy).map(id => {
    const hit = list && list.find(x => norm(x.name) === norm((champById(id) || {}).name));
    if (hit) return { id, wr: hit.wr, rating: hit.rating };
    const mine = (csCache.get(csKey(id, l)) || {}).list;
    const back = mine && mine.find(x => norm(x.name) === en);
    if (back) return { id, wr: 100 - back.wr, rating: null };
    return list || mine ? { id, wr: null, rating: null } : { id };
  }).sort((x, y) => (y.wr ?? -1) - (x.wr ?? -1) || (y.rating ?? -1) - (x.rating ?? -1));
}
// the champions played on this lane in the own match history (all accounts): at least POOL_MIN
// games in the last POOL_DAYS days, most played first, at most POOL_MAX
const POOL_MIN = 3, POOL_DAYS = 180, POOL_MAX = 10;
async function poolFromHistory() {
  const games = (await allGames()) || [];
  const role = lane() === 'adc' ? 'bot' : lane();
  const own = new Set((S.accounts || []).map(a => a.puuid).filter(Boolean));
  const since = Date.now() - POOL_DAYS * 86400000;
  const count = new Map();
  for (const g of games) {
    if (Stats.isRemake(g) || g.t < since) continue;
    for (const p of g.players || []) if (own.has(p.puuid) && p.champ && Stats.role(g, p) === role) count.set(p.champ, (count.get(p.champ) || 0) + 1);
  }
  return [...count].filter(([, n]) => n >= POOL_MIN).sort((a, b) => b[1] - a[1]).slice(0, POOL_MAX).map(([id]) => id);
}
// Riot doesn't show the enemies' positions in ranked: the likely laner is the enemy with the biggest
// share of his games on this lane (counterstats), if it is a real one (15 % and more)
function guessLaner(picks) {
  if (picks.some(p => p.laner)) return picks;
  let best = null;
  for (const p of picks) {
    const c = csCache.get(csKey(p.id, lane()));
    p.share = c ? c.share : null;
    if (p.share >= 15 && (!best || p.share > best.share)) best = p;
  }
  if (best) { best.laner = true; best.guess = true; }
  return picks;
}
// enemy champions picked right now (champion select, or the game running)
function enemyPicks() {
  const d = liveData || {};
  if (d.champSelect) {
    const cs = d.champSelect;
    const picks = cs.enemies.filter(e => e.championId).map(e => ({ id: e.championId, laner: !!(cs.myPosition && e.position === cs.myPosition) }));
    return guessLaner(picks);
  }
  if (d.inGame) {
    const mine = d.inGame.teamTwo.some(p => p.puuid === d.me) ? 'teamTwo' : 'teamOne';
    return guessLaner(d.inGame[mine === 'teamOne' ? 'teamTwo' : 'teamOne'].filter(p => p.championId).map(p => ({ id: p.championId, laner: false })));
  }
  return [];
}

function helperHtml() {
  const p = pool();
  const opts = champs.map(c => `<option value="${esc(c.name)}">`).join('');
  const res = bestPicks();
  const load = helper.load;
  const picks = enemyPicks();
  const enemyName = esc((champById(helper.enemy) || {}).name || '');
  return `<datalist id="champList">${opts}</datalist><div class="live-card helper"><div class="lc-head"><h3>${t('live.helper')} <button class="help-btn" data-help="helper" title="${esc(t('help.open'))}">?</button></h3>
      <select id="hLane">${['top', 'jungle', 'mid', 'adc', 'support'].map(l => `<option value="${l}" ${lane() === l ? 'selected' : ''}>${t('lane.' + l)}</option>`).join('')}</select></div>
    <div class="h-sub">${t('live.poolTitle')}</div>
    ${p.length ? '' : `<p class="fine">${t('live.poolEmpty')}</p>`}<div class="h-pool">${p.map(id => `<span class="h-chip"><img src="${champIcon(id)}" alt="">${esc((champById(id) || {}).name || id)}<button data-hdel="${id}">×</button></span>`).join('')}
      <input id="hAdd" list="champList" placeholder="+ ${esc(t('live.addChamp'))}" spellcheck="false">
      <button class="btn small" id="hFromMh" title="${esc(t('live.poolFromMhT'))}">${t('live.poolFromMh')}</button></div>
    ${picks.length ? `<div class="h-sub">${t('live.vsWho')}</div><div class="h-picks">${picks.map(x => `<button class="h-pick${x.id === helper.enemy ? ' on' : ''}${x.laner ? ' laner' : ''}" data-hpick="${x.id}" title="${esc((champById(x.id) || {}).name || '') + (x.guess ? ' – ' + t('live.likelyLaner', { n: Math.round(x.share) }) : '')}"><img src="${champIcon(x.id)}" alt="">${x.guess ? '<i class="h-guess">?</i>' : ''}</button>`).join('')}</div>` : ''}
    <div class="h-sub">${t('live.enemy')}</div>
    <div class="h-enemy">${helper.enemy ? `<img class="h-en" src="${champIcon(helper.enemy)}" alt="">` : ''}<input id="hEnemy" list="champList" placeholder="${esc(t('live.typeChamp'))}" spellcheck="false" value="${enemyName}"></div>
    <div class="h-pre"><button class="btn small" id="hPre" ${load ? 'disabled' : ''}>${t('live.preloadBtn')}</button>
      <span class="info" title="${esc(t('live.preloadT'))}">?</span></div>
    ${load && load.total ? `<div class="h-load"><span>${t('live.preload', { n: load.done, total: load.total })}</span><span class="bar"><i style="width:${Math.round(100 * load.done / load.total)}%"></i></span></div>` : ''}
    ${res && res.length ? `<div class="h-sub">${t('live.bestVs', { name: enemyName })}</div><div class="h-results">${res.map((r, i) => `<div class="h-res ${i === 0 && r.wr != null ? 'best' : ''}"${r.rating != null ? ` title="${esc(t('live.ratingT', { r: r.rating.toFixed(1) }))}"` : ''}>
      <img src="${champIcon(r.id)}" alt=""><b>${esc((champById(r.id) || {}).name || '')}</b>
      <span class="wr ${r.wr >= 52 ? 'good' : r.wr != null && r.wr <= 48 ? 'bad' : ''}">${r.wr === undefined ? '<i class="dots">…</i>' : r.wr == null ? '–' : Math.round(r.wr) + '%'}</span>
      <span class="rt">${r.rating != null ? r.rating.toFixed(1) : ''}</span>
      <span class="bar"><i style="width:${r.wr == null ? 0 : Math.max(0, Math.min(100, (r.wr - 40) * 5))}%"></i></span></div>`).join('')}
      <p class="fine">${t('live.source')}</p></div>` : ''}
  </div>`;
}
$('liveBody').addEventListener('click', async e => {
  const og = e.target.closest('[data-opgg]');
  if (og) { const [n, tag] = og.dataset.opgg.split('#'); return openSite({ gameName: n, tagLine: tag, region: (liveData && liveData.region) || selected()?.region }, 'opgg'); }
  const mb = e.target.closest('#clashAll, .multi-btn');
  if (mb) return api.openMulti((liveData && liveData.region) || (selected() && selected().region) || 'euw', mb.dataset.ids.split('|'));
  if (e.target.closest('#hPre')) { if (!pool().length) return toast(t('live.poolEmpty'), true); return preloadPool(); }
  if (e.target.closest('#hFromMh')) {
    const ids = await poolFromHistory();
    if (!ids.length) return toast(t('live.poolNone', { lane: t('lane.' + lane()) }), true);
    const add = ids.filter(id => !pool().includes(id));
    savePool([...pool(), ...add]);
    toast(t('live.poolAdded', { n: add.length }));
    return renderLive(true);
  }
  const del = e.target.closest('[data-hdel]');
  if (del) { savePool(pool().filter(id => id !== Number(del.dataset.hdel))); return renderLive(); }
  // "who are you playing against?" – a click on an enemy pick
  const pk = e.target.closest('[data-hpick]');
  if (pk) { helper.enemy = Number(pk.dataset.hpick); helper.autoEnemy = false; want([helper.enemy]); return renderLive(true); }

});
$('liveBody').addEventListener('change', e => {
  if (e.target.id === 'hAdd' && e.target.value.trim()) {
    const c = champByName(e.target.value);
    if (!c) return toast(t('live.unknownChamp'), true);
    if (!pool().includes(c.id)) savePool([...pool(), c.id]);
    renderLive(true);
    $('hAdd') && $('hAdd').focus();
  }
  if (e.target.id === 'hEnemy') {
    helper.autoEnemy = false;
    const c = champByName(e.target.value);
    if (e.target.value.trim() && !c) return toast(t('live.unknownChamp'), true);
    helper.enemy = c ? c.id : 0;
    if (helper.enemy) want([helper.enemy]);
    renderLive(true);
  }
  if (e.target.id === 'hLane') { S.settings = { ...S.settings, lane: e.target.value }; api.setSetting('lane', e.target.value); if (helper.enemy) want([helper.enemy]); renderLive(); }
});

$('mmFix').onclick = async () => {
  const r = await api.fixMismatch();
  if (r && r.ok) toast(t('mm.started'));
  else if (r && r.risky) toast(t('mm.later'), true);
};

// ---------- after every render ----------
window.afterRender = () => {
  applyTheme();
  $('aaToggle').checked = !!(S.settings && S.settings.autoAccept);
  if (view === 'accounts') renderDetail();
};
applyTheme();

// "What's new" once after an update (renderer.js has the state by then)
// the first state can arrive before this file is loaded: draw once more (detail panel)
stateReady.then(() => { render(); setTimeout(firstStart, 400); });

// first start: asked once whether Rift Switch should start with Windows (nothing is switched on
// without asking); then "What's new" as usual
function firstStart() {
  if (!S.settings || S.locked || S.settings.askedStart || !S.version) return notesOnce();
  $('startBox').hidden = false;
}
$('startBox').addEventListener('click', e => {
  const b = e.target.closest('[data-first]');
  if (!b) return;
  const how = b.dataset.first;
  $('startBox').hidden = true;
  S.settings = { ...S.settings, askedStart: true, autostart: how !== 'no', startMinimized: how === 'tray' };
  api.setSetting('autostart', how !== 'no');
  api.setSetting('startMinimized', how === 'tray');
  api.setSetting('askedStart', true);
  render();
  if (how !== 'no') toast(t(how === 'tray' ? 'first.doneTray' : 'first.doneWindow'));
});

// ---------- "Load": one action everywhere (collection, mastery, panel, overview) ----------
// Everything the client has for the signed-in account at once: collection, mastery, ranks and
// new games. All Load buttons show the same run (S.loading); a second press starts nothing new.
const LOAD_ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
let loadBarTimer = null;
function loadBtnState(forId) {
  const live = S.live || {}, L = S.loading;
  const me = S.accounts.find(a => a.puuid === live.puuid);
  if (L && typeof L === 'object') {
    // the bar only after a second: short runs just say what they do
    const long = Date.now() - (L.since || 0) > 1000;
    const part = L.total ? L.done / L.total : 0;
    const pct = Math.round(Math.min(1, ((L.n || 1) - 1 + part) / (L.of || 4)) * 100);
    return { off: true, label: t('load.progress', { step: t('load.step.' + L.step), n: L.n || 1, of: L.of || 4 }), pct: long ? pct : null,
      tip: L.step === 'games' && L.total ? t('load.games', { done: L.done, total: L.total }) : '' };
  }
  if (forId && forId !== live.puuid) return { off: true, label: t('load.next'), tip: t('load.nextTip') };
  if (!live.clientUp || !me) return { off: true, label: t('load.btn'), tip: t('load.closed') };
  return { off: false, label: t('load.btn'), tip: t('load.tip', { name: dispName(me) }) };
}
function refreshLoadBtns() {
  for (const b of document.querySelectorAll('[data-loadall]')) {
    const s = loadBtnState(b.dataset.loadall);
    b.disabled = s.off;
    b.title = s.tip;
    b.classList.toggle('loading', s.pct != null);
    b.innerHTML = `${LOAD_ICON}<span>${esc(s.label)}</span>${s.pct != null ? `<i class="lb-bar" style="width:${s.pct}%"></i>` : ''}`;
  }
  // a run under a second shows no bar: look again when the second is over
  clearTimeout(loadBarTimer);
  const L = S.loading;
  if (L && typeof L === 'object') loadBarTimer = setTimeout(refreshLoadBtns, Math.max(50, 1050 - (Date.now() - (L.since || 0))));
}
async function runLoadAll() {
  if (S.loading) return;
  const r = await api.loadAll();
  if (r && r.ok) return toast(t('load.done', { champs: r.champs, skins: r.skins, games: r.games }));
  const why = r && r.why;
  if (why === 'running') return;
  toast(t(why === 'inGame' ? 'load.inGame' : why === 'busy' ? 'load.busy' : 'load.closed'), true);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-loadall]');
  if (b && !b.disabled) runLoadAll();
});
api.onState(() => refreshLoadBtns());
