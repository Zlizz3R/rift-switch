// Overview → Mastery: every champion's mastery points over all accounts together, the split per
// account, milestones and an estimate of the play time behind them (always a range). The sums and
// the estimate live in mastmath.js, the numbers behind the estimate in playtime-rules.js.
// Also the Overview's sub-tabs. Uses the globals of renderer.js / views.js / dashboard.js.

const mast = { data: null, games: null, q: '', sort: 'total', dir: -1, all: false, stamp: '' };

// ---------- Overview sub-tabs (the last one chosen is kept) ----------
const DASH_TABS = ['lp', 'stats', 'champs', 'style', 'map', 'mast', 'tags', 'seasons'];
const dashTab = () => { const v = ((S.settings && S.settings.uiTabs) || {}).dash; return DASH_TABS.includes(v) ? v : 'lp'; };
function showDashTab(tab) {
  document.querySelectorAll('#dashTabs [data-dt]').forEach(b => b.classList.toggle('on', b.dataset.dt === tab));
  $('dashLp').hidden = tab !== 'lp';
  $('dashPerf').hidden = !['stats', 'champs', 'style', 'map'].includes(tab);
  $('dashMast').hidden = tab !== 'mast';
  $('dashTags').hidden = tab !== 'tags';
  if (typeof renderOvAccs === 'function') renderOvAccs();
  $('dashSeasons').hidden = tab !== 'seasons';
  if (tab === 'mast') { renderMast(); loadMast(); }
  if (['stats', 'champs', 'style', 'map'].includes(tab)) { renderPerf(); loadPerf(); }
  if (tab === 'tags') { renderTagsView(); loadTagsView(); }
  if (tab === 'seasons') { renderSeasonsView(); loadSeasonsView(); }
  refreshLoadBtns();
}
$('dashTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-dt]');
  if (!b) return;
  const tabs = { ...((S.settings && S.settings.uiTabs) || {}), dash: b.dataset.dt };
  S.settings = { ...S.settings, uiTabs: tabs };
  api.setSetting('uiTabs', tabs);
  showDashTab(b.dataset.dt);
});

// ---------- data ----------
// a new reading of any account (the state carries only its time): fetch again while the tab is open
const mastStamp = () => S.accounts.map(a => a.mastAt || 0).join(',');
async function loadMast() {
  mast.stamp = mastStamp();
  const [d, g, ch] = await Promise.all([api.masteries(), api.ownGames(), champs.length ? null : api.champions()]);
  mast.data = Array.isArray(d) ? d : [];
  mast.games = g && typeof g === 'object' ? g : {};
  if (Array.isArray(ch) && ch.length) champs = ch;
  if (view === 'dash' && dashTab() === 'mast') renderMast();
}
api.onState(() => {
  if (view !== 'dash' || dashTab() !== 'mast') return;
  if (mastStamp() !== mast.stamp) loadMast(); else renderMast();
});
api.onMatchesChanged(() => { if (view === 'dash' && dashTab() === 'mast') loadMast(); });

// ---------- formatting ----------
const mastName = id => (champById(id) || {}).name || '#' + id;
const mastCompact = n => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const MS_LABEL = { 100000: '100k', 500000: '500k', 1000000: '1M', 2000000: '2M' };
const mastHours = e => t('mast.hours', { h: num(MastMath.roundNice(e.hours)) });

// the estimate of one account on one champion: its own game length and ARAM share where known
const mastLen = puuid => MastMath.avgMinutes((mast.games || {})[puuid] || []);
function mastEstimate(puuid, id, pts) {
  return MastMath.estimate(pts, { min: MastMath.gameMinutes(mastLen(puuid)), aram: MastMath.aramShare((mast.games || {})[puuid], id) });
}
// a sum of estimates (accounts or champions)
function mastSum(list) {
  const s = { games: 0, hours: 0, aram: 0 };
  for (const e of list) { s.games += e.games; s.hours += e.hours; if (e.aram) s.aram++; }
  return s;
}
// how the number comes about – the tooltip of every play time
function mastTimeTip(e, puuids) {
  const R = PLAYTIME_RULES;
  const lines = [t('mast.tipGames', { n: num(MastMath.roundNice(e.games)), ppg: num(R.pointsPerGame) }), t('mast.tipRate')];
  const len = MastMath.avgMinutes([].concat(...(puuids || []).map(p => (mast.games || {})[p] || [])));
  const m = MastMath.gameMinutes(len);
  lines.push(m.sr !== R.minutes.sr ? t('mast.tipOwnLen', { min: Math.round(m.sr), n: len.srN }) : t('mast.tipMin', { min: R.minutes.sr, aram: R.minutes.aram }));
  lines.push(t('mast.tipExtra', { min: R.extraMinutes }));
  if (e.aram) lines.push(t('mast.tipAram'));
  lines.push(t('mast.tipSrc', { src: 'Jack J Gaming (2023), lolvalue.com (2026), bo3.gg, gameriv.com' }));
  return lines.join('\n');
}

