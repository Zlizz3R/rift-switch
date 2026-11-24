// Overview → Seasons: every account's seasons from three sources, never added up – what the client
// tells (last season's end and peak, this season's peak), what the stored ranked games say per
// calendar year, and what the user entered by hand (pasted text, with a preview). docs/plans Phase 8.

const ssv = { games: null, edit: '', text: '' };

async function loadSeasonsView() {
  ssv.games = (await allGames()) || [];
  renderSeasonsView();
}
const ssRank = r => (r && r.tier ? tierName(r.tier) + (APEX.includes(r.tier) || !r.division || r.division === 'NA' ? '' : ' ' + r.division) : '');

function renderSeasonsView() {
  const el = $('seasonsBody');
  if (!el || $('dashSeasons').hidden) return;
  if (!ssv.games) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const accs = S.accounts.filter(a => !a.placeholder);
  if (!accs.length) { el.innerHTML = `<div class="chart-empty">${t('mast.none')}</div>`; return; }
  const y = new Date().getFullYear();
  const parts = Stats.byParticipation(ssv.games).filter(x => Stats.RANKED_QUEUES.includes(x.g.q));
  el.innerHTML = accs.map(a => {
    // 1) the client (last read of this account)
    const client = [['solo', 'Solo/Duo'], ['flex', 'Flex']].flatMap(([k, label]) => {
      const q = a[k] || {};
      const out = [];
      if (q.lastSeason || q.lastSeasonPeak) out.push(`<span class="ss-chip"><b>${t('ss.season', { y: y - 1 })} · ${label}</b>${q.lastSeason ? ' ' + esc(t('ss.end', { r: ssRank(q.lastSeason) })) : ''}${q.lastSeasonPeak ? ' · ' + esc(t('ss.peak', { r: ssRank(q.lastSeasonPeak) })) : ''}</span>`);
      if (q.tier || q.peak) out.push(`<span class="ss-chip"><b>${t('ss.season', { y })} · ${label}</b>${q.tier ? ' ' + esc(t('ss.now', { r: ssRank(q) })) : ''}${q.peak ? ' · ' + esc(t('ss.peak', { r: ssRank(q.peak) })) : ''}</span>`);
      return out;
    });
    // 2) the stored ranked games, per calendar year
    const mine = parts.filter(x => x.p.puuid === a.puuid);
    const years = [...new Set(mine.map(x => new Date(x.g.t).getFullYear()))].sort((p, q) => q - p);
    const stored = years.map(yr => {
      const ag = Stats.aggregate(mine.filter(x => new Date(x.g.t).getFullYear() === yr));
      return `<span class="ss-chip"><b>${yr}</b> ${esc(t('ss.games', { n: ag.n, wr: Math.round(ag.winrate * 100) }))}</span>`;
    });
    // 3) entered by hand
    const manual = (a.seasonsManual || []).map(e => `<span class="ss-chip manual"><b>${esc(e.season)} · ${e.queue === 'flex' ? 'Flex' : 'Solo/Duo'}</b> ${esc(ssRank(e))}${e.wins != null ? ` · ${e.wins}W` : ''}${e.losses != null ? ` ${e.losses}L` : ''}</span>`);
    const editing = ssv.edit === a.puuid;
    const row = (label, chips, empty) => `<div class="ss-row"><span class="ss-l">${label}</span><div class="ss-chips">${chips.length ? chips.join('') : `<span class="muted">${empty}</span>`}</div></div>`;
    return `<div class="ss-acc">
      <div class="ss-head"><b>${esc(dispName(a))}</b><button class="btn small" data-ssedit="${esc(a.puuid)}">${t(editing ? 'ss.close' : 'ss.edit')}</button></div>
      ${row(t('ss.fromClient'), client, t('ss.noClient'))}
      ${row(t('ss.fromGames'), stored, t('ss.noGames'))}
      ${row(t('ss.byHand'), manual, t('ss.noManual'))}
      ${editing ? ssEditorHtml() : ''}
    </div>`;
  }).join('') + `<p class="coll-foot">${t('ss.note')}</p>`;
}
function ssEditorHtml() {
  const r = SeasonParse.parseSeasons(ssv.text);
  return `<div class="ss-edit"><textarea id="ssText" spellcheck="false" placeholder="${esc(t('ss.ph'))}">${esc(ssv.text)}</textarea>
    <div class="ss-prev">${r.entries.map(e => `<span class="ss-chip manual"><b>${esc(e.season)} · ${e.queue === 'flex' ? 'Flex' : 'Solo/Duo'}</b> ${esc(ssRank(e))}${e.wins != null ? ` · ${e.wins}W` : ''}${e.losses != null ? ` ${e.losses}L` : ''}</span>`).join('')}
      ${r.bad.length ? `<span class="ss-bad">${esc(t('ss.bad', { lines: r.bad.join(', ') }))}</span>` : ''}</div>
    <div class="ss-btns"><button class="btn gold small" id="ssSave">${t('ss.save', { n: r.entries.length })}</button></div></div>`;
}
$('dashSeasons').addEventListener('click', async e => {
  const b = e.target.closest('[data-ssedit]');
  if (b) {
    const id = b.dataset.ssedit;
    if (ssv.edit === id) ssv.edit = '';
    else { ssv.edit = id; const a = S.accounts.find(x => x.puuid === id); ssv.text = ((a && a.seasonsManual) || []).map(SeasonParse.lineOf).join('\n'); }
    return renderSeasonsView();
  }
  if (e.target.closest('#ssSave')) {
    const { entries } = SeasonParse.parseSeasons(ssv.text);
    await api.seasonsSet(ssv.edit, entries);
    const a = S.accounts.find(x => x.puuid === ssv.edit);
    if (a) a.seasonsManual = entries;
    ssv.edit = '';
    toast(t('ss.saved'));
    renderSeasonsView();
  }
});
$('dashSeasons').addEventListener('input', e => {
  if (e.target.id !== 'ssText') return;
  ssv.text = e.target.value;
  const prev = document.querySelector('.ss-edit');
  if (prev) { const pos = e.target.selectionStart; const html = ssEditorHtml(); const tmp = document.createElement('div'); tmp.innerHTML = html;
    prev.querySelector('.ss-prev').innerHTML = tmp.querySelector('.ss-prev').innerHTML; prev.querySelector('#ssSave').textContent = tmp.querySelector('#ssSave').textContent; e.target.selectionStart = e.target.selectionEnd = pos; }
});
api.onState(() => { if (view === 'dash' && dashTab() === 'seasons' && !ssv.edit) renderSeasonsView(); });
