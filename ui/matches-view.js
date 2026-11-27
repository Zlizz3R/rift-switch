// Match history page: recent games of all saved accounts in one list (op.gg style, kept short).
// Uses the globals of renderer.js / views.js (S, t, $, esc, api, CHAMP_ICON, SITES, openSite …).

const QUEUE_NAMES = { 420: 'Solo/Duo', 440: 'Flex', 710: 'Ranked 5v5', 4310: 'Classic 5v5', 700: 'Clash', 720: 'ARAM Clash', 450: 'ARAM', 2400: 'ARAM', 1700: 'Arena', 1710: 'Arena', 1740: 'Arena', 1750: 'Arena', 900: 'URF', 1900: 'URF' };
// a queue the list doesn't know: the game mode's name as players know it (Riot's own names are code
// words – CHERRY is Arena, KIWI ARAM: Mayhem, STRAWBERRY Swarm)
const MODE_NAMES = { CHERRY: 'Arena', KIWI: 'ARAM: Mayhem', STRAWBERRY: 'Swarm', ARAM: 'ARAM', CLASSIC: "Summoner's Rift", URF: 'URF', ARURF: 'ARURF',
  ONEFORALL: 'One for All', NEXUSBLITZ: 'Nexus Blitz', ULTBOOK: 'Ultimate Spellbook', TUTORIAL: 'Tutorial', PRACTICETOOL: 'Practice Tool' };
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

// ---------- details of one game (click a game) ----------
const k1 = n => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + k1(Math.abs(n));
// a lead over the game: above the middle line the left side is ahead, below the right side
// (teams: blue / red; two players: gold / light blue). Hovering shows the lead at that minute.
function diffChart(diff, id, cls) {
  const max = Math.max(1000, ...diff.map(Math.abs));
  const W = 600, H = 120, x = i => (i / Math.max(1, diff.length - 1)) * W, y = v => H / 2 - (v / max) * (H / 2 - 6);
  const pts = diff.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ms = [10, 15, 20, 25, 30, 35, 40].filter(m => m < diff.length);
  // minute labels as text under the chart (inside the stretched SVG they would be distorted)
  const labels = ms.map(m => `<span style="left:${(100 * m / Math.max(1, diff.length - 1)).toFixed(2)}%">${m}′</span>`).join('');
  return `<div class="det-chart ${cls}">
    <div class="dc-plot" data-diff="${diff.join(',')}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ms.map(m => `<line x1="${x(m)}" x2="${x(m)}" y1="0" y2="${H}" class="gl"/>`).join('')}
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="zero"/>
      <clipPath id="up${id}"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath>
      <clipPath id="dn${id}"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath>
      <polygon points="0,${H / 2} ${pts} ${W},${H / 2}" class="a-up" clip-path="url(#up${id})"/>
      <polygon points="0,${H / 2} ${pts} ${W},${H / 2}" class="a-dn" clip-path="url(#dn${id})"/>
      <polyline points="${pts}" class="ln"/></svg><i class="dc-cur" hidden></i><span class="dc-tip" hidden></span></div>
    <div class="det-mins">${labels}</div>
    <div class="det-scale"><span>±${k1(max)}</span><span>${t('det.goldEnd')}: ${sign(diff[diff.length - 1])}</span></div></div>`;
}
function goldChart(g, left) {
  // blue minus red (left minus right) team gold per minute
  const L = g.players.map((p, i) => (p.team === left ? i : -1)).filter(i => i >= 0);
  const R = g.players.map((_, i) => i).filter(i => !L.includes(i));
  const diff = g.gold.map(f => L.reduce((s, i) => s + (f[i] || 0), 0) - R.reduce((s, i) => s + (f[i] || 0), 0));
  return diffChart(diff, 't' + g.id, 'team');
}
// hover: a line and the lead at that minute
document.addEventListener('mousemove', e => {
  const plot = e.target.closest && e.target.closest('.dc-plot');
  document.querySelectorAll('.dc-plot.hov').forEach(p => { if (p !== plot) { p.classList.remove('hov'); p.querySelector('.dc-cur').hidden = p.querySelector('.dc-tip').hidden = true; } });
  if (!plot) return;
  const d = plot.dataset.diff.split(',').map(Number);
  const r = plot.getBoundingClientRect();
  const i = Math.max(0, Math.min(d.length - 1, Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (d.length - 1))));
  const left = (100 * i) / Math.max(1, d.length - 1);
  const cur = plot.querySelector('.dc-cur'), tip = plot.querySelector('.dc-tip');
  plot.classList.add('hov');
  cur.hidden = tip.hidden = false;
  cur.style.left = left + '%';
  tip.innerHTML = `${i}′ <b class="${d[i] > 0 ? 'up' : d[i] < 0 ? 'down' : ''}">${sign(d[i])}</b>`;
  tip.style.left = Math.min(92, Math.max(8, left)) + '%';
});
function detailsHtml(g, as, mine) {
  const { a, b, roles } = lineUp(g, mine);
  // lane against lane: who was ahead at the end (and at 10 / 15 minutes from the gold timeline)
  let h2h = '';
  if (roles) {
    const at = (p, m) => { if (!g.gold || g.gold.length <= m) return null; const i = g.players.indexOf(p); return g.gold[m][i]; };
    const cell = (v, fmt = sign) => `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v == null ? '–' : fmt(v)}</span>`;
    h2h = `<table class="det-h2h"><thead><tr><th></th>
        ${g.gold && g.gold.length > 10 ? `<th>${t('det.goldAt', { m: 10 })}</th>` : ''}${g.gold && g.gold.length > 15 ? `<th>${t('det.goldAt', { m: 15 })}</th>` : ''}
        <th>${t('det.goldEnd')}</th><th>CS</th><th>${t('det.dmg')}</th><th>Level</th><th></th></tr></thead><tbody>${roles.map((r, i) => {
      const L = a[i], R = b[i];
      const d = (f) => f(L) - f(R);
      return `<tr><td class="dc"><img src="${CHAMP_ICON(L.champ)}" alt=""><span>${esc(L.name || '?')}</span></td>
        ${g.gold && g.gold.length > 10 ? `<td>${cell(at(L, 10) - at(R, 10))}</td>` : ''}${g.gold && g.gold.length > 15 ? `<td>${cell(at(L, 15) - at(R, 15))}</td>` : ''}
        <td>${cell(d(p => p.gold))}</td><td>${cell(d(p => p.cs), v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v))}</td>
        <td>${cell(d(p => p.dmg))}</td><td>${cell(d(p => p.lvl), v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v))}</td>
        <td class="dc r"><span>${esc(R.name || '?')}</span><img src="${CHAMP_ICON(R.champ)}" alt=""><img class="role" src="${posIcon(r)}" alt=""></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const left = Math.min(...g.players.map(p => p.team));
  const old = !g.v || g.v < 3;
  // folding sections like the settings (several may be open); players open at first
  const open = mh.secs.get(String(g.id)) || new Set(['players']);
  const sec = (key, title, body) => body ? `<div class="det-g${open.has(key) ? ' open' : ''}" data-sec="${key}" role="button" tabindex="0"><span>${title}</span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>
    <div class="det-body">${open.has(key) ? body : ''}</div>` : '';
  return `<div class="mh-det" data-det="${esc(String(g.id))}">
    ${old ? `<p class="fine">${t('det.upgrading')}</p>` : ''}
    ${sec('players', t('det.players'), pgTableHtml(g, as, mine))}
    ${sec('h2h', t('det.h2h'), h2h)}
    ${sec('gold', t('det.goldDiff'), g.gold && g.gold.length > 2 ? goldChart(g, left) : '')}
    ${sec('compare', t('det.compare'), compareHtml(g, a, b, roles, mine))}
    ${rpHtml(String(g.id))}
  </div>`;
}

