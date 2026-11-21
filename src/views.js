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
  $('detail').hidden = v !== 'accounts';
  $('navAccounts').classList.toggle('active', v === 'accounts');
  $('navLive').classList.toggle('active', v === 'live');
  $('navTools').classList.toggle('active', v === 'tools');
  if (v === 'live') pollLive(true);
}
$('navAccounts').onclick = () => showView('accounts');
$('navLive').onclick = () => showView('live');
$('navTools').onclick = () => showView('tools');

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
  if (a.decay && a.decay.show && a.decay.days != null) return t('d.decayIn', { d: a.decay.days });
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
  const a = selected();
  const box = $('detail');
  if (!a) { box.innerHTML = `<div class="d-empty">${t('empty.text')}</div>`; return; }
  selectedId = a.puuid;
  document.querySelectorAll('.tile.selected').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.tile[data-id="${CSS.escape(a.puuid)}"]`)?.classList.add('selected');
  const signedIn = a.puuid === S.active && S.live && S.live.puuid === a.puuid;
  const st = !a.placeholder && rankedStatus(a);
  const dec = !a.placeholder ? decayText(a) : '';
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
      ${dec ? `<div class="warn">${ic('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h0"/>')}${esc(dec)}</div>` : ''}
      ${st && st.ready === false ? `<div class="warn">${ic('<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8"/>')}${t('rk.notReady')}</div>` : ''}
    </div>
    ${hides('ranks') ? '' : `<div class="d-chart">${detailData.id === a.puuid ? historyChart(detailData.hist, detailData.est, true) : ''}</div>`}`}
    <button class="btn gold d-switch" id="dSwitch" ${signedIn ? 'disabled' : ''}>${ic('<path d="M7 4l12 8-12 8z"/>')}${signedIn ? t('d.signedIn') : t('d.switch')}</button>
    <div class="d-actions">
      ${a.placeholder ? '' : `<button data-d="profile">${ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')}<span>${t('d.profile')}</span></button>`}
      <button data-d="login">${ic('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>')}<span>${t('d.login')}</span></button>
      ${a.placeholder ? '' : `<button data-d="open">${ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')}<span>${t('menu.openWith')}</span></button>`}
      <button data-d="note">${ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>')}<span>${t('d.edit')}</span></button>
      <button data-d="move">${ic('<path d="M3 7h7l2 2h9v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>')}<span>${t('d.move')}</span></button>
      <button data-d="remove" class="danger">${ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}<span>${t('menu.remove')}</span></button>
    </div>
    <p class="fine d-hint">${t('d.hint')}</p>`;
  loadDetailChart(a);
}
$('detail').addEventListener('click', async e => {
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
  siteMenu.hidden = true;
  if (b && a) openSite(a, b.dataset.site);
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
function playerRow(p) {
  const r = p.solo;
  const rank = r ? `${tierName(r.tier)}${APEX.includes(r.tier) ? '' : ' ' + r.division} · ${r.lp} LP` : t('tile.unranked');
  return `<div class="p-row">
    ${p.championId ? `<img class="ch" src="${champIcon(p.championId)}" alt="">` : p.iconId != null ? `<img class="ch round" src="${iconUrl(p.iconId)}" alt="">` : '<span class="ch"></span>'}
    <div class="p-name"><b>${esc(p.gameName || '?')}</b><small>${p.tagLine ? '#' + esc(p.tagLine) : ''}${p.position ? ' · ' + esc(p.position) : ''}</small></div>
    <div class="p-rank">${r ? `<img src="${crestUrl(r.tier)}" alt="">` : ''}${rank}</div>
    ${p.gameName ? `<button class="chip" data-opgg="${esc(p.gameName + '#' + p.tagLine)}">op.gg</button>` : ''}
  </div>`;
}
function renderLive(force) {
  if (!force && document.activeElement && document.activeElement.closest && document.activeElement.closest('#liveBody input')) return;
  const d = liveData || {};
  $('liveSub').textContent = !d.clientUp ? t('app.closed') : phaseName(d.phase);
  $('liveDot').hidden = !(d.clash && d.clash.opponents && d.clash.opponents.length) && !d.champSelect && !d.lobby;
  const parts = [];
  if (d.clash && d.clash.opponents && d.clash.opponents.length) {
    const ids = d.clash.opponents.filter(o => o.gameName).map(o => o.gameName + '#' + o.tagLine);
    parts.push(`<div class="live-card"><div class="lc-head"><h3>${t('live.clash')} – ${esc(d.clash.teamName || '')} ${d.clash.teamTag ? '[' + esc(d.clash.teamTag) + ']' : ''}</h3>
      <button class="btn gold ext-btn" id="clashAll" data-ids="${esc(ids.join('|'))}"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${t('live.multiOpgg')}</button></div>
      ${d.clash.opponents.map(playerRow).join('')}</div>`);
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
  if (!parts.length) parts.push(`<div class="live-card"><p class="fine">${t('live.nothing')}</p></div>`);
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
  if (e.target.closest('#clashAll')) return api.openMulti((liveData && liveData.region) || (selected() && selected().region) || 'euw', e.target.closest('#clashAll').dataset.ids.split('|'));
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
