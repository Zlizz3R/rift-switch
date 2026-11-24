// Overview → Performance and Champions: one filter (account, queue, time, role) over all stored
// games, the key figures, a table by role (unfold a role for its champions) and an op.gg-style
// champion list. The maths is in perfmath.js / stats.js. A click on a champion opens the match
// history with the same filters. Uses the globals of renderer.js / views.js / matches-view.js.

const perf = {
  f: { acc: '', queue: 'ranked', range: 'y' + new Date().getFullYear(), role: '' },
  sort: 'n', dir: -1, open: new Set(), all: false, cSort: 'n', games: null, loading: false, trendN: 20, trendKey: 'kda',
};

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
const perfOn = () => view === 'dash' && ['stats', 'champs', 'style'].includes(dashTab());
api.onMatchesChanged(() => { if (perfOn()) loadPerf(); });

// ---------- formatting ----------
const perfDec = (x, d = 1) => (x == null ? '–' : x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }));
const perfPct = x => (x == null ? '–' : Math.round(x * 100) + ' %');
const perfAvg = r => `${perfDec(r.avg.k)} / ${perfDec(r.avg.d)} / ${perfDec(r.avg.a)}`;
const perfKda = r => (r.perfect ? t('mh.perfect') : perfDec(r.kda, 2));
const perfGames = n => (n === 1 ? t('perf.game1') : t('dash.nGames', { n: num(n) }));
const perfChamp = id => (champById(id) || {}).name || '#' + id;
const PERF_QUEUES = () => [['ranked', t('perf.qRanked')], ['solo', 'Solo/Duo'], ['flex', 'Flex'], ['normal', t('mh.normal')], ['aram', 'ARAM'], ['all', t('perf.qAll')]];

