// Match history page: recent games of all saved accounts in one list (op.gg style, kept short).
// Uses the globals of renderer.js / views.js (S, t, $, esc, api, CHAMP_ICON, SITES, openSite …).

const QUEUE_NAMES = { 420: 'Solo/Duo', 440: 'Flex', 450: 'ARAM', 2400: 'ARAM', 1700: 'Arena', 1710: 'Arena', 900: 'URF', 1900: 'URF' };
const NORMAL_QUEUES = [400, 430, 480, 490];
const MULTI = { 2: 'mh.double', 3: 'mh.triple', 4: 'mh.quadra', 5: 'mh.penta' };
let mh = { filter: { puuid: '', queue: '' }, data: null, loading: false };

function queueLabel(g) {
  if (QUEUE_NAMES[g.q]) return QUEUE_NAMES[g.q] + ([420, 440].includes(g.q) ? ' ' + t('mh.ranked') : '');
  if (NORMAL_QUEUES.includes(g.q)) return t('mh.normal');
  return g.mode ? g.mode.charAt(0) + g.mode.slice(1).toLowerCase() : t('mh.other');
}
const dur = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const short = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

async function loadMatches() {
  if (mh.loading) return;
  mh.loading = true;
  try {
    mh.data = await api.matches({ puuid: mh.filter.puuid || null, queue: mh.filter.queue || null, limit: mh.limit || 80 });
  } catch (e) { console.warn('matches', e); }
  mh.loading = false;
  renderMatches();
}

function renderMatches() {
  if (view !== 'matches') return;
  const accs = S.accounts.filter(a => !a.placeholder);
  const d = mh.data;
  $('mhAccount').innerHTML = `<option value="">${esc(t('mh.allAccounts'))}</option>`
    + accs.map(a => `<option value="${esc(a.puuid)}">${esc(dispName(a))}</option>`).join('');
  $('mhAccount').value = mh.filter.puuid;
  document.querySelectorAll('[data-mhq]').forEach(b => b.classList.toggle('on', b.dataset.mhq === mh.filter.queue));
  // "Load older games": always at the top; greyed out (with the reason) while League is closed
  const more = $('mhMore');
  more.textContent = d && d.loadingOlder ? t('mh.loadingOlder') : t('mh.more');
  // only blocked while it is already loading; without League a click explains why
  more.disabled = !!(d && d.loadingOlder);
  more.title = '';
  if (!d) { $('mhList').innerHTML = `<div class="mh-empty">${t('mh.loading')}</div>`; return; }
  $('mhSub').textContent = d.waiting && d.clientUp ? t('mh.fetching', { n: d.waiting }) : !d.clientUp ? t('mh.offline') : t('mh.sub');
  if (!d.games.length) { $('mhList').innerHTML = `<div class="mh-empty">${t(d.clientUp ? 'mh.empty' : 'mh.emptyOffline')}</div>`; return; }
  $('mhList').innerHTML = d.games.map(g => gameRow(g, d.assets || {})).join('');
}

function icon(map, id, cls) {
  const x = map && map[id];
  return x && x[0] ? `<img class="${cls}" src="${esc(x[0])}" title="${esc(x[1] || '')}" alt="">` : `<span class="${cls} none"></span>`;
}