// ---------- the replay of an opened game (through the League client) ----------
// state per game from the background part: download → downloading (progress) → watch; or why not.
// Final answers stay; the others are asked again after 30 s (League opened, a game ended).
// st: id → { state, progress, at, follow (after "download": keep asking until then, the client may
// still say "download" for a moment) }; asking: "id|action" in flight; timer: id → the next check
const rp = { st: new Map(), asking: new Set(), timer: new Map() };
const RP_FINAL = ['incompatible', 'missingOrExpired', 'lost', 'unsupported'];
const RP_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const rpBusy = s => s && (s.state === 'downloading' || s.state === 'checking' || Date.now() < (s.follow || 0));
function rpHtml(id) {
  const s = rp.st.get(id);
  // new, old, or on its way (a game opened again while downloading: the checks go on)
  if (!s || rpBusy(s) || (!RP_FINAL.includes(s.state) && Date.now() - s.at > 30000)) rpAsk(id);
  return `<div class="rp-bar" data-replay="${esc(id)}">${s ? rpInner(id, s) : ''}</div>`;
}
function rpInner(id, s) {
  const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-rpact="${act}" data-rpid="${esc(id)}">${RP_ICON}${esc(label)}</button>`;
  const p = Math.round(s.progress || 0);
  const note = key => `<span class="fine">${esc(t(key, { p }))}</span>`;
  const body = {
    watch: () => btn('watch', t('rp.watch'), 'gold'),
    download: () => btn('download', t('rp.download')),
    retry: () => btn('download', t('rp.download')),
    error: () => btn('download', t('rp.download')),
    downloading: () => `<span class="rp-prog"><i style="width:${p}%"></i></span>${note('rp.downloading')}`,
    checking: () => note('rp.checking'),
    incompatible: () => note('rp.old'),
    noClient: () => note('rp.noClient'),
    inGame: () => note('rp.inGame'),
    disabled: () => note('rp.disabled'),
  }[s.state];
  return `<span class="rp-l">${t('rp.title')}</span>${body ? body() : note('rp.none')}`;
}
function rpPaint(id) {
  const s = rp.st.get(id);
  document.querySelectorAll(`[data-replay="${CSS.escape(id)}"]`).forEach(el => { el.innerHTML = s ? rpInner(id, s) : ''; });
}
// action: 'state' (also while downloading, every 1.5 s) or 'download'
function rpAsk(id, action = 'state') {
  const key = id + '|' + action;
  if (rp.asking.has(key)) return;
  rp.asking.add(key);
  clearTimeout(rp.timer.get(id));
  api.replay(id, action).then(r => {
    rp.asking.delete(key);
    if (!r || !r.state) return;
    const before = rp.st.get(id) || {};
    const follow = before.follow || 0;
    // right after "download" the client may still say "download": keep showing the download
    const s = r.state === 'download' && Date.now() < follow ? { ...before, at: Date.now() } : { ...r, at: Date.now(), follow };
    rp.st.set(id, s);
    rpPaint(id);
    // still on its way: ask again while the game is open
    if (rpBusy(s) && document.querySelector(`[data-replay="${CSS.escape(id)}"]`)) rp.timer.set(id, setTimeout(() => rpAsk(id), 1500));
  }, () => rp.asking.delete(key));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rpact]');
  if (!b) return;
  const id = b.dataset.rpid;
  if (b.dataset.rpact === 'download') {
    rp.st.set(id, { state: 'downloading', progress: 0, at: Date.now(), follow: Date.now() + 8000 });
    rpPaint(id);
    rpAsk(id, 'download');
  } else {
    b.disabled = true;
    api.replay(id, 'watch').then(r => {
      b.disabled = false;
      if (r && r.state === 'inGame') return toast(t('rp.inGame'), true);
      toast(t(r && r.started ? 'rp.started' : 'rp.failed'), !(r && r.started));
    }, () => { b.disabled = false; toast(t('rp.failed'), true); });
  }
});

// ---------- two players side by side (freely chosen) ----------
const CMP_ROWS = [
  ['det.kills', p => p.k], ['det.deaths', p => p.d, true], ['det.assists', p => p.a],
  ['KDA', p => Stats.kda(p.k, p.d, p.a), false, v => v.toFixed(2)],
  ['det.dmg', p => p.dmg], ['det.phys', p => p.x && p.x.phys], ['det.magic', p => p.x && p.x.magic], ['det.true', p => p.x && p.x.true],
  ['det.taken', p => p.x && p.x.taken], ['det.mitig', p => p.x && p.x.mitig], ['det.heal', p => p.x && p.x.heal],
  ['mh.gold', p => p.gold], ['det.spent', p => p.x && p.x.spent],
  ['CS', p => p.cs], ['det.csMin', (p, g) => Stats.csMin(g, p), false, v => v.toFixed(1)],
  ['det.vision', p => p.vis], ['det.wards', p => p.x && p.x.wards], ['det.wardsKilled', p => p.x && p.x.wardsKilled], ['det.pinks', p => p.x && p.x.pinks],
  ['det.cc', p => p.x && p.x.cc, false, v => v + ' s'], ['det.turretDmg', p => p.x && p.x.turretDmg], ['det.obj', p => p.x && p.x.obj],
  ['det.spree', p => p.x && p.x.spree], ['det.crit', p => p.x && p.x.crit], ['Level', p => p.lvl],
];
function compareHtml(g, a, b, roles, mine) {
  const ps = [...a, ...b];
  if (ps.length < 2) return '';
  // first time: me against my lane opponent (or the first of the other team)
  let pair = mh.cmp.get(String(g.id));
  if (!pair) {
    const me = ps.find(p => mine.has(p.puuid)) || ps[0];
    const mySide = a.includes(me) ? a : b, other = mySide === a ? b : a;
    const vs = (roles && other[mySide.indexOf(me)]) || other.find(p => p.pos && p.pos === me.pos) || other[0] || ps.find(p => p !== me);
    pair = [ps.indexOf(me), ps.indexOf(vs)];
  }
  const [P, Q] = [ps[pair[0]] || ps[0], ps[pair[1]] || ps[1]];
  const pick = (which, sel) => `<label class="cmp-pick ${which}"><img src="${CHAMP_ICON(sel.champ)}" alt=""><select data-cmp="${which === 'l' ? 0 : 1}">${ps.map((p, i) => `<option value="${i}" ${p === sel ? 'selected' : ''}>${esc((p.name || '?') + (champName(p.champ) ? ' – ' + champName(p.champ) : ''))}</option>`).join('')}</select></label>`;
  const fmtN = v => Math.round(v).toLocaleString(locale());
  const rows = CMP_ROWS.map(([key, f, lowBetter, fmt]) => {
    const x = f(P, g), y = f(Q, g);
    if (x == null && y == null) return '';
    const v1 = x || 0, v2 = y || 0, max = Math.max(v1, v2) || 1;
    const better = v1 === v2 ? 0 : (v1 > v2) !== !!lowBetter ? 1 : 2;
    const show = v => (fmt ? fmt(v) : fmtN(v));
    return `<div class="cmp-row"><span class="cmp-bar l"><i style="width:${Math.round(100 * v1 / max)}%"></i></span><b class="v1 ${better === 1 ? 'up' : ''}">${show(v1)}</b>
      <span class="cmp-l">${key.includes('.') ? t(key) : key}</span><b class="v2 ${better === 2 ? 'up' : ''}">${show(v2)}</b><span class="cmp-bar r"><i style="width:${Math.round(100 * v2 / max)}%"></i></span></div>`;
  }).join('');
  // their gold over the game (from the timeline)
  let chart = '';
  const i1 = g.players.indexOf(P), i2 = g.players.indexOf(Q);
  if (g.gold && g.gold.length > 2) {
    const s1 = g.gold.map(f => f[i1] || 0), s2 = g.gold.map(f => f[i2] || 0);
    const at = m => `<span>${t('det.goldAt', { m })} <b class="${s1[m] > s2[m] ? 'up' : s1[m] < s2[m] ? 'down' : ''}">${sign(s1[m] - s2[m])}</b></span>`;
    chart = `<div class="det-h cmp-gh">${t('det.goldLead', { a: esc(P.name || '?'), b: esc(Q.name || '?') })}</div>${diffChart(s1.map((v, i) => v - s2[i]), 'c' + g.id, 'cmp-chart')}
      <div class="det-scale cmp-at">${[10, 15, 20].filter(m => m < s1.length).map(at).join('')}</div>`;
  }
  return `<div class="cmp-head">${pick('l', P)}<span class="cmp-vs">VS</span>${pick('r', Q)}</div>
    <div class="cmp-rows">${rows}</div>${chart}`;
}

// ---------- the ten players ----------
const POSITIONS = Stats.POSITIONS;
// the position of every player of a Summoner's Rift game, or null (stats.js)
function gameRoles(g) { return Stats.roles(g); }
const POS_FILE = { top: 'top', jungle: 'jungle', mid: 'middle', bot: 'bottom', support: 'utility' };
const posIcon = p => 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-' + POS_FILE[p] + '.png';
// blue side (100) left, red side (200) right – like the client. Positions (and the icons in the middle) only when both teams have all five –
// they are Riot's guess from the game, so anything less is shown in the client's order.
function lineUp(g, mine) {
  const ids = [...new Set(g.players.map(p => p.team))];
  let a, b;
  if (ids.length === 2) {
    const left = Math.min(...ids);
    a = g.players.filter(p => p.team === left); b = g.players.filter(p => p.team !== left);
  } else { const h = Math.ceil(g.players.length / 2); a = g.players.slice(0, h); b = g.players.slice(h); }
  const ro = gameRoles(g);
  if (ro && a.length === 5 && b.length === 5) return { a: POSITIONS.map(p => a.find(x => ro.get(x) === p)), b: POSITIONS.map(p => b.find(x => ro.get(x) === p)), roles: POSITIONS };
  return { a, b, roles: null };
}
function teamsTable(g, mine) {
  const { a, b, roles } = lineUp(g, mine);
  const shownName = p => (hides('name') && mine.has(p.puuid) ? dispName(S.accounts.find(x => x.puuid === p.puuid) || {}) : p.name || '?');
  // one player = 5 cells: Solo, Flex (wide), chips (narrow), name, champion – mirrored on the right
  const player = (p, side) => {
    const r = side === 'r';
    if (!p) return (r ? ['im', 'nm', 'n', 'w', 'w'] : ['w', 'w', 'n', 'nm', 'im']).map(c => `<span class="mh-c ${c} ${side}"></span>`).join('');
    const rk = mh.ranks[p.puuid];
    const tip = p.name + (p.tag ? '#' + p.tag : '') + (rk ? `\nSolo/Duo: ${rankTip(rk.s)}\nFlex: ${rankTip(rk.f)}\n(${t('mh.rankNow')})` : '');
    const at = `data-player="${esc(JSON.stringify({ puuid: p.puuid, gameName: p.name, tagLine: p.tag }))}" title="${esc(tip)}"`;
    const cells = [
      `<span class="mh-c w rk ${side}" ${at}>${rankCell(rk && rk.s)}</span>`,
      `<span class="mh-c w rk ${side}" ${at}>${rankCell(rk && rk.f)}</span>`,
      `<span class="mh-c n ${side}" ${at}>${rk ? rankChip(rk.s, 'solo') + rankChip(rk.f, 'flex') : ''}</span>`,
      `<span class="mh-c nm ${side}${mine.has(p.puuid) ? ' me' : ''}" ${at}>${esc(shownName(p))}</span>`,
      `<span class="mh-c im ${side}" ${at}><img src="${CHAMP_ICON(p.champ)}" alt=""></span>`,
    ];
    // right side: champion, name | Solo/Duo, Flex (the ranks keep their order on both sides)
    return (r ? [cells[4], cells[3], cells[2], cells[0], cells[1]] : cells).join('');
  };
  const head = ['Solo/Duo', 'Flex', '', '', '', '', '', 'Solo/Duo', 'Flex'].map((x, i) => `<span class="mh-h w${i > 4 ? ' r' : ''}">${x}</span>`).join('');
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
let mh = { open: new Set(), secs: new Map(), cmp: new Map(), pin: 0, ranks: {}, more: {}, filter: { queues: new Set() }, f: { ...MH_DEFAULT }, show: 40, adv: false, data: null, loading: false };
// the match history is a tab of the Overview (mastery.js showDashTab); its accounts are the Overview's
// choice (ovfilter.js) – every account chosen = all games
const mhOn = () => view === 'dash' && typeof dashTab === 'function' && dashTab() === 'matches';
function mhAccSet() {
  const all = ovAccs(), ch = ovChosen();
  return ch.length && ch.length < all.length ? new Set(ch.map(a => a.puuid)) : new Set();
}

// custom games: Riot's own queues for them (matches.rs CUSTOM_QUEUES) or marked when stored
const CUSTOM_QUEUES = [0, 3220, 3270];
const isCustom = g => !!g.custom || CUSTOM_QUEUES.includes(g.q);
function queueLabel(g) {
  if (isCustom(g)) return t('mh.custom');
  if (QUEUE_NAMES[g.q]) return QUEUE_NAMES[g.q] + ([420, 440, 710, 4310].includes(g.q) ? ' ' + t('mh.ranked') : '');
  if (NORMAL_QUEUES.includes(g.q)) return t('mh.normal');
  if (g.mode && MODE_NAMES[g.mode]) return MODE_NAMES[g.mode];
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
// the games of an index ([id, time, queue, owners…]): the ones not in the cache are fetched first
async function mhGames(index) {
  const lack = index.map(r => r[0]).filter(id => !mh.cache.has(id));
  for (let i = 0; i < lack.length; i += 500) {
    for (const g of (await api.matchesGet(lack.slice(i, i + 500))) || []) mh.cache.set(String(g.id), g);
  }
  return index.filter(r => mh.cache.has(r[0])).map(r => ({ ...mh.cache.get(r[0]), owners: r.slice(3) }));
}
// every stored game of every account – the Overview's numbers come from the same games
async function allGames() {
  const d = await api.matches({ puuid: null, queue: null });
  return d && Array.isArray(d.index) ? mhGames(d.index) : null;
}
async function loadMatches() {
  loadStorage();
  if (mh.loading) { mh.again = true; return; }
  mh.loading = true;
  try {
    if (!champs.length) champs = (await api.champions()) || [];   // names for the champion filter
    if (!assets || !Object.keys(assets.items || {}).length) assets = (await api.matchesAssets()) || null;
    // one account: the app filters already; several: all games – kept when one of the chosen played
    // (and that one counts as "me" in the game); filtered here in both cases
    const accs = mhAccSet();
    const d = await api.matches({ puuid: accs.size === 1 ? [...accs][0] : null, queue: [...mh.filter.queues].join(',') || null });
    if (d) {
      const index = accs.size
        ? d.index.filter(r => r.slice(3).some(o => accs.has(o))).map(r => [r[0], r[1], r[2], ...r.slice(3).filter(o => accs.has(o))])
        : d.index;
      const games = await mhGames(index);
      mh.data = { games, waiting: d.waiting, clientUp: d.clientUp, assets: assets || {} };
    }
  } catch (e) { console.warn('matches', e); }
  mh.loading = false;
  renderMatches();
  if (mh.again) { mh.again = false; loadMatches(); }
}

function renderMatches() {
  if (!mhOn()) return;
  const d = mh.data;
  document.querySelectorAll('[data-mhq]').forEach(b => b.classList.toggle('on', b.dataset.mhq ? mh.filter.queues.has(b.dataset.mhq) : !mh.filter.queues.size));
  // the shared "Load" (views.js) loads everything, the whole match history too
  refreshLoadBtns();
  if (!d) { $('mhList').innerHTML = `<div class="mh-empty">${t('mh.loading')}</div>`; return; }
  $('mhSub').textContent = d.waiting && d.clientUp ? t('mh.fetching', { n: d.waiting }) : !d.clientUp ? t('mh.offline') : t('mh.sub');
  syncFilterInputs();
  if (!d.games.length) { $('mhSummary').innerHTML = ''; $('mhList').innerHTML = `<div class="mh-empty">${t(d.clientUp ? 'mh.empty' : 'mh.emptyOffline')}</div>`; return; }
  const list = MatchFilter.filterGames(d.games, mh.f);
  $('mhSummary').innerHTML = summaryHtml(list);
  if (!list.length) { $('mhList').innerHTML = `<div class="mh-empty">${t('mh.noMatch')}</div>`; return; }
  // pinned: games of a multikill kind, or a set of games (a row of the Overview)
  const isPinned = g => (mh.pinIds ? mh.pinIds.has(String(g.id)) : mh.pin && !g.remake && Math.min(5, MatchFilter.me(g).multi || 0) === mh.pin);
  const pinned = mh.pin || mh.pinIds ? list.filter(isPinned) : [];
  const rest = pinned.length ? list.filter(g => !isPinned(g)) : list;
  const shown = rest.slice(0, mh.show);
  loadRanks(pinned.concat(shown));
  const rows = gs => gs.map(g => gameRow(g, d.assets || {})).join('');
  $('mhList').innerHTML = (pinned.length
      ? `<div class="mh-sec pin"><span>${esc(mh.pinIds ? mh.pinLabel : t(MULTI[mh.pin]))} · ${pinned.length}</span><button class="mh-unpin" data-pin="${mh.pinIds ? 'ids' : mh.pin}" title="${esc(t('mh.unpin'))}">✕</button></div>`
        + rows(pinned) + (rest.length ? `<div class="mh-sec">${esc(t('mh.otherGames'))}</div>` : '')
      : '')
    + rows(shown)
    + (rest.length > shown.length ? `<div class="mh-more"><button class="btn" id="mhShowMore">${t('mh.showMore', { n: Math.min(40, rest.length - shown.length) })}</button>`
      + `<button class="btn" id="mhShowAll">${t('mh.showAll', { n: num(rest.length) })}</button></div>` : '');
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
    if (grew) mhRedraw();
    else if (r && r.pending && (mhOn() || view === 'player')) setTimeout(() => loadRanks(games), 500);
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
$('mhReset').onclick = () => { mh.pin = 0; mh.pinIds = null; mh.f = { ...MH_DEFAULT }; $('mhChamp').value = ''; renderMatches(); };

// totals of what the filters show, plus a few records (click one to jump to that game)
// "34 h 12 min" / "48 min"
function playTime(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}
// opts.player: another player's list – no filters there (champions and multikills only to read)
function summaryHtml(list, opts = {}) {
  const pl = !!opts.player;
  const s = MatchFilter.summarize(list, 1000);
  if (!s) return '';
  // 5 of each list, "+5" shows five more, "less" goes back to 5
  const cut = (key, arr) => arr.slice(0, mh.more[key] || 5);
  const more = (key, arr) => {
    const n = mh.more[key] || 5;
    return (arr.length > n ? `<button class="mh-more" data-mhmore="${key}">${t('mh.showMore', { n: Math.min(5, arr.length - n) })}</button>` : '')
      + (n > 5 ? `<button class="mh-more" data-mhless="${key}">${t('mh.showLess')}</button>` : '');
  };
  const f1 = x => x.toFixed(1);
  const rec = (key, label, x, val) => x ? `<button class="mh-rec" data-goto="${esc(x.g.id)}" title="${esc(new Date(x.g.t).toLocaleString(locale()))}">
      <img src="${CHAMP_ICON(x.p.champ)}" alt=""><span>${label}</span><b>${val}</b></button>` : '';
  // records: never mixed between modes – those of the mode with the most games here, with their scope
  const modeOf = g => (g.mode === 'CLASSIC' ? 'sr' : g.mode === 'ARAM' ? 'aram' : g.mode === 'CHERRY' ? 'arena' : 'other');
  const counts = new Map();
  for (const g of list) if (!Stats.isRemake(g)) counts.set(modeOf(g), (counts.get(modeOf(g)) || 0) + 1);
  const mode = [...counts].sort((a, b) => b[1] - a[1])[0];
  const recS = mode ? MatchFilter.summarize(list.filter(g => modeOf(g) === mode[0]), 1) : null;
  const r = recS ? recS.records : {};
  const modeName = mode ? (mode[0] === 'sr' ? "Summoner's Rift" : mode[0] === 'aram' ? 'ARAM' : mode[0] === 'arena' ? 'Arena' : t('mh.other')) : '';
  return `<div class="mh-sum">
    <div class="mh-tot">
      <span><b>${s.games}</b> ${t('mh.sumGames')}</span>
      <span class="${s.winrate >= 50 ? 'good' : 'bad'}"><b>${s.winrate}%</b> ${t('mh.sumWins', { w: s.wins, l: s.games - s.wins })}</span>
      <span>Ø <b>${f1(s.avg.k)} / <i>${f1(s.avg.d)}</i> / ${f1(s.avg.a)}</b> (${s.avg.kda == null ? t('mh.perfect') : s.avg.kda.toFixed(2) + ' KDA'})</span>
      <span>Ø <b>${f1(s.avg.csMin)}</b> CS/min</span>
      <span>Ø <b>${short(Math.round(s.avg.dmg))}</b> ${t('mh.dmg')}</span>
      ${s.time ? `<span title="${esc(t('mh.timeT'))}">⏱ <b>${playTime(s.time)}</b> ${t('mh.time')}</span>` : ''}
      ${s.streak && s.streak.n >= 2 ? `<span class="${s.streak.win ? 'good' : 'bad'}">${t(s.streak.win ? 'mh.streakW' : 'mh.streakL', { n: s.streak.n })}</span>` : ''}
    </div>
    ${mhActivityHtml(list)}
    ${[5, 4, 3, 2].some(m => s.multis[m]) ? `<div class="mh-multis">${[5, 4, 3, 2].filter(m => s.multis[m]).map(m => (pl
      ? `<span class="mh-multi m${m}">${s.multis[m]}× ${esc(t(MULTI[m]))}</span>`
      : `<button class="mh-multi m${m}${mh.pin === m ? ' on' : ''}" data-pin="${m}">${s.multis[m]}× ${esc(t(MULTI[m]))}</button>`)).join('')}</div>` : ''}
    ${s.accounts.length > 1 && !pl ? `<div class="mh-champs mh-accs"><span class="mh-ch-t">${t('mh.perAccount')}</span>${cut('acc', s.accounts).map(a => {
      const acc = S.accounts.find(x => x.puuid === a.puuid);
      return `<button class="mh-ch" data-mhacc="${esc(a.puuid)}" title="${esc(t('mh.perAccountT'))}">
      ${acc && acc.iconId != null && !hides('icon') ? `<img src="${iconUrl(acc.iconId)}" alt="">` : ''}<span class="mh-ch-n">${esc(acc ? dispName(acc) : '?')}</span>
      <b>${a.games}</b><span class="${a.winrate >= 50 ? 'good' : 'bad'}">${a.winrate}% WR</span><span class="muted">${a.share}%</span><span class="muted">⏱ ${playTime(a.time)}</span></button>`;
    }).join('')}${more('acc', s.accounts)}</div>` : ''}
    ${s.duos.length && !pl ? `<div class="mh-champs mh-duos"><span class="mh-ch-t">${t('mh.duos')}</span>${cut('duo', s.duos).map(d => `<span class="mh-ch" title="${esc(t('mh.duosT'))}">
      <img src="${CHAMP_ICON(d.champ)}" alt=""><span class="mh-ch-n">${esc(S.accounts.some(a => a.puuid === d.puuid) ? dispName(S.accounts.find(a => a.puuid === d.puuid)) : d.name)}</span>
      <b>${d.games}</b><span class="${d.winrate >= 50 ? 'good' : 'bad'}">${d.winrate}% WR</span></span>`).join('')}${more('duo', s.duos)}</div>` : ''}
    ${(s.champs.length > 1 || (!pl && mh.f.champ)) ? `<div class="mh-champs"><span class="mh-ch-t">${t('mh.topChamps')}</span>${cut('champ', s.champs).map(c => `<${pl ? 'span' : 'button'} class="mh-ch${!pl && mh.f.champ === c.champ ? ' on' : ''}"${pl ? '' : ` data-mhchamp="${c.champ}" title="${esc(t('mh.topChampT'))}"`}>
      <img src="${CHAMP_ICON(c.champ)}" alt=""><span class="mh-ch-n">${esc(champName(c.champ) || '#' + c.champ)}</span>
      <b>${c.games}</b><span class="${c.winrate >= 50 ? 'good' : 'bad'}">${c.winrate}% WR</span><span class="muted">${c.playrate}% ${t('mh.playrate')}</span>
      <span class="muted">${c.kda == null ? t('mh.perfect') : c.kda.toFixed(1) + ' KDA'}</span></${pl ? 'span' : 'button'}>`).join('')}${pl ? '' : more('champ', s.champs)}</div>` : ''}
    <div class="mh-recs">
      ${mode ? `<span class="mh-rec-scope">${esc(t('mh.recScope', { n: num(mode[1]), mode: modeName }))}</span>` : ''}
      ${rec('kills', t('mh.recKills'), r.kills, r.kills && r.kills.p.k)}
      ${rec('deaths', t('mh.recDeaths'), r.deaths, r.deaths && r.deaths.p.d)}
      ${rec('kda', t('mh.recKda'), r.kda, r.kda && (Stats.perfect(r.kda.p) ? t('mh.perfect') : Stats.kda(r.kda.p.k, r.kda.p.d, r.kda.p.a).toFixed(1)))}
      ${rec('dmg', t('mh.recDmg'), r.dmg, r.dmg && short(r.dmg.p.dmg))}
    </div>
  </div>`;
}

// the activity of what the filters show: the usual game length, days played (games a day), the
// busiest weekday (the time played stands in the totals above)
function mhActivityHtml(list) {
  const games = list.filter(g => g.dur > 0);
  if (games.length < 2) return '';
  const secs = games.reduce((s, g) => s + g.dur, 0);
  const days = new Set(games.map(g => new Date(g.t).toDateString())).size;
  const wd = new Map();
  for (const g of games) { const d = new Date(g.t).getDay(); wd.set(d, (wd.get(d) || 0) + 1); }
  const [day] = [...wd].sort((a, b) => b[1] - a[1])[0];
  const dayName = new Date(2024, 0, 7 + day).toLocaleDateString(locale(), { weekday: 'long' });
  const item = (label, v) => `<span><span class="muted">${esc(label)}</span> <b>${esc(v)}</b></span>`;
  return `<div class="mh-act">${item(t('ov.avgLen'), t('ov.min', { m: Math.round(secs / games.length / 60) }))}
    ${item(t('ov.days'), t('ov.daysV', { d: days, g: (games.length / days).toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }))}
    ${item(t('ov.weekday'), dayName)}</div>`;
}
// the augments a player took (Arena, ARAM: Mayhem), with their rarity's colour
function augIcons(p, as, cls) {
  if (!p.aug || !p.aug.length) return '';
  return `<span class="${cls}">${p.aug.map(id => {
    const a = as && as.augments && as.augments[id];
    return a && a[0] ? `<img class="aug r-${esc(a[2] || '')}" src="${esc(a[0])}" title="${esc(a[1] || '')}" alt="">` : `<span class="aug none" title="#${id}"></span>`;
  }).join('')}</span>`;
}
function icon(map, id, cls) {
  const x = map && map[id];
  return x && x[0] ? `<img class="${cls}" src="${esc(x[0])}" title="${esc(x[1] || '')}" alt="">` : `<span class="${cls} none"></span>`;
}

// the placement of a game's player among all of them – MVP, ACE or #n, the same as in its details
// (ui/mvp.js); none without every player's numbers (a game read from a list only) or in a remake
function mhPlaceChip(g, p) {
  if (g.lite || Stats.isRemake(g) || !g.players || g.players.length < 2) return '';
  const r = Mvp.placements(g), i = g.players.indexOf(p);
  if (i < 0) return '';
  const k = i === r.mvp ? 'mvp' : i === r.ace ? 'ace' : '';
  return `<span class="mh-pl ${k}" title="${esc(t('pg.placeT'))}">${k ? k.toUpperCase() : '#' + r.place(i)}</span>`;
}
function gameRow(g, as) {
  const ownerId = g.owners[0];
  const me = g.players.find(p => p.puuid === ownerId) || g.players[0];
  const st = Stats.perGame(g, me);
  // no team kill: KP can't be told ("–"), never 0 %
  const kp = st.kp == null ? '–' : Math.round(100 * st.kp) + '%';
  const ratio = st.perfect ? t('mh.perfect') : st.kda.toFixed(2) + ':1';
  const res = g.remake ? 'remake' : me.win ? 'win' : 'loss';
  const owner = S.accounts.find(a => a.puuid === ownerId);
  const others = g.owners.slice(1).map(id => S.accounts.find(a => a.puuid === id)).filter(Boolean);
  const mine = new Set(g.owners);
  return `<div class="mh-row ${res}${g.lite ? ' lite' : ''}${mh.open.has(String(g.id)) && !g.lite ? ' open' : ''}" data-owner="${esc(ownerId)}" data-gid="${esc(g.id)}">
    <svg class="mh-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
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
        <div class="mh-col">${icon(as.spells, (me.spells || [])[0], 'mh-ic')}${icon(as.spells, (me.spells || [])[1], 'mh-ic')}</div>
        <div class="mh-col">${icon(as.perks, me.keystone, 'mh-ic round')}${icon(as.styles, me.sub, 'mh-ic round small')}</div>
        <div class="mh-kda">
          <div class="mh-k">${me.k} / <i>${me.d}</i> / ${me.a}</div>
          <div class="mh-ratio">${ratio} ${t('mh.kda')}</div>
        </div>
        <div class="mh-stats">
          <span>${t('mh.kp')} <b>${kp}</b></span>
          <span>CS <b>${me.cs}</b> (${st.csMin.toFixed(1)})</span>
          <span>${t('mh.dmg')} <b>${short(me.dmg)}</b></span>
          <span>${t('mh.gold')} <b>${short(me.gold)}</b></span>
        </div>
      </div>
      <div class="mh-items">${(me.items || [0, 0, 0, 0, 0, 0, 0]).map((id, i) => (id ? icon(as.items, id, 'mh-it' + (i === 6 ? ' trinket' : '')) : `<span class="mh-it none${i === 6 ? ' trinket' : ''}"></span>`)).join('')}</div>
      <div class="mh-aug-col">${augIcons(me, as, 'mh-augs')}</div>
      <div class="mh-badges">${mhPlaceChip(g, me)}${me.place ? `<span class="mh-badge place p${me.place}">${t('mh.place', { n: me.place })}</span>` : ''}${MULTI[me.multi] ? `<span class="mh-badge">${t(MULTI[me.multi])}</span>` : ''}</div>
    </div>
    <div class="mh-teams">${teamsTable(g, mine)}</div>
    ${mh.open.has(String(g.id)) && !g.lite ? detailsHtml(g, as, mine) : ''}
  </div>`;
}

// The game row, compact: the same game with only what fits a narrow place – champion, result,
// queue, when, K/D/A, KDA, CS/min. "Last game" on the Live page and in the account panel.
// A click opens the game in the match history.
function gameRowShort(g) {
  const me = MatchFilter.me(g);
  const st = Stats.perGame(g, me);
  const res = Stats.isRemake(g) ? 'remake' : me.win ? 'win' : 'loss';
  return `<button class="mh-short ${res}" data-opengame="${esc(g.id)}" title="${esc(t('last.open'))}">
    <img src="${CHAMP_ICON(me.champ)}" alt="">
    <span class="ms-a"><b>${t('mh.' + res)}</b><small>${esc(queueLabel(g))} · ${esc(ago(g.t))}</small></span>
    <span class="ms-b"><b>${me.k} / <i>${me.d}</i> / ${me.a}</b><small>${st.perfect ? t('mh.perfect') : st.kda.toFixed(2) + ':1'} · ${st.csMin.toFixed(1)} CS/min</small></span>
  </button>`;
}
// a game opened in the match history: every filter off, the game unfolded and scrolled to
async function openGame(id) {
  id = String(id);
  ovAll();
  showView('matches');
  mh.filter.queues.clear(); mh.f = { ...MH_DEFAULT }; mh.pin = 0; mh.pinIds = null; mh.show = 40;
  $('mhChamp').value = '';
  mh.open.add(id);
  await loadMatches();
  const find = () => document.querySelector(`.mh-row[data-gid="${CSS.escape(id)}"]`);
  if (!find()) { mh.show = 5000; renderMatches(); }
  const row = find();
  if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
}
// the match history with a set of games on top (a row of the Overview), every filter off
function openMatchesPinned(ids, label) {
  ovAll();
  mh.filter.queues = new Set();
  mh.f = { ...MH_DEFAULT }; mh.pin = 0; mh.show = 40;
  mh.pinIds = new Set(ids.map(String)); mh.pinLabel = label;
  $('mhChamp').value = '';
  showView('matches');
  setTimeout(() => { const l = $('mhList'); if (l) l.scrollIntoView({ block: 'start' }); }, 50);
}
// the match history with some filters set (from Performance): queue groups, champion, time – the
// accounts are the Overview's choice already (puuid: just that one)
function openMatchesWith({ puuid = '', queues = [], champ = 0, range = 'all', from = '', to = '' } = {}) {
  if (puuid) ovOnly(puuid);
  mh.filter.queues = new Set(queues);
  mh.f = { ...MH_DEFAULT, champ, range, from, to }; mh.pin = 0; mh.pinIds = null; mh.show = 40;
  $('mhChamp').value = champ ? champName(champ) : '';
  showView('matches');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-opengame]');
  if (b) openGame(b.dataset.opengame);
});

// filters (the accounts: the Overview's chips)
// queues: any combination ("All" clears it); a click adds or removes one
document.querySelectorAll('[data-mhq]').forEach(b => (b.onclick = () => {
  const q = b.dataset.mhq, set = mh.filter.queues;
  if (!q) set.clear(); else if (set.has(q)) set.delete(q); else set.add(q);
  loadMatches();
}));
// "show more" and jumping to a record's game
$('viewMatches').addEventListener('click', e => {
  if (e.target.closest('#mhShowMore')) { mh.show += 40; renderMatches(); return; }
  if (e.target.closest('#mhShowAll')) { mh.show = Infinity; renderMatches(); return; }
  const mo = e.target.closest('[data-mhmore], [data-mhless]');
  if (mo) {
    const k = mo.dataset.mhmore || mo.dataset.mhless;
    mh.more[k] = mo.dataset.mhmore ? (mh.more[k] || 5) + 5 : 5;
    renderMatches();
    return;
  }
  // a champion of the top list: only his games (again: all games)
  // an account of the breakdown: only its games
  const ac = e.target.closest('[data-mhacc]');
  if (ac) { ovToggle(ac.dataset.mhacc, true); return; }
  const ch = e.target.closest('[data-mhchamp]');
  if (ch) { const id = +ch.dataset.mhchamp; setFilter({ champ: mh.f.champ === id ? 0 : id }); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    if (pin.dataset.pin === 'ids' || mh.pinIds) { mh.pinIds = null; mh.pin = pin.dataset.pin === 'ids' ? 0 : Number(pin.dataset.pin); renderMatches(); return; }
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
$('mhList').addEventListener('click', e => {
  if (e.target.closest('[data-player], [data-pin], [data-goto], [data-mhchamp], [data-mhacc], button, a, input, .mh-det')) return;
  const row = e.target.closest('.mh-row');
  if (!row) return;
  const id = row.dataset.gid;
  if (mh.open.has(id)) mh.open.delete(id); else mh.open.add(id);
  renderMatches();
});
// a game's details live in the match history, on the player page and on the Live page (after a
// game): redraw that one
const detRedraw = el => (el.closest('#liveBody') ? renderLive(true) : el.closest('#plBody') ? renderPlayer() : renderMatches());
// the match list that is shown: the own one (Overview) or a player's
const mhRedraw = () => (mhOn() ? renderMatches() : view === 'player' && typeof renderPlayer === 'function' ? renderPlayer() : null);
// details: fold a section open/closed
function toggleSec(head) {
  const det = head.closest('[data-det]');
  const id = det.dataset.det;
  const open = new Set(mh.secs.get(id) || ['players']);
  if (open.has(head.dataset.sec)) open.delete(head.dataset.sec); else open.add(head.dataset.sec);
  mh.secs.set(id, open);
  detRedraw(head);
}
for (const host of [$('mhList'), $('liveBody'), $('plBody')]) {
  host.addEventListener('click', e => { const h = e.target.closest('[data-det] [data-sec]'); if (h) toggleSec(h); });
  host.addEventListener('keydown', e => { const h = e.target.closest('[data-det] [data-sec]'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSec(h); } });
  host.addEventListener('change', e => {
    const sel = e.target.closest('[data-cmp]');
    if (!sel) return;
    const det = sel.closest('[data-det]');
    const both = [...det.querySelectorAll('[data-cmp]')].map(s => Number(s.value));
    mh.cmp.set(det.dataset.det, both);
    detRedraw(sel);
  });
  host.addEventListener('click', playerMenu);
}
// a player's name: "open with" menu (op.gg, Porofessor …), region of the owning account (Live: the
// signed-in one)
function playerMenu(e) {
  const b = e.target.closest('[data-player]');
  if (!b) return;
  e.stopPropagation();
  const p = JSON.parse(b.dataset.player);
  const row = b.closest('.mh-row');
  const owner = S.accounts.find(a => a.puuid === (row ? row.dataset.owner : S.live && S.live.puuid)) || selected();
  const region = (owner && owner.region) || (S.live && S.live.region) || 'EUW';
  if (p.puuid) return openPlayer({ ...p, region });
  if (!p.gameName) return;
  const m = $('siteMenu');
  m.innerHTML = `<div class="menu-label">${esc(p.gameName + (p.tagLine ? '#' + p.tagLine : ''))}</div>`
    + SITES.map(([k, n]) => `<button data-site="${k}">${n}</button>`).join('');
  m.dataset.id = '';
  m.dataset.player = JSON.stringify({ ...p, region: (owner && owner.region) || (S.live && S.live.region) || 'EUW' });
  const r = b.getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
}
let mhChanged = null;
api.onMatchesChanged(() => {
  clearTimeout(mhChanged);
  mhChanged = setTimeout(() => { if (mhOn()) loadMatches(); }, 1200);
});
