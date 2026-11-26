// Overview → Performance and Champions: one filter (account, queue, time, role) over all stored
// games, the key figures, a table by role (unfold a role for its champions) and an op.gg-style
// champion list. The maths is in perfmath.js / stats.js. A click on a champion opens the match
// history with the same filters. Uses the globals of renderer.js / views.js / matches-view.js.

function perfQueuesKept() {
  try { const q = JSON.parse(localStorage.getItem('rs.perfQ')); if (Array.isArray(q)) return q; } catch { /* default */ }
  return ['solo', 'flex'];
}
// how many of the newest games count (0 = all); kept like the queues
function perfLastKept() {
  try { const n = Number(localStorage.getItem('rs.perfLast')); return n > 0 ? Math.min(9999, Math.round(n)) : 0; } catch { return 0; }
}
const PERF_LAST = [10, 20, 50, 100, 200];
const perf = {
  // queues: groups switched on (none = all); kept like the account choice; last: the newest n games only
  f: { queues: perfQueuesKept(), range: 'y' + new Date().getFullYear(), from: '', to: '', role: '', last: perfLastKept() },
  lastOwn: false,
  sort: 'n', dir: -1, open: new Set(), all: false, cSort: 'n', games: null, loading: false, trendN: 20, trendKey: 'kda',
};
perf.lastOwn = perf.f.last > 0 && !PERF_LAST.includes(perf.f.last);

async function loadPerf() {
  if (perf.loading) return;
  perf.loading = true;
  try {
    if (!champs.length) champs = (await api.champions()) || [];
    perf.games = (await allGames()) || [];
  } catch (e) { console.warn('perf', e); }
  perf.loading = false;
  renderPerf();
}
const perfOn = () => view === 'dash' && ['stats', 'champs', 'style', 'map'].includes(dashTab());
api.onMatchesChanged(() => { if (perfOn()) loadPerf(); });

// ---------- formatting ----------
const perfDec = (x, d = 1) => (x == null ? '–' : x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }));
const perfPct = x => (x == null ? '–' : Math.round(x * 100) + ' %');
const perfAvg = r => `${perfDec(r.avg.k)} / ${perfDec(r.avg.d)} / ${perfDec(r.avg.a)}`;
const perfKda = r => (r.perfect ? t('mh.perfect') : perfDec(r.kda, 2));
const perfGames = n => (n === 1 ? t('perf.game1') : t('dash.nGames', { n: num(n) }));
const perfChamp = id => (champById(id) || {}).name || '#' + id;
const PERF_QUEUES = () => [['solo', 'Solo/Duo'], ['flex', 'Flex'], ['r5', 'Ranked 5v5'], ['classic', 'Classic 5v5'], ['normal', t('mh.normal')],
  ['aram', 'ARAM'], ['arena', 'Arena'], ['clash', 'Clash'], ['custom', t('mh.custom')]];
// what the filter counts, for select(): the chosen accounts and queues
const perfF = () => ({ ...perf.f, accs: ovChosen().map(a => a.puuid) });