function gameRow(g, as) {
  const ownerId = g.owners[0];
  const me = g.players.find(p => p.puuid === ownerId) || g.players[0];
  const team = g.players.filter(p => p.team === me.team);
  const teamKills = team.reduce((s, p) => s + p.k, 0);
  const kp = teamKills ? Math.round(100 * (me.k + me.a) / teamKills) : 0;
  const ratio = me.d ? ((me.k + me.a) / me.d).toFixed(2) + ':1' : t('mh.perfect');
  const mins = Math.max(1, g.dur / 60);
  const res = g.remake ? 'remake' : me.win ? 'win' : 'loss';
  const owner = S.accounts.find(a => a.puuid === ownerId);
  const others = g.owners.slice(1).map(id => S.accounts.find(a => a.puuid === id)).filter(Boolean);
  const mine = new Set(g.owners);
  const side = teamId => g.players.filter(p => p.team === teamId).map(p => `
      <button class="mh-p${mine.has(p.puuid) ? ' me' : ''}" data-player="${esc(JSON.stringify({ gameName: p.name, tagLine: p.tag }))}" title="${esc(p.name + (p.tag ? '#' + p.tag : ''))}">
        <img src="${CHAMP_ICON(p.champ)}" alt=""><span>${esc(hides('name') && mine.has(p.puuid) ? dispName(S.accounts.find(a => a.puuid === p.puuid) || {}) : p.name || '?')}</span>
      </button>`).join('');
  const teams = [...new Set(g.players.map(p => p.team))];
  return `<div class="mh-row ${res}" data-owner="${esc(ownerId)}">
    <div class="mh-meta">
      <b class="mh-q">${esc(queueLabel(g))}</b>
      <span title="${esc(new Date(g.t).toLocaleString(locale()))}">${esc(ago(g.t))}</span>
      <hr>
      <b class="mh-res">${t('mh.' + res)}</b>
      <span>${dur(g.dur)}</span>
      ${owner ? `<span class="mh-owner" title="${esc(fullName(owner))}">${esc(dispName(owner))}${others.length ? ' +' + others.length : ''}</span>` : ''}
    </div>
    <div class="mh-main">
      <div class="mh-top">
        <div class="mh-champ"><img src="${CHAMP_ICON(me.champ)}" alt=""><span>${me.lvl}</span></div>
        <div class="mh-col">${icon(as.spells, me.spells[0], 'mh-ic')}${icon(as.spells, me.spells[1], 'mh-ic')}</div>
        <div class="mh-col">${icon(as.perks, me.keystone, 'mh-ic round')}${icon(as.styles, me.sub, 'mh-ic round small')}</div>
        <div class="mh-kda">
          <div class="mh-k">${me.k} / <i>${me.d}</i> / ${me.a}</div>
          <div class="mh-ratio">${ratio} ${t('mh.kda')}</div>
        </div>
        <div class="mh-stats">
          <span>${t('mh.kp')} <b>${kp}%</b></span>
          <span>CS <b>${me.cs}</b> (${(me.cs / mins).toFixed(1)})</span>
          <span>${t('mh.dmg')} <b>${short(me.dmg)}</b></span>
          <span>${t('mh.gold')} <b>${short(me.gold)}</b></span>
        </div>
      </div>
      <div class="mh-items">${me.items.map((id, i) => (id ? icon(as.items, id, 'mh-it' + (i === 6 ? ' trinket' : '')) : `<span class="mh-it none${i === 6 ? ' trinket' : ''}"></span>`)).join('')}
        ${MULTI[me.multi] ? `<span class="mh-badge">${t(MULTI[me.multi])}</span>` : ''}</div>
    </div>
    <div class="mh-teams">${teams.map(tid => `<div class="mh-team">${side(tid)}</div>`).join('')}</div>
  </div>`;
}

// filters
$('mhAccount').onchange = () => { mh.filter.puuid = $('mhAccount').value; loadMatches(); };
document.querySelectorAll('[data-mhq]').forEach(b => (b.onclick = () => { mh.filter.queue = b.dataset.mhq; loadMatches(); }));
// older games: every account, one timeline
$('viewMatches').addEventListener('click', async e => {
  if (!e.target.closest('#mhMore')) return;
  // games come from the League client: without it, say so instead of doing nothing
  if (!(mh.data && mh.data.clientUp) && !(S.live && S.live.clientUp)) return toast(t('mh.moreOffline'), true);
  e.target.closest('#mhMore').disabled = true;
  e.target.closest('#mhMore').textContent = t('mh.loadingOlder');
  const r = await api.matchesMore();
  if (r && r.offline) toast(t('mh.moreOffline'), true);
  if (r && r.ok) mh.limit = (mh.limit || 80) + 80;
  if (r && r.ok && !r.added) toast(t('mh.noOlder'));
  loadMatches();
});
// a player's name: "open with" menu (op.gg, Porofessor …), region of the owning account
$('mhList').addEventListener('click', e => {
  const b = e.target.closest('[data-player]');
  if (!b) return;
  e.stopPropagation();
  const p = JSON.parse(b.dataset.player);
  if (!p.gameName) return;
  const row = b.closest('.mh-row');
  const owner = S.accounts.find(a => a.puuid === (row && row.dataset.owner)) || selected();
  const m = $('siteMenu');
  m.innerHTML = `<div class="menu-label">${esc(p.gameName + (p.tagLine ? '#' + p.tagLine : ''))}</div>`
    + SITES.map(([k, n]) => `<button data-site="${k}">${n}</button>`).join('');
  m.dataset.id = '';
  m.dataset.player = JSON.stringify({ ...p, region: (owner && owner.region) || (S.live && S.live.region) || 'EUW' });
  const r = b.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
});
api.onMatchesChanged(() => { if (view === 'matches') loadMatches(); });
