// Adding many accounts at once: paste a list (one per line, or "key: value" blocks), see what was
// understood, pick a category, add. Every account goes through the same "save for later" as the
// single form (nothing is logged in now). Uses the globals of renderer.js / views.js.

let bulkRows = [];
let bulkRunning = false;

function openBulk(show = true) {
  $('bulkBox').hidden = !show;
  if (!show) return;
  openDrawer(false);
  $('bulkCat').innerHTML = `<option value="">${esc(t('bulk.noCat'))}</option>` + cats().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  renderBulk();
  $('bulkText').focus();
}
function renderBulk() {
  bulkRows = BulkParse.parseBulk($('bulkText').value);
  const ok = bulkRows.filter(r => !r.error);
  const stars = p => '•'.repeat(Math.min(10, p.length));
  $('bulkList').innerHTML = bulkRows.length ? bulkRows.map(r => `<div class="bk-row ${r.error ? 'bad' : ''}">
      <span class="bk-n">${r.line}</span>
      <span class="bk-u">${esc(r.u || '–')}</span>
      <span class="bk-p">${r.p ? stars(r.p) : ''}</span>
      <span class="bk-id">${esc(r.riotId || '')}</span>
      <span class="bk-note">${esc(r.note || '')}</span>
      <span class="bk-st">${r.error ? esc(t('bulk.err.' + r.error)) : r.u ? '✓' : esc(t('bulk.idOnly'))}</span></div>`).join('')
    : `<div class="bk-empty">${esc(t('bulk.none'))}</div>`;
  $('bulkGo').disabled = !ok.length || bulkRunning;
  $('bulkGo').textContent = t('bulk.btn', { n: ok.length });
}
async function runBulk() {
  const list = bulkRows.filter(r => !r.error);
  if (!list.length || bulkRunning) return;
  bulkRunning = true;
  const cat = $('bulkCat').value;
  const ids = [];
  let failed = 0;
  $('bulkText').disabled = true;
  for (let i = 0; i < list.length; i++) {
    $('bulkGo').disabled = true;
    $('bulkGo').textContent = t('bulk.progress', { i: i + 1, n: list.length });
    const r = list[i];
    const res = await api.addSaved({ riotId: r.riotId, u: r.u, p: r.p });
    if (res && res.ok && res.puuid) {
      ids.push(res.puuid);
      if (r.note) await api.setNote(res.puuid, r.note);
    } else failed++;
  }
  bulkRunning = false;
  $('bulkText').disabled = false;
  // the new tiles must be in the list before they can be moved
  if (cat && ids.length) { const st = await api.getState(); if (st && st.accounts) S = st; moveMany(ids, cat); }
  const skipped = bulkRows.length - list.length + failed;
  toast(skipped ? t('bulk.doneSkip', { n: ids.length, k: skipped }) : t('bulk.done', { n: ids.length }), !ids.length);
  if (ids.length) { $('bulkText').value = ''; openBulk(false); }
  else renderBulk();
}

$('optBulk').onclick = () => openBulk(true);
$('bulkText').addEventListener('input', renderBulk);
$('bulkCancel').onclick = () => { if (!bulkRunning) openBulk(false); };
$('bulkGo').onclick = runBulk;