// ---------- the filter ----------
function renderPerfFilter() {
  const f = perf.f;
  const accs = S.accounts.filter(a => !a.placeholder);
  if (f.acc && !accs.some(a => a.puuid === f.acc)) f.acc = '';
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  $('perfAcc').innerHTML = opt('', t('mh.allAccounts'), !f.acc) + accs.map(a => opt(a.puuid, dispName(a), f.acc === a.puuid)).join('');
  $('perfQueue').innerHTML = PERF_QUEUES().map(([k, l]) => opt(k, l, f.queue === k)).join('');
  // seasons (calendar years) with games, the current one always; then the usual ranges
  const years = [...new Set([new Date().getFullYear(), ...PerfMath.years(perf.games || [])])].sort((a, b) => b - a);
  const ranges = [...years.map(y => ['y' + y, t('perf.season', { y })]), ['90', t('mh.r90')], ['30', t('mh.r30')], ['7', t('mh.r7')], ['all', t('mh.rAll')]];
  $('perfRange').innerHTML = ranges.map(([k, l]) => opt(k, l, f.range === k)).join('');
  $('perfRole').innerHTML = `<button data-prole=""${!f.role ? ' class="on"' : ''}>${t('perf.allRoles')}</button>` +
    Stats.POSITIONS.map(r => `<button data-prole="${r}" title="${esc(t('pos.' + r))}"${f.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('');
}
// "86 games · Ranked (Solo + Flex) · Season 2026 · Top · 3 accounts"
function perfLine(ag) {
  const f = perf.f;
  const parts = [perfGames(ag ? ag.n : 0)];
  parts.push((PERF_QUEUES().find(q => q[0] === f.queue) || [])[1]);
  parts.push($('perfRange').selectedOptions[0] ? $('perfRange').selectedOptions[0].textContent : '');
  if (f.role) parts.push(t('pos.' + f.role));
  const acc = f.acc && S.accounts.find(a => a.puuid === f.acc);
  parts.push(acc ? dispName(acc) : ag && ag.accounts === 1 ? t('mast.account1') : t('mast.accounts', { n: ag ? ag.accounts : 0 }));
  return parts.filter(Boolean).join(' · ');
}

// ---------- rendering ----------
function renderPerf() {
  const el = $('perfBody');
  if (!el || $('dashPerf').hidden) return;
  renderPerfFilter();
  if (!perf.games) { $('perfLine').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const parts = PerfMath.select(perf.games, perf.f);
  const ag = Stats.aggregate(parts);
  $('perfLine').textContent = perfLine(ag);
  if (!ag) { el.innerHTML = `<div class="chart-empty">${t('mh.noMatch')}</div>`; return; }
  const tab = dashTab();
  el.innerHTML = tab === 'champs' ? perfChampsHtml(parts, ag) : tab === 'style' ? perfStyleHtml(parts) : perfStatsHtml(parts, ag);
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
document.addEventListener('change', e => {
  if (e.target.id === 'trendN') { perf.trendN = +e.target.value; renderPerf(); }
  if (e.target.id === 'trendKey') { perf.trendKey = e.target.value; renderPerf(); }
});

// the role table: a role per row, unfolded its champions
const PERF_COLS = [
  ['n', 'perf.games'], ['winrate', 'dash.wr'], ['avg', 'perf.avg'], ['kda', 'mh.kda'], ['csMin', 'det.csMin'],
  ['dmgMin', 'perf.dmgMin'], ['kp', 'perf.kpShort'], ['visMin', 'perf.visMin'], ['accounts', 'perf.accs'],
];
function perfCells(r) {
  const few = r.n < PerfMath.MARK.minGames;
  return `<td>${num(r.n)}</td>
    <td class="${few ? 'muted' : PerfMath.markWinrate(r)}"${few ? ` title="${esc(t('perf.fewWr'))}"` : ''}>${perfPct(r.winrate)}</td>
    <td>${perfAvg(r)}</td><td class="${PerfMath.markKda(r)}">${perfKda(r)}</td><td>${perfDec(r.csMin)}</td>
    <td>${num(Math.round(r.dmgMin))}</td><td>${perfPct(r.kp)}</td><td>${perfDec(r.visMin, 2)}</td><td>${r.accounts}</td>`;
}
function perfStatsHtml(parts, ag) {
  const roles = PerfMath.roleTable(parts);
  // one role (filtered, or only one played): open
  const isOpen = r => roles.length === 1 || perf.open.has(r);
  const arrow = k => (perf.sort === k ? (perf.dir < 0 ? ' ↓' : ' ↑') : '');
  const head = `<tr><th>${t('perf.role')}</th>${PERF_COLS.map(([k, l]) => `<th data-psort="${k}"${k === 'kp' ? ` title="${esc(t('perf.kp'))}"` : ''}>${t(l)}${arrow(k)}</th>`).join('')}</tr>`;
  const body = roles.map(r => {
    const open = isOpen(r.role);
    const icon = r.role === 'none' ? '' : `<img class="pr-ic" src="${posIcon(r.role)}" alt="">`;
    const champsHtml = open ? PerfMath.sortRows(r.champs, perf.sort, perf.dir).map(c => `<tr class="pr-champ" data-pchamp="${c.champ}" title="${esc(t('perf.open'))}">
        <td><span class="mast-ch"><img src="${CHAMP_ICON(c.champ)}" alt="" loading="lazy">${esc(perfChamp(c.champ))}</span></td>${perfCells(c)}</tr>`).join('') : '';
    return `<tr class="pr-role${open ? ' open' : ''}" data-prow="${r.role}"><td><span class="pr-name"><i class="pr-chev"></i>${icon}${esc(t('pos.' + r.role))}</span></td>${perfCells(r)}</tr>${champsHtml}`;
  }).join('');
  return `${perfBarHtml(ag)}${perfTrendHtml(parts)}<div class="mast-wrap"><table class="dash-table perf-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// the champion list in the style of op.gg: "All" first, then the champions by games
function perfChampsHtml(parts, ag) {
  let rows = PerfMath.champRows(parts);
  const total = rows.length;
  if (perf.all) rows = PerfMath.sortRows(rows, perf.cSort, -1); else rows = rows.slice(0, 8);
  const row = (r, all) => `<button class="oc-row${all ? ' all' : ''}"${all ? '' : ` data-pchamp="${r.champ}"`} title="${esc(t('perf.open'))}">
      ${all ? `<span class="oc-ic all">${esc(t('perf.all').slice(0, 1))}</span>` : `<img class="oc-ic" src="${CHAMP_ICON(r.champ)}" alt="" loading="lazy">`}
      <span class="oc-name"><b>${esc(all ? t('perf.all') : perfChamp(r.champ))}</b><small>${esc(t('perf.cs', { cs: num(Math.round(r.cs)), m: perfDec(r.csMin) }))}</small></span>
      <span class="oc-kda"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markKda(r) : ''}">${r.perfect ? esc(t('perf.perfect')) : esc(t('perf.kdaRatio', { v: perfDec(r.kda, 2) }))}</b><small>${perfAvg(r)}</small></span>
      <span class="oc-wr"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markWinrate(r) : 'muted'}">${perfPct(r.winrate)}</b><small>${esc(perfGames(r.n))}</small></span>
    </button>`;
  const sorts = perf.all ? `<div class="seg oc-sort"><span>${t('perf.sort')}</span>${[['n', 'perf.games'], ['winrate', 'dash.wr'], ['kda', 'mh.kda'], ['csMin', 'det.csMin']]
    .map(([k, l]) => `<button data-csort="${k}"${perf.cSort === k ? ' class="on"' : ''}>${t(l)}</button>`).join('')}</div>` : '';
  const more = total > 8 ? `<button class="btn oc-more" data-pall>${perf.all ? t('perf.less') : t('perf.more', { n: total })}</button>` : '';
  return `${sorts}<div class="oc-list">${row(ag, true)}${rows.map(r => row(r, false)).join('')}</div>${more}`;
}

// ---------- clicks ----------
// a champion: the match history with the same account, queue, time and this champion
function perfOpen(champ) {
  const f = perf.f;
  const QG = { ranked: ['solo', 'flex'], solo: ['solo'], flex: ['flex'], normal: ['normal'], aram: ['aram'], all: [] };
  const y = /^y(\d{4})$/.exec(f.range);
  const time = y ? { range: 'custom', from: `${y[1]}-01-01`, to: `${y[1]}-12-31` } : { range: f.range };
  openMatchesWith({ puuid: f.acc, queues: QG[f.queue] || [], champ: champ || 0, ...time });
}
$('perfAcc').onchange = () => { perf.f.acc = $('perfAcc').value; renderPerf(); };
$('perfQueue').onchange = () => { perf.f.queue = $('perfQueue').value; renderPerf(); };
$('perfRange').onchange = () => { perf.f.range = $('perfRange').value; renderPerf(); };
$('dashPerf').addEventListener('click', e => {
  const ro = e.target.closest('[data-prole]');
  if (ro) { perf.f.role = ro.dataset.prole; return renderPerf(); }
  const so = e.target.closest('[data-psort]');
  if (so) { const k = so.dataset.psort; perf.dir = perf.sort === k ? -perf.dir : -1; perf.sort = k; return renderPerf(); }
  const cs = e.target.closest('[data-csort]');
  if (cs) { perf.cSort = cs.dataset.csort; return renderPerf(); }
  if (e.target.closest('[data-pall]')) { perf.all = !perf.all; return renderPerf(); }
  const ch = e.target.closest('[data-pchamp]');
  if (ch) return perfOpen(+ch.dataset.pchamp);
  if (e.target.closest('.oc-row.all')) return perfOpen(0);
  const r = e.target.closest('[data-prow]');
  if (r) { const k = r.dataset.prow; if (perf.open.has(k)) perf.open.delete(k); else perf.open.add(k); renderPerf(); }
});
