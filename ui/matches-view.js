// Match history page: recent games of all saved accounts in one list (op.gg style, kept short).
// Uses the globals of renderer.js / views.js (S, t, $, esc, api, CHAMP_ICON, SITES, openSite …).

const QUEUE_NAMES = { 420: 'Solo/Duo', 440: 'Flex', 450: 'ARAM', 2400: 'ARAM', 1700: 'Arena', 1710: 'Arena', 900: 'URF', 1900: 'URF' };
const NORMAL_QUEUES = [400, 430, 480, 490];
const MULTI = { 2: 'mh.double', 3: 'mh.triple', 4: 'mh.quadra', 5: 'mh.penta' };
const MH_DEFAULT = { from: '', to: '', range: 'all', result: '', champ: 0, sort: 'new', minKills: '', maxDeaths: '', minKda: '', minMulti: '' };
// tier -> short chip text and colour
const TIER_SHORT = { IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P', EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };
function rankChip(r, kind) {
  if (!r) return `<i class="rk-c ${kind} none">–</i>`;
  const [tier, div] = r;
  const short = TIER_SHORT[tier] ? TIER_SHORT[tier] + (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : ROMAN[div] || '') : '?';
  return `<i class="rk-c ${kind} t-${String(tier).toLowerCase()}">${short}</i>`;
}
// wide windows: "[crest] Emerald I  33 LP" (the column header says Solo/Duo or Flex)
function rankCell(r) {
  if (!r) return '<i class="rk-cell none">–</i>';
  const [tier, div, lp] = r;
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
  return `<i class="rk-cell t-${String(tier).toLowerCase()}"><img src="${crestUrl(tier)}" alt=""><b>${esc(tierName(tier) + (apex ? '' : ' ' + div))}</b><small>${lp} LP</small></i>`;
}

// ---------- the ten players ----------
const POSITIONS = ['top', 'jungle', 'mid', 'bot', 'support'];
const POS_FILE = { top: 'top', jungle: 'jungle', mid: 'middle', bot: 'bottom', support: 'utility' };
const posIcon = p => 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-' + POS_FILE[p] + '.png';
// own team on the left. Positions (and the icons in the middle) only when both teams have all five –
// they are Riot's guess from the game, so anything less is shown in the client's order.
function lineUp(g, mine) {
  const ids = [...new Set(g.players.map(p => p.team))];
  let a, b;
  if (ids.length === 2) {
    const own = g.players.find(p => mine.has(p.puuid));
    const left = own ? own.team : ids[0];
    a = g.players.filter(p => p.team === left); b = g.players.filter(p => p.team !== left);
  } else { const h = Math.ceil(g.players.length / 2); a = g.players.slice(0, h); b = g.players.slice(h); }
  const full = t => t.length === 5 && POSITIONS.every(p => t.some(x => x.pos === p));
  if (full(a) && full(b)) return { a: POSITIONS.map(p => a.find(x => x.pos === p)), b: POSITIONS.map(p => b.find(x => x.pos === p)), roles: POSITIONS };
  return { a, b, roles: null };
}
function teamsTable(g, mine) {
  const { a, b, roles } = lineUp(g, mine);
  const shownName = p => (hides('name') && mine.has(p.puuid) ? dispName(S.accounts.find(x => x.puuid === p.puuid) || {}) : p.name || '?');
  // one player = 5 cells: Solo, Flex (wide), chips (narrow), name, champion – mirrored on the right
  const player = (p, side) => {
    const r = side === 'r';
    if (!p) return ['w', 'w', 'n', 'nm', 'im'].map(c => `<span class="mh-c ${c} ${side}"></span>`)[r ? 'reverse' : 'slice']().join('');
    const rk = mh.ranks[p.puuid];
    const tip = p.name + (p.tag ? '#' + p.tag : '') + (rk ? `\nSolo/Duo: ${rankTip(rk.s)}\nFlex: ${rankTip(rk.f)}\n(${t('mh.rankNow')})` : '');
    const at = `data-player="${esc(JSON.stringify({ gameName: p.name, tagLine: p.tag }))}" title="${esc(tip)}"`;
    const cells = [
      `<span class="mh-c w rk ${side}" ${at}>${rankCell(rk && rk.s)}</span>`,
      `<span class="mh-c w rk ${side}" ${at}>${rankCell(rk && rk.f)}</span>`,
      `<span class="mh-c n ${side}" ${at}>${rk ? (r ? rankChip(rk.f, 'flex') + rankChip(rk.s, 'solo') : rankChip(rk.s, 'solo') + rankChip(rk.f, 'flex')) : ''}</span>`,
      `<span class="mh-c nm ${side}${mine.has(p.puuid) ? ' me' : ''}" ${at}>${esc(shownName(p))}</span>`,
      `<span class="mh-c im ${side}" ${at}><img src="${CHAMP_ICON(p.champ)}" alt=""></span>`,
    ];
    return (r ? cells.reverse() : cells).join('');
  };
  const head = ['Solo/Duo', 'Flex', '', '', '', '', '', 'Flex', 'Solo/Duo'].map((x, i) => `<span class="mh-h w${i > 4 ? ' r' : ''}">${x}</span>`).join('');
  let html = head;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const role = roles ? `<img src="${posIcon(roles[i])}" alt="" title="${esc(t('pos.' + roles[i]))}">` : '';
    html += player(a[i], 'l') + `<span class="mh-c role">${role}</span>` + player(b[i], 'r');
  }
  return html;
}
function rankTip(r) {
  if (!r) return t('tile.unranked');
  const [tier, div, lp] = r;
  return tierName(tier) + (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : ' ' + div) + ' · ' + lp + ' LP';
}
let mh = { pin: 0, ranks: {}, filter: { puuid: '', queue: '' }, f: { ...MH_DEFAULT }, show: 40, adv: false, data: null, loading: false };

