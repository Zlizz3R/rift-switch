// Overview: which accounts count – one choice for every tab (LP history, Performance, Champions,
// Play style, Mastery, Tags, Seasons), chips like the match history's queues: from "All" a click
// picks just that account, further clicks add or remove one, none left = "All" again.
// Ctrl+click keeps only that one. Kept in this browser profile (a viewer's convenience).
// The LP history shows the same choice in its coloured chips (dashboard.js).

const ovf = { off: new Set() };
try { ovf.off = new Set(JSON.parse(localStorage.getItem('rs.ovOff') || '[]')); } catch { /* no storage: all accounts */ }
const ovSave = () => { try { localStorage.setItem('rs.ovOff', JSON.stringify([...ovf.off])); } catch { /* not kept */ } };
const ovAccs = () => S.accounts.filter(a => !a.placeholder);
const ovOn = id => !ovf.off.has(id);
// the accounts in the evaluation
const ovChosen = () => ovAccs().filter(a => ovOn(a.puuid));

function ovToggle(id, only) {
  const all = ovAccs().map(a => a.puuid);
  const allOn = !all.some(x => ovf.off.has(x));
  if (only || allOn) ovf.off = new Set(all.filter(x => x !== id));
  else if (ovf.off.has(id)) ovf.off.delete(id);
  else {
    ovf.off.add(id);
    if (all.every(x => ovf.off.has(x))) ovf.off.clear();   // none left: all of them again
  }
  ovSave();
  ovRefresh();
}
function renderOvAccs() {
  const el = $('ovAccs');
  if (!el) return;
  const accs = ovAccs();
  // the LP history has its own coloured chips for the same choice
  el.hidden = dashTab() === 'lp' || accs.length < 2;
  const all = !accs.some(a => ovf.off.has(a.puuid));
  el.innerHTML = `<button data-ovacc=""${all ? ' class="on"' : ''} title="${esc(t('ov.allT'))}">${t('mh.allAccounts')}</button>` +
    accs.map(a => `<button data-ovacc="${esc(a.puuid)}"${ovOn(a.puuid) && !all ? ' class="on"' : ''} title="${esc(t('ov.accT'))}">${esc(dispName(a))}</button>`).join('');
}
// a new choice: the bar and the open tab again
function ovRefresh() {
  renderOvAccs();
  const tab = dashTab();
  if (tab === 'lp' && typeof renderDash === 'function') renderDash();
  else if (['stats', 'champs', 'style', 'map'].includes(tab)) renderPerf();
  else if (tab === 'mast') renderMast();
  else if (tab === 'tags') renderTagsView();
  else if (tab === 'seasons') renderSeasonsView();
}
$('ovAccs').addEventListener('click', e => {
  const b = e.target.closest('[data-ovacc]');
  if (!b) return;
  if (!b.dataset.ovacc) { ovf.off.clear(); ovSave(); return ovRefresh(); }
  ovToggle(b.dataset.ovacc, e.ctrlKey || e.metaKey);
});
api.onState(() => { if (view === 'dash') renderOvAccs(); });
