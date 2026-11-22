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
  $('viewTools').hidden = v !== 'tools';
  $('viewMatches').hidden = v !== 'matches';
  $('detail').hidden = v !== 'accounts';
  $('navAccounts').classList.toggle('active', v === 'accounts');
  $('navLive').classList.toggle('active', v === 'live');
  $('navTools').classList.toggle('active', v === 'tools');
  $('navMatches').classList.toggle('active', v === 'matches');
  if (v === 'live') pollLive(true);
  if (v === 'matches') { renderMatches(); loadMatches(); }
}
$('navAccounts').onclick = () => showView('accounts');
$('navLive').onclick = () => showView('live');
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
// all picked tiles into one category (one save)
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
    <div class="d-actions">
      <button data-m="move">${ic('<path d="M3 7h7l2 2h9v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>')}<span>${t('d.move')}</span></button>
      <button data-m="opgg">${ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')}<span>${t('multi.opgg')}</span></button>
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
    ${hides('ranks') ? '' : `<div class="d-chart">${detailData.id === a.puuid ? historyChart(detailData.hist, detailData.est, true) : ''}</div>`}`}
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
}
$('detail').addEventListener('click', async e => {
  const m = e.target.closest('[data-m]');
  if (m && picked.size > 1) {
    const list = pickedAccounts();
    const what = m.dataset.m;
    if (what === 'clear') return clearPicks();
    if (what === 'opgg') {
      // op.gg multi-search: up to 5 Riot IDs of one server
      const named = list.filter(x => x.gameName && x.tagLine);
      if (!named.length) return;
      if (named.length > 5) toast(t('multi.first5'));
      return api.openMulti(named[0].region || 'euw', named.slice(0, 5).map(x => x.gameName + '#' + x.tagLine));
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
let helper = { enemy: 0, results: null, running: false };
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
async function pollLive() {
  clearTimeout(liveTimer);
  const run = ++liveRun;              // a newer call replaces this loop
  if (view !== 'live') return;
  try {
    if (!champs.length) champs = (await api.champions()) || [];
    const d = await api.live();
    if (run !== liveRun || view !== 'live') return;
    liveData = d;
    renderLive();
  } catch (e) { console.warn('live', e); }
  if (run === liveRun) liveTimer = setTimeout(pollLive, 3000);
}
// one queue's rank, labelled: "SOLO/DUO  Gold II · 45 LP  · 54% (120)"
function queueRank(label, r) {
  if (!r) return `<div class="q-rank none"><span class="q-l">${label}</span><span>${t('tile.unranked')}</span></div>`;
  const games = r.wins + r.losses;
  const wr = r.wl !== false && games ? ` · ${Math.round(100 * r.wins / games)}%` : r.wins ? ` · ${t('tile.wins', { n: r.wins })}` : '';
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
// "4:32", "2 h 05 min", or a date for long ones
function leftText(until) {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000));
  if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  if (s < 86400) return Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min';
  return t('pen.until', { date: new Date(until).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
}
// only real penalties (same rule as riot.rs is_penalty)
const isPenalty = code => /leaver|ban|suspension|lockout|dodge|penalty|timed|lowpriority|ranked_restricted/i.test(code || '');
// every account's known penalties (from its own last login) that haven't run out
function activePenalties() {
  const now = Date.now();
  const out = [];
  for (const a of S.accounts || []) {
    const list = (a.penalties && a.penalties.list) || [];
    for (const p of list) if (isPenalty(p.code) && (!p.until || p.until > now)) out.push({ a, p, asOf: a.penalties.at });
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
      ${p.until ? `<span class="pen-left" data-until="${p.until}">${esc(p.until - Date.now() < 86400000 ? t('pen.left', { t: leftText(p.until) }) : leftText(p.until))}</span>`
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
  if (pens) parts.push(pens);
  if (d.clash && d.clash.opponents && d.clash.opponents.length) {
    const ids = d.clash.opponents.filter(o => o.gameName).map(o => o.gameName + '#' + o.tagLine);
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.clash')} – ${esc(d.clash.teamName || '')} ${d.clash.teamTag ? '[' + esc(d.clash.teamTag) + ']' : ''}</h3>
      <button class="btn gold ext-btn" id="clashAll" data-ids="${esc(ids.join('|'))}"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${t('live.multiOpgg')}</button></div>
      ${d.clash.opponents.map(playerRow).join('')}</div>`);
  }
  if (d.inGame && (d.inGame.teamOne.length || d.inGame.teamTwo.length)) {
    const mine = d.inGame.teamTwo.some(p => p.puuid === d.me) ? 'teamTwo' : 'teamOne';
    const theirs = mine === 'teamOne' ? 'teamTwo' : 'teamOne';
    const ids = d.inGame[theirs].filter(o => o.gameName).map(o => o.gameName + '#' + o.tagLine);
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.enemies')} <span class="info" title="${esc(t('live.ranksNote'))}">?</span></h3>
      ${ids.length ? `<button class="btn gold ext-btn multi-btn" data-ids="${esc(ids.join('|'))}"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${t('live.multiOpgg')}</button>` : ''}</div>
      ${d.inGame[theirs].map(playerRow).join('')}</div>`);
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.allies')}</h3></div>${d.inGame[mine].map(playerRow).join('')}</div>`);
  }
  if (d.lobby && d.lobby.members.length) {
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.lobby')}</h3></div>${d.lobby.members.map(playerRow).join('')}</div>`);
  }
  if (d.champSelect) {
    const cs = d.champSelect;
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.champSelect')}</h3></div>
      ${cs.allies.map(playerRow).join('')}
      ${cs.hiddenNames ? `<p class="fine">${t('live.hidden')}</p>` : ''}
      ${cs.enemies.some(e => e.championId) ? `<div class="enemy-row">${t('live.enemies')}: ${cs.enemies.filter(e => e.championId).map(e => `<img class="ch" title="${esc((champById(e.championId) || {}).name || '')}" src="${champIcon(e.championId)}" alt="">`).join('')}</div>` : ''}
    </div>`);
    // enemy laner known? (same position) -> preselect for the helper
    const opp = cs.enemies.find(e => e.championId && cs.myPosition && e.position === cs.myPosition) || (cs.enemies.filter(e => e.championId).length === 1 ? cs.enemies.find(e => e.championId) : null);
    if (opp && !helper.enemy) { helper.enemy = opp.championId; helper.autoEnemy = true; }
  } else if (helper.autoEnemy) { helper.enemy = 0; helper.autoEnemy = false; helper.results = null; }
  if (!parts.length || (parts.length === 1 && pens)) parts.push(`<div class="live-card"><p class="fine">${t('live.nothing')}</p></div>`);
  parts.push(helperHtml());
  // keep focus/scroll of the helper's inputs: only replace when something changed
  const html = parts.join('');
  if ($('liveBody').dataset.html !== html) { $('liveBody').innerHTML = html; $('liveBody').dataset.html = html; }
}
function helperHtml() {
  const p = pool();
  const opts = champs.map(c => `<option value="${esc(c.name)}">`).join('');
  const res = helper.results;
  return `<datalist id="champList">${opts}</datalist><div class="live-card helper"><div class="lc-head"><h3>${t('live.helper')}</h3>
      <select id="hLane">${['top', 'jungle', 'mid', 'adc', 'support'].map(l => `<option value="${l}" ${((S.settings && S.settings.lane) || 'top') === l ? 'selected' : ''}>${t('lane.' + l)}</option>`).join('')}</select></div>
    ${p.length ? '' : `<p class="fine">${t('live.poolEmpty')}</p>`}<div class="h-pool">${p.map(id => `<span class="h-chip"><img src="${champIcon(id)}" alt="">${esc((champById(id) || {}).name || id)}<button data-hdel="${id}">×</button></span>`).join('')}
      <input id="hAdd" list="champList" placeholder="+ ${esc(t('live.addChamp'))}" spellcheck="false"></div>
    <div class="h-enemy"><span>${t('live.enemy')}</span><input id="hEnemy" list="champList" placeholder="${esc(t('live.typeChamp'))}" spellcheck="false" value="${esc((champById(helper.enemy) || {}).name || '')}">
      <button class="btn gold" id="hRun" ${helper.running ? 'disabled' : ''}>${helper.running ? t('live.loading') : t('live.bestPick')}</button></div>
    ${res ? `<div class="h-results">${res.map((r, i) => `<div class="h-res ${i === 0 && r.wr != null ? 'best' : ''}">
      <img src="${champIcon(r.id)}" alt=""><b>${esc((champById(r.id) || {}).name || '')}</b>
      <span class="bar"><i style="width:${r.wr == null ? 0 : Math.max(0, Math.min(100, (r.wr - 40) * 5))}%"></i></span>
      <span class="wr ${r.wr >= 52 ? 'good' : r.wr != null && r.wr <= 48 ? 'bad' : ''}">${r.wr == null ? '–' : r.wr.toFixed(1) + '%'}</span></div>`).join('')}
      <p class="fine">${t('live.source')}</p></div>` : ''}
  </div>`;
}
$('liveBody').addEventListener('click', async e => {
  const og = e.target.closest('[data-opgg]');
  if (og) { const [n, tag] = og.dataset.opgg.split('#'); return openSite({ gameName: n, tagLine: tag, region: (liveData && liveData.region) || selected()?.region }, 'opgg'); }
  const mb = e.target.closest('#clashAll, .multi-btn');
  if (mb) return api.openMulti((liveData && liveData.region) || (selected() && selected().region) || 'euw', mb.dataset.ids.split('|'));
  const del = e.target.closest('[data-hdel]');
  if (del) { savePool(pool().filter(id => id !== Number(del.dataset.hdel))); helper.results = null; return renderLive(); }
  if (e.target.closest('#hRun')) {
    const enemy = champById(helper.enemy);
    if (!enemy) return toast(t('live.pickEnemy'), true);
    helper.running = true; helper.results = null; renderLive();
    const lane = (S.settings && S.settings.lane) || 'top';
    const out = [];
    for (const id of pool()) {
      const me = champById(id);
      if (!me || id === enemy.id) continue;
      const r = await api.matchup(me.name, enemy.name, lane);
      out.push({ id, wr: r && r.wr });
    }
    helper.results = out.sort((x, y) => (y.wr ?? -1) - (x.wr ?? -1));
    helper.running = false;
    renderLive();
  }
});
$('liveBody').addEventListener('change', e => {
  if (e.target.id === 'hAdd' && e.target.value.trim()) {
    const c = champByName(e.target.value);
    if (!c) return toast(t('live.unknownChamp'), true);
    if (!pool().includes(c.id)) savePool([...pool(), c.id]);
    helper.results = null; renderLive(true);
    $('hAdd') && $('hAdd').focus();
  }
  if (e.target.id === 'hEnemy') {
    helper.autoEnemy = false;
    const c = champByName(e.target.value);
    if (e.target.value.trim() && !c) return toast(t('live.unknownChamp'), true);
    helper.enemy = c ? c.id : 0; helper.results = null; renderLive(true);
  }
  if (e.target.id === 'hLane') { S.settings = { ...S.settings, lane: e.target.value }; api.setSetting('lane', e.target.value); helper.results = null; renderLive(); }
});

// ---------- after every render ----------
window.afterRender = () => {
  applyTheme();
  $('aaToggle').checked = !!(S.settings && S.settings.autoAccept);
  if (view === 'accounts') renderDetail();
};
applyTheme();