function queueLabel(g) {
  if (QUEUE_NAMES[g.q]) return QUEUE_NAMES[g.q] + ([420, 440].includes(g.q) ? ' ' + t('mh.ranked') : '');
  if (NORMAL_QUEUES.includes(g.q)) return t('mh.normal');
  return g.mode ? g.mode.charAt(0) + g.mode.slice(1).toLowerCase() : t('mh.other');
}
const dur = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const short = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

// storage of the saved games (no limit: they stay until deleted here)
const fmtBytes = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
async function loadStorage() {
  const s = await api.matchesStorage();
  if (!s) return;
  $('mhStoreText').textContent = fmtBytes(s.bytes) + ' · ' + t('mh.storeGames', { n: s.games.toLocaleString(locale()) });
  $('mhClear').disabled = !s.games && !s.bytes;
}
$('mhClear').onclick = async () => {
  const s = (await api.matchesStorage()) || { bytes: 0, games: 0 };
  const ok = await confirmBox(t('mh.clearTitle'), t('mh.clearText', { n: s.games.toLocaleString(locale()), size: fmtBytes(s.bytes) }),
    t('mh.clearYes'), t('mh.clearWarn'));
  if (!ok) return;
  await api.matchesClear();
  mh.pin = 0; mh.ranks = {}; mh.cache.clear();
  toast(t('mh.cleared'));
  loadMatches();
};