// ---------- the filter ----------
function renderPerfFilter() {
  const f = perf.f;
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  // queues like the match history: each one on or off, "All" = every queue
  $('perfQueues').innerHTML = `<button data-pq=""${!f.queues.length ? ' class="on"' : ''}>${t('mh.allQueues')}</button>` +
    PERF_QUEUES().map(([k, l]) => `<button data-pq="${k}"${f.queues.includes(k) ? ' class="on"' : ''}>${esc(l)}</button>`).join('');
  // seasons (calendar years) with games, the current one always; then the usual ranges
  const years = [...new Set([new Date().getFullYear(), ...PerfMath.years(perf.games || [])])].sort((a, b) => b - a);
  const ranges = [...years.map(y => ['y' + y, t('perf.season', { y })]), ['90', t('mh.r90')], ['30', t('mh.r30')], ['7', t('mh.r7')], ['all', t('mh.rAll')], ['custom', t('mh.rCustom')]];
  $('perfRange').innerHTML = ranges.map(([k, l]) => opt(k, l, f.range === k)).join('');
  // own dates: both days included (matchfilter.js)
  $('perfDates').hidden = f.range !== 'custom';
  if (document.activeElement !== $('perfFrom')) $('perfFrom').value = f.from || '';
  if (document.activeElement !== $('perfTo')) $('perfTo').value = f.to || '';
  // the newest n games only
  $('perfLast').innerHTML = perfLastOpts(f.last, perf.lastOwn);
  const own = perfLastIsOwn(f.last, perf.lastOwn);
  $('perfLastN').hidden = !own;
  if (own && document.activeElement !== $('perfLastN')) $('perfLastN').value = f.last || '';
  $('perfRole').innerHTML = `<button data-prole=""${!f.role ? ' class="on"' : ''}>${t('perf.allRoles')}</button>` +
    Stats.POSITIONS.map(r => `<button data-prole="${r}" title="${esc(t('pos.' + r))}"${f.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('');
}
// the choice "how many of the newest games": All, 10 … 200, an own number (shown in its field)
const perfLastIsOwn = (n, own) => own || (n > 0 && !PERF_LAST.includes(n));
function perfLastOpts(n, own) {
  const isOwn = perfLastIsOwn(n, own);
  const opt = (v, label, on) => `<option value="${v}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  return opt(0, t('perf.lastAll'), !n && !isOwn) + PERF_LAST.map(k => opt(k, t('perf.last', { n: k }), !isOwn && n === k)).join('')
    + opt('own', t('perf.lastCustom'), isOwn);
}
// a new number: the newest n games (0 = all), kept for the next start
function perfSetLast(n) {
  perf.f.last = n > 0 ? Math.min(9999, Math.round(n)) : 0;
  try { localStorage.setItem('rs.perfLast', String(perf.f.last)); } catch { /* not kept */ }
}
// "86 games · Ranked (Solo + Flex) · Season 2026 · Top · 3 accounts"
function perfLine(ag) {
  const f = perf.f;
  const parts = [perfGames(ag ? ag.n : 0)];
  parts.push(f.queues.length ? PERF_QUEUES().filter(([k]) => f.queues.includes(k)).map(q => q[1]).join(' + ') : t('perf.qAll'));
  parts.push(f.range === 'custom' ? [f.from, f.to].map(d => (d ? fmtDate(new Date(d + 'T00:00').getTime()) : '…')).join(' – ') : $('perfRange').selectedOptions[0] ? $('perfRange').selectedOptions[0].textContent : '');
  if (f.last) parts.push(t('perf.last', { n: num(f.last) }));
  if (f.role) parts.push(t('pos.' + f.role));
  const chosen = ovChosen();
  parts.push(chosen.length === 1 ? dispName(chosen[0]) : ag && ag.accounts === 1 ? t('mast.account1') : t('mast.accounts', { n: ag ? ag.accounts : 0 }));
  return parts.filter(Boolean).join(' · ');
}

// ---------- rendering ----------
function renderPerf() {
  const el = $('perfBody');
  if (!el || $('dashPerf').hidden) return;
  renderPerfFilter();
  if (!perf.games) { $('perfLine').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const parts = PerfMath.select(perf.games, perfF());
  const ag = Stats.aggregate(parts);
  $('perfLine').textContent = perfLine(ag);
  if (!ag) { el.innerHTML = `<div class="chart-empty">${t('mh.noMatch')}</div>`; return; }
  const tab = dashTab();
  el.innerHTML = tab === 'champs' ? perfChampsHtml(parts, ag) : tab === 'style' ? perfStyleHtml(parts) : tab === 'map' ? perfMapHtml(parts) : perfStatsHtml(parts, ag);
}

// the key figures in one row
function perfBarHtml(ag) {
  const tile = (label, value, sub = '', cls = '') => `<div class="pk${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="perf-bar">
    ${tile(t('perf.games'), num(ag.n), ag.games !== ag.n ? esc(t('perf.inGames', { n: num(ag.games) })) : '')}
    ${tile(t('dash.wr'), perfPct(ag.winrate), esc(`${ag.wins} – ${ag.losses}`), PerfMath.markWinrate(ag))}
    ${tile(t('perf.avg'), perfAvg(ag))}
    ${tile(t('mh.kda'), perfKda(ag), '', PerfMath.markKda(ag))}
    ${tile(t('det.csMin'), perfDec(ag.csMin))}
    ${tile(t('perf.dmgMin'), num(Math.round(ag.dmgMin)))}
    ${tile(t('perf.visMin'), perfDec(ag.visMin, 2))}
    ${tile(t('perf.kp'), perfPct(ag.kp))}
  </div>`;
}

// the trend: the last n games against the n before them – win rate and one chosen figure
const PERF_TREND_LABEL = { kda: 'mh.kda', csMin: 'det.csMin', dmgMin: 'perf.dmgMin', visMin: 'perf.visMin', kp: 'perf.kp', deaths: 'trend.deaths' };
function perfTrendHtml(parts) {
  const n = perf.trendN, key = perf.trendKey;
  const tr = PerfMath.trend(parts, n, key);
  const selN = `<select id="trendN">${[10, 20, 50, 100].map(v => `<option value="${v}"${v === n ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  const selK = `<select id="trendKey">${Object.keys(PerfMath.TREND_KEYS).map(k => `<option value="${k}"${k === key ? ' selected' : ''}>${esc(t(PERF_TREND_LABEL[k]))}</option>`).join('')}</select>`;
  if (!tr.ok) return `<div class="trend"><span>${t('trend.lead', { sel: selN })}</span><span class="muted">${esc(t('trend.few', { have: tr.have, need: tr.need }))}</span></div>`;
  const fmt = v => (v == null ? '–' : key === 'kp' ? Math.round(v * 100) + ' %' : perfDec(v, key === 'dmgMin' ? 0 : key === 'visMin' || key === 'kda' ? 2 : 1));
  const arrow = (now, before, better) => {
    if (now == null || before == null || now === before) return '<i class="tr-eq">=</i>';
    const up = (now - before) * better > 0;
    return `<i class="${up ? 'tr-up' : 'tr-down'}">${up ? '▲' : '▼'}</i>`;
  };
  return `<div class="trend"><span>${t('trend.lead', { sel: selN })}</span>
    <span>${t('dash.wr')} <b>${perfPct(tr.wr[1])} → ${perfPct(tr.wr[0])}</b> ${arrow(tr.wr[0], tr.wr[1], 1)}</span>
    <span>${selK} <b>${fmt(tr.prev)} → ${fmt(tr.cur)}</b> ${arrow(tr.cur, tr.prev, tr.better)}</span></div>`;
}
// the Performance views are drawn on the Overview and on the player page: draw again where they are
const perfRerender = () => (view === 'player' && typeof renderPlayer === 'function' ? renderPlayer() : renderPerf());
document.addEventListener('change', e => {
  if (e.target.id === 'trendN') { perf.trendN = +e.target.value; perfRerender(); }
  if (e.target.id === 'trendKey') { perf.trendKey = e.target.value; perfRerender(); }
});

// the role table: a role per row, unfolded its champions
const PERF_COLS = [
  ['n', 'perf.games'], ['winrate', 'dash.wr'], ['avg', 'perf.avg'], ['kda', 'mh.kda'], ['csMin', 'det.csMin'],
  ['dmgMin', 'perf.dmgMin'], ['kp', 'perf.kpShort'], ['visMin', 'perf.visMin'], ['accounts', 'perf.accs'],
];
function perfCells(r, oneAccount = false) {
  const few = r.n < PerfMath.MARK.minGames;
  return `<td>${num(r.n)}</td>
    <td class="${few ? 'muted' : PerfMath.markWinrate(r)}"${few ? ` title="${esc(t('perf.fewWr'))}"` : ''}>${perfPct(r.winrate)}</td>
    <td>${perfAvg(r)}</td><td class="${PerfMath.markKda(r)}">${perfKda(r)}</td><td>${perfDec(r.csMin)}</td>
    <td>${num(Math.round(r.dmgMin))}</td><td>${perfPct(r.kp)}</td><td>${perfDec(r.visMin, 2)}</td>${oneAccount ? '' : `<td>${r.accounts}</td>`}`;
}
// opts.player: one player's games (the player page) – no accounts column, no jumps into the own match history
function perfStatsHtml(parts, ag, opts = {}) {
  const roles = PerfMath.roleTable(parts);
  const cols = opts.player ? PERF_COLS.filter(([k]) => k !== 'accounts') : PERF_COLS;
  const pin = v => (opts.player ? '' : ` data-ppin="${v}" title="${esc(t('perf.pin'))}"`);
  // one role (filtered, or only one played): open
  const isOpen = r => roles.length === 1 || perf.open.has(r);
  const arrow = k => (perf.sort === k ? (perf.dir < 0 ? ' ↓' : ' ↑') : '');
  const head = `<tr><th>${t('perf.role')}</th>${cols.map(([k, l]) => `<th data-psort="${k}"${k === 'kp' ? ` title="${esc(t('perf.kp'))}"` : ''}>${t(l)}${arrow(k)}</th>`).join('')}</tr>`;
  const body = roles.map(r => {
    const open = isOpen(r.role);
    const icon = r.role === 'none' ? '' : `<img class="pr-ic" src="${posIcon(r.role)}" alt="">`;
    const champsHtml = open ? PerfMath.sortRows(r.champs, perf.sort, perf.dir).map(c => `<tr class="pr-champ${opts.player ? ' plain' : ''}"${pin(`${r.role}|${c.champ}`)}>
        <td><span class="mast-ch"><img src="${CHAMP_ICON(c.champ)}" alt="" loading="lazy">${esc(perfChamp(c.champ))}</span></td>${perfCells(c, opts.player)}</tr>`).join('') : '';
    // the name unfolds the role; the figures pin its games in the match history
    return `<tr class="pr-role${open ? ' open' : ''}"${pin(`${r.role}|`)}><td data-prow="${r.role}" title="${esc(t('perf.unfold'))}"><span class="pr-name"><i class="pr-chev"></i>${icon}${esc(t('pos.' + r.role))}</span></td>${perfCells(r, opts.player)}</tr>${champsHtml}`;
  }).join('');
  return `${perfBarHtml(ag)}${perfTrendHtml(parts)}<div class="mast-wrap"><table class="dash-table perf-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// the champion list in the style of op.gg: "All" first, then the champions by games
function perfChampsHtml(parts, ag, opts = {}) {
  let rows = PerfMath.champRows(parts);
  const total = rows.length;
  if (perf.all) rows = PerfMath.sortRows(rows, perf.cSort, -1); else rows = rows.slice(0, 8);
  // the player page: rows to read, not to click (they would open the own match history)
  const tag = opts.player ? 'div' : 'button';
  const row = (r, all) => `<${tag} class="oc-row${all ? ' all' : ''}${opts.player ? ' plain' : ''}"${all || opts.player ? '' : ` data-pchamp="${r.champ}"`}${opts.player ? '' : ` title="${esc(t('perf.open'))}"`}>
      ${all ? `<span class="oc-ic all">${esc(t('perf.all').slice(0, 1))}</span>` : `<img class="oc-ic" src="${CHAMP_ICON(r.champ)}" alt="" loading="lazy">`}
      <span class="oc-name"><b>${esc(all ? t('perf.all') : perfChamp(r.champ))}</b><small>${esc(t('perf.cs', { cs: num(Math.round(r.cs)), m: perfDec(r.csMin) }))}</small></span>
      <span class="oc-kda"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markKda(r) : ''}">${r.perfect ? esc(t('perf.perfect')) : esc(t('perf.kdaRatio', { v: perfDec(r.kda, 2) }))}</b><small>${perfAvg(r)}</small></span>
      <span class="oc-wr"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markWinrate(r) : 'muted'}">${perfPct(r.winrate)}</b><small>${esc(perfGames(r.n))}</small></span>
    </${tag}>`;
  const sorts = perf.all ? `<div class="seg oc-sort"><span>${t('perf.sort')}</span>${[['n', 'perf.games'], ['winrate', 'dash.wr'], ['kda', 'mh.kda'], ['csMin', 'det.csMin']]
    .map(([k, l]) => `<button data-csort="${k}"${perf.cSort === k ? ' class="on"' : ''}>${t(l)}</button>`).join('')}</div>` : '';
  const more = total > 8 ? `<button class="btn oc-more" data-pall>${perf.all ? t('perf.less') : t('perf.more', { n: total })}</button>` : '';
  return `${sorts}<div class="oc-list">${row(ag, true)}${rows.map(r => row(r, false)).join('')}</div>${more}`;
}

// ---------- clicks ----------
// a row of the role table: its games on top of the match history (like "pentakills first")
function perfPin(role, champ) {
  const rows = PerfMath.select(perf.games, perfF()).filter(x => PerfMath.roleOf(x) === role && (!champ || x.p.champ === +champ));
  const ids = [...new Set(rows.map(x => String(x.g.id)))];
  const label = [t('pos.' + role), champ ? perfChamp(+champ) : ''].filter(Boolean).join(' · ');
  openMatchesPinned(ids, label);
}
// a champion: the match history with the same account, queue, time and this champion
function perfOpen(champ) {
  const f = perf.f;
  const y = /^y(\d{4})$/.exec(f.range);
  const time = y ? { range: 'custom', from: `${y[1]}-01-01`, to: `${y[1]}-12-31` } : f.range === 'custom' ? { range: 'custom', from: f.from || '', to: f.to || '' } : { range: f.range };
  // the match history filters one account (or all)
  const chosen = ovChosen();
  openMatchesWith({ puuid: chosen.length === 1 ? chosen[0].puuid : '', queues: [...f.queues], champ: champ || 0, ...time });
}
$('perfRange').onchange = () => {
  perf.f.range = $('perfRange').value;
  renderPerf();
  if (perf.f.range === 'custom' && !perf.f.from) $('perfFrom').focus();
};
$('perfFrom').onchange = () => { perf.f.from = $('perfFrom').value; renderPerf(); };
$('perfTo').onchange = () => { perf.f.to = $('perfTo').value; renderPerf(); };
$('perfLast').onchange = () => {
  const v = $('perfLast').value;
  perf.lastOwn = v === 'own';
  if (!perf.lastOwn) perfSetLast(Number(v));
  renderPerf();
  if (perf.lastOwn) { $('perfLastN').focus(); $('perfLastN').select(); }
};
// an own number counts once typed (Enter or leaving the field)
$('perfLastN').onchange = () => { perfSetLast(Number($('perfLastN').value)); perf.lastOwn = true; renderPerf(); };
$('dashPerf').addEventListener('click', e => {
  const pq = e.target.closest('[data-pq]');
  if (pq) {
    const k = pq.dataset.pq, q = perf.f.queues;
    perf.f.queues = !k ? [] : q.includes(k) ? q.filter(x => x !== k) : [...q, k];
    try { localStorage.setItem('rs.perfQ', JSON.stringify(perf.f.queues)); } catch { /* not kept */ }
    return renderPerf();
  }
  const ro = e.target.closest('[data-prole]');
  if (ro) { perf.f.role = ro.dataset.prole; return renderPerf(); }
  const so = e.target.closest('[data-psort]');
  if (so) { const k = so.dataset.psort; perf.dir = perf.sort === k ? -perf.dir : -1; perf.sort = k; return renderPerf(); }
  const cs = e.target.closest('[data-csort]');
  if (cs) { perf.cSort = cs.dataset.csort; return renderPerf(); }
  if (e.target.closest('[data-pall]')) { perf.all = !perf.all; return renderPerf(); }
  const ch = e.target.closest('[data-pchamp]');
  if (ch) return perfOpen(+ch.dataset.pchamp);
  const fold = e.target.closest('[data-prow]');
  if (fold) { const k = fold.dataset.prow; if (perf.open.has(k)) perf.open.delete(k); else perf.open.add(k); return renderPerf(); }
  const pp = e.target.closest('[data-ppin]');
  if (pp) return perfPin(...pp.dataset.ppin.split('|'));
  if (e.target.closest('.oc-row.all')) return perfOpen(0);
});