// ---------- rendering ----------
function renderMast() {
  const el = $('mastBody');
  if (!el || $('dashMast').hidden) return;
  const accs = ovChosen();
  if (!mast.data) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const by = new Map(mast.data.map(m => [m.puuid, m]));
  const read = accs.filter(a => by.has(a.puuid));
  const rows = MastMath.masteryTable(read.map(a => by.get(a.puuid)));
  $('mastSub').textContent = rows.length ? t('mast.sub', { champs: rows.length, read: read.length, all: accs.length }) : '';
  if (!rows.length) { el.innerHTML = `<div class="chart-empty">${t('mast.none')}</div>`; return; }
  // play time per row: the sum of each account's estimate
  for (const r of rows) {
    r.est = mastSum(Object.entries(r.accs).map(([p, v]) => mastEstimate(p, r.id, v.pts)));
    r.name = mastName(r.id);
  }
  const total = mastSum(rows.map(r => r.est));
  const nameOf = p => dispName(accs.find(a => a.puuid === p) || {});
  const split = r => Object.entries(r.accs).sort((x, y) => y[1].pts - x[1].pts)
    .map(([p, v]) => `${nameOf(p)}: ${num(v.pts)}`).join('\n');

  // the biggest ones up top, with the split per account in the tooltip
  const top = rows.slice(0, 5).map(r => {
    const ms = MastMath.milestone(r.total);
    return `<div class="mast-card" title="${esc(split(r))}">
      <img src="${CHAMP_ICON(r.id)}" alt="" loading="lazy">
      <div><b>${esc(r.name)}</b>
        <div class="mc-pts">${num(r.total)}${ms ? ` <i class="ms" title="${esc(t('mast.msTip', { m: MS_LABEL[ms], list: split(r) }))}">${MS_LABEL[ms]}</i>` : ''}</div>
        <small>${r.n === 1 ? t('mast.account1') : t('mast.accounts', { n: r.n })}</small>
        <small title="${esc(mastTimeTip(r.est, Object.keys(r.accs)))}">${esc(mastHours(r.est))}</small></div></div>`;
  }).join('');

  // the table: champion × account, sortable, searchable
  const q = collNorm(mast.q);
  let list = q ? rows.filter(r => collNorm(r.name).includes(q)) : rows;
  const val = r => (mast.sort === 'name' ? r.name : mast.sort === 'total' ? r.total : (r.accs[mast.sort] || {}).pts || 0);
  list = [...list].sort((x, y) => {
    const a = val(x), b = val(y);
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * mast.dir;
  });
  const more = !mast.all && list.length > 50 ? list.length : 0;
  if (more) list = list.slice(0, 50);
  const arrow = k => (mast.sort === k ? (mast.dir < 0 ? ' ↓' : ' ↑') : '');
  const head = `<tr><th data-ms="name">${t('mast.champ')}${arrow('name')}</th><th data-ms="total" class="num">${t('mast.total')}${arrow('total')}</th>
    <th class="num" title="${esc(mastTimeTip(total, read.map(a => a.puuid)))}">${t('mast.time')}</th>
    ${accs.map(a => {
      const m = by.get(a.puuid);
      return m ? `<th data-ms="${esc(a.puuid)}" class="num">${esc(dispName(a))}${arrow(a.puuid)}<small>${t('mast.asOf', { date: fmtDate(m.at) })}</small></th>`
        : `<th class="num unread" title="${esc(t('mast.notReadTip'))}">${esc(dispName(a))}<small>${t('mast.notRead')}</small></th>`;
    }).join('')}</tr>`;
  const body = list.map(r => {
    const ms = MastMath.milestone(r.total);
    return `<tr><td><span class="mast-ch"><img src="${CHAMP_ICON(r.id)}" alt="" loading="lazy">${esc(r.name)}</span></td>
      <td class="num"><b>${num(r.total)}</b>${ms ? ` <i class="ms" title="${esc(t('mast.msTip', { m: MS_LABEL[ms], list: split(r) }))}">${MS_LABEL[ms]}</i>` : ''}</td>
      <td class="num muted" title="${esc(mastTimeTip(r.est, Object.keys(r.accs)))}">${esc(mastHours(r.est))}</td>
      ${accs.map(a => {
        const v = r.accs[a.puuid];
        if (!by.has(a.puuid)) return '<td class="num unread">–</td>';
        if (!v) return '<td class="num muted">–</td>';
        const ms1 = MastMath.milestone(v.pts);
        const e = mastEstimate(a.puuid, r.id, v.pts);
        return `<td class="num${r.n > 1 && r.best === a.puuid ? ' best' : ''}" title="${esc((r.n > 1 && r.best === a.puuid ? t('mast.best') + '\n' : '') + mastHours(e) + '\n' + mastTimeTip(e, [a.puuid]))}">${num(v.pts)}${ms1 ? ` <i class="ms sm">${MS_LABEL[ms1]}</i>` : ''}<small>${t('mast.lvl', { n: v.lvl })}</small></td>`;
      }).join('')}</tr>`;
  }).join('');
  const pts = rows.reduce((x, r) => x + r.total, 0);
  const tip = esc(mastTimeTip(total, read.map(a => a.puuid)));
  el.innerHTML = `<div class="mast-totals">
      <div><span>${t('mast.totalPts')}</span><b>${num(pts)}</b></div>
      <div title="${tip}"><span>${t('mast.time')}</span><b>${esc(mastHours(total))}</b></div>
    </div>
    <div class="mast-top">${top}</div>
    <div class="mast-wrap"><table class="dash-table mast-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${3 + accs.length}" class="muted">${t('mast.noHits')}</td></tr>`}</tbody></table></div>
    ${more ? `<button class="btn mast-more" data-mast-all>${t('mast.showAll', { n: more })}</button>` : ''}`;
}

$('mastSearch').addEventListener('input', () => { mast.q = $('mastSearch').value; renderMast(); });
$('dashMast').addEventListener('click', e => {
  const s = e.target.closest('[data-ms]');
  if (s) {
    const k = s.dataset.ms;
    mast.dir = mast.sort === k ? -mast.dir : k === 'name' ? 1 : -1;
    mast.sort = k;
    return renderMast();
  }
  if (e.target.closest('[data-mast-all]')) { mast.all = true; renderMast(); }
});