// The page keeps every game it has seen (mh.cache, by id). It asks the app for the small list of
// all games ([id, time, queue, owners…]) and then only for the games it doesn't have yet –
// so even years of history load once, and a new game is one small request.
mh.cache = new Map();
let assets = null;
async function loadMatches() {
  loadStorage();
  if (mh.loading) { mh.again = true; return; }
  mh.loading = true;
  try {
    if (!champs.length) champs = (await api.champions()) || [];   // names for the champion filter
    if (!assets || !Object.keys(assets.items || {}).length) assets = (await api.matchesAssets()) || null;
    const d = await api.matches({ puuid: mh.filter.puuid || null, queue: mh.filter.queue || null });
    if (d) {
      const lack = d.index.map(r => r[0]).filter(id => !mh.cache.has(id));
      for (let i = 0; i < lack.length; i += 500) {
        for (const g of (await api.matchesGet(lack.slice(i, i + 500))) || []) mh.cache.set(String(g.id), g);
      }
      const games = d.index.filter(r => mh.cache.has(r[0])).map(r => ({ ...mh.cache.get(r[0]), owners: r.slice(3) }));
      mh.data = { games, waiting: d.waiting, loadingOlder: d.loadingOlder, clientUp: d.clientUp, assets: assets || {} };
    }
  } catch (e) { console.warn('matches', e); }
  mh.loading = false;
  renderMatches();
  if (mh.again) { mh.again = false; loadMatches(); }
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
  syncFilterInputs();
  if (!d.games.length) { $('mhSummary').innerHTML = ''; $('mhList').innerHTML = `<div class="mh-empty">${t(d.clientUp ? 'mh.empty' : 'mh.emptyOffline')}</div>`; return; }
  const list = MatchFilter.filterGames(d.games, mh.f);
  $('mhSummary').innerHTML = summaryHtml(list);
  if (!list.length) { $('mhList').innerHTML = `<div class="mh-empty">${t('mh.noMatch')}</div>`; return; }
  const isPinned = g => mh.pin && !g.remake && Math.min(5, MatchFilter.me(g).multi || 0) === mh.pin;
  const pinned = mh.pin ? list.filter(isPinned) : [];
  const rest = pinned.length ? list.filter(g => !isPinned(g)) : list;
  const shown = rest.slice(0, mh.show);
  loadRanks(pinned.concat(shown));
  const rows = gs => gs.map(g => gameRow(g, d.assets || {})).join('');
  $('mhList').innerHTML = (pinned.length
      ? `<div class="mh-sec pin"><span>${esc(t(MULTI[mh.pin]))} · ${pinned.length}</span><button class="mh-unpin" data-pin="${mh.pin}" title="${esc(t('mh.unpin'))}">✕</button></div>`
        + rows(pinned) + (rest.length ? `<div class="mh-sec">${esc(t('mh.otherGames'))}</div>` : '')
      : '')
    + rows(shown)
    + (rest.length > shown.length ? `<div class="mh-more"><button class="btn" id="mhShowMore">${t('mh.showMore', { n: rest.length - shown.length })}</button></div>` : '');
}

// ---------- ranks of the players ----------
let ranksBusy = false;
async function loadRanks(games) {
  // players grouped by the server of the game (= the server of the own account that played it)
  const byReg = new Map();
  for (const g of games) {
    const owner = S.accounts.find(a => a.puuid === g.owners[0]);
    const reg = (owner && owner.region) || '';
    const set = byReg.get(reg) || new Set();
    for (const p of g.players) if (p.puuid) set.add(p.puuid);
    byReg.set(reg, set);
  }
  const ids = [...byReg.values()].flatMap(s => [...s]);
  if (ranksBusy || !ids.length) return;
  const missing = ids.filter(p => !mh.ranks[p]);
  if (!missing.length && mh.ranksChecked) return;
  ranksBusy = true;
  try {
    const r = await api.playerRanks([...byReg].map(([region, set]) => ({ region, ids: [...set] })));
    mh.ranksChecked = true;
    const before = Object.keys(mh.ranks).length;
    Object.assign(mh.ranks, (r && r.ranks) || {});
    const grew = Object.keys(mh.ranks).length > before;
    ranksBusy = false;
    if (grew && view === 'matches') renderMatches();
    else if (r && r.pending && view === 'matches') setTimeout(() => loadRanks(games), 500);
  } catch { ranksBusy = false; }
}

// ---------- filters ----------
const champName = id => ((typeof champById === 'function' && champById(id)) || {}).name || '';
function syncFilterInputs() {
  const f = mh.f;
  $('mhRange').value = f.range; $('mhSort').value = f.sort;
  $('mhDates').hidden = f.range !== 'custom';
  if (document.activeElement !== $('mhFrom')) $('mhFrom').value = f.from;
  if (document.activeElement !== $('mhTo')) $('mhTo').value = f.to; $('mhMulti').value = String(f.minMulti || '');
  document.querySelectorAll('[data-mhr]').forEach(b => b.classList.toggle('on', b.dataset.mhr === f.result));
  if (document.activeElement !== $('mhChamp')) $('mhChamp').value = f.champ ? champName(f.champ) : '';
  for (const [id, k] of [['mhMinK', 'minKills'], ['mhMaxD', 'maxDeaths'], ['mhMinKda', 'minKda']]) if (document.activeElement !== $(id)) $(id).value = f[k];
  $('mhAdv').hidden = !mh.adv;
  $('mhAdvBtn').classList.toggle('open', mh.adv);
  const advOn = ['minKills', 'maxDeaths', 'minKda', 'minMulti'].some(k => f[k] !== '' && f[k] != null);
  $('mhAdvBtn').classList.toggle('active', advOn);
  // champions you actually played, for the suggestions
  if (mh.data && !$('mhChampList').childElementCount) {
    const ids = [...new Set(mh.data.games.map(g => MatchFilter.me(g).champ))];
    $('mhChampList').innerHTML = ids.map(champName).filter(Boolean).sort().map(n => `<option value="${esc(n)}">`).join('');
  }
}
function setFilter(patch) { Object.assign(mh.f, patch); mh.show = 40; renderMatches(); }
$('mhRange').onchange = () => {
  const range = $('mhRange').value;
  // custom: start with the last 7 days so both fields have something sensible
  if (range === 'custom' && !mh.f.from && !mh.f.to) {
    const iso = d => new Date(d - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return setFilter({ range, from: iso(Date.now() - 6 * 86400000), to: iso(Date.now()) });
  }
  setFilter({ range });
};
$('mhFrom').onchange = () => setFilter({ from: $('mhFrom').value });
$('mhTo').onchange = () => setFilter({ to: $('mhTo').value });
$('mhSort').onchange = () => setFilter({ sort: $('mhSort').value });
$('mhMulti').onchange = () => setFilter({ minMulti: $('mhMulti').value });
document.querySelectorAll('[data-mhr]').forEach(b => (b.onclick = () => setFilter({ result: b.dataset.mhr })));
$('mhChamp').oninput = () => {
  const v = $('mhChamp').value.trim();
  const c = v && typeof champByName === 'function' ? champByName(v) : null;
  if (!v) setFilter({ champ: 0 }); else if (c && c.id !== mh.f.champ) setFilter({ champ: c.id });
};
for (const [id, k] of [['mhMinK', 'minKills'], ['mhMaxD', 'maxDeaths'], ['mhMinKda', 'minKda']]) $(id).oninput = () => setFilter({ [k]: $(id).value });
$('mhAdvBtn').onclick = () => { mh.adv = !mh.adv; renderMatches(); };
$('mhReset').onclick = () => { mh.pin = 0; mh.f = { ...MH_DEFAULT }; $('mhChamp').value = ''; renderMatches(); };

// totals of what the filters show, plus a few records (click one to jump to that game)
function summaryHtml(list) {
  const s = MatchFilter.summarize(list);
  if (!s) return '';
  const f1 = x => x.toFixed(1);
  const rec = (key, label, x, val) => x ? `<button class="mh-rec" data-goto="${esc(x.g.id)}" title="${esc(new Date(x.g.t).toLocaleString(locale()))}">
      <img src="${CHAMP_ICON(x.p.champ)}" alt=""><span>${label}</span><b>${val}</b></button>` : '';
  const r = s.records;
  return `<div class="mh-sum">
    <div class="mh-tot">
      <span><b>${s.games}</b> ${t('mh.sumGames')}</span>
      <span class="${s.winrate >= 50 ? 'good' : 'bad'}"><b>${s.winrate}%</b> ${t('mh.sumWins', { w: s.wins, l: s.games - s.wins })}</span>
      <span>Ø <b>${f1(s.avg.k)} / <i>${f1(s.avg.d)}</i> / ${f1(s.avg.a)}</b> (${s.avg.kda == null ? t('mh.perfect') : s.avg.kda.toFixed(2) + ' KDA'})</span>
      <span>Ø <b>${f1(s.avg.csMin)}</b> CS/min</span>
      <span>Ø <b>${short(Math.round(s.avg.dmg))}</b> ${t('mh.dmg')}</span>
      ${s.streak && s.streak.n >= 2 ? `<span class="${s.streak.win ? 'good' : 'bad'}">${t(s.streak.win ? 'mh.streakW' : 'mh.streakL', { n: s.streak.n })}</span>` : ''}
    </div>
    ${[5, 4, 3, 2].some(m => s.multis[m]) ? `<div class="mh-multis">${[5, 4, 3, 2].filter(m => s.multis[m]).map(m =>
      `<button class="mh-multi m${m}${mh.pin === m ? ' on' : ''}" data-pin="${m}">${s.multis[m]}× ${esc(t(MULTI[m]))}</button>`).join('')}</div>` : ''}
    <div class="mh-recs">
      ${rec('kills', t('mh.recKills'), r.kills, r.kills && r.kills.p.k)}
      ${rec('deaths', t('mh.recDeaths'), r.deaths, r.deaths && r.deaths.p.d)}
      ${rec('kda', t('mh.recKda'), r.kda, r.kda && (r.kda.p.d ? ((r.kda.p.k + r.kda.p.a) / r.kda.p.d).toFixed(1) : t('mh.perfect')))}
      ${rec('dmg', t('mh.recDmg'), r.dmg, r.dmg && short(r.dmg.p.dmg))}
    </div>
  </div>`;
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
  return `<div class="mh-row ${res}" data-owner="${esc(ownerId)}" data-gid="${esc(g.id)}">
    <div class="mh-meta">
      <b class="mh-q">${esc(queueLabel(g))}</b>
      <span title="${esc(new Date(g.t).toLocaleString(locale()))}">${esc(ago(g.t))}</span>
      <hr>
      <b class="mh-res">${t('mh.' + res)}</b>
      <span>${dur(g.dur)}</span>
      ${owner ? `<div class="mh-acc" title="${esc(fullName(owner))}">
        <span class="mh-av">${owner.iconId != null && !hides('icon') ? `<img src="${iconUrl(owner.iconId)}" alt="">` : ''}${owner.level && !hides('level') ? `<i>${owner.level}</i>` : ''}</span>
        <span class="mh-an">${esc(dispName(owner))}${others.length ? ` <small>+${others.length}</small>` : ''}</span>
      </div>` : ''}
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
    <div class="mh-teams">${teamsTable(g, mine)}</div>
  </div>`;
}

// filters
$('mhAccount').onchange = () => { mh.filter.puuid = $('mhAccount').value; loadMatches(); };
document.querySelectorAll('[data-mhq]').forEach(b => (b.onclick = () => { mh.filter.queue = b.dataset.mhq; loadMatches(); }));
// "show more" and jumping to a record's game
$('viewMatches').addEventListener('click', e => {
  if (e.target.closest('#mhShowMore')) { mh.show += 40; renderMatches(); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    mh.pin = mh.pin === Number(pin.dataset.pin) ? 0 : Number(pin.dataset.pin);
    renderMatches();
    if (mh.pin) $('mhList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const go = e.target.closest('[data-goto]');
  if (!go) return;
  const find = () => document.querySelector(`.mh-row[data-gid="${CSS.escape(go.dataset.goto)}"]`);
  if (!find()) { mh.show = 2000; renderMatches(); }
  const row = find();
  if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
});
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
let mhChanged = null;
api.onMatchesChanged(() => {
  clearTimeout(mhChanged);
  mhChanged = setTimeout(() => { if (view === 'matches') loadMatches(); }, 1200);
});
