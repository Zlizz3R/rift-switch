// Keyboard: shortcuts for the pages, the search, adding, and moving through the accounts
// (arrow keys pick the next tile, Enter logs in). "?" lists them all. Globals of renderer.js / views.js.

const typing = el => el && el.matches && (el.matches('input, textarea, select') || el.isContentEditable);
const anyOverlay = () => !!document.querySelector('.overlay:not([hidden])') || !$('menu').hidden;
const visibleTiles = () => [...document.querySelectorAll('#board .tile[data-id]')];

// the tile that is one step away in that direction (grid: same column one row up/down)
function stepTile(dir) {
  const tiles = visibleTiles();
  if (!tiles.length) return null;
  const i = tiles.findIndex(x => x.dataset.id === selectedId);
  if (i < 0) return tiles[0];
  if (dir === 'left') return tiles[Math.max(0, i - 1)];
  if (dir === 'right') return tiles[Math.min(tiles.length - 1, i + 1)];
  const cur = tiles[i].getBoundingClientRect();
  const cx = cur.left + cur.width / 2;
  const rows = tiles.filter(x => {
    const r = x.getBoundingClientRect();
    return dir === 'down' ? r.top > cur.top + 4 : r.top < cur.top - 4;
  });
  if (!rows.length) return tiles[i];
  // the nearest row, then the tile closest to the same column
  const rowTop = dir === 'down' ? Math.min(...rows.map(x => x.getBoundingClientRect().top)) : Math.max(...rows.map(x => x.getBoundingClientRect().top));
  const row = rows.filter(x => Math.abs(x.getBoundingClientRect().top - rowTop) < 4);
  return row.sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - cx) - Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - cx))[0]
    // jsdom has no layout: then up/down are just the previous / next one
    || tiles[dir === 'down' ? Math.min(tiles.length - 1, i + 1) : Math.max(0, i - 1)];
}

// Ctrl+5: the match history (a tab of the Overview)
const VIEWS = ['accounts', 'dash', 'coll', 'live', 'matches', 'tools'];
document.addEventListener('keydown', async e => {
  if (e.defaultPrevented || e.altKey) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key;
  // Ctrl+F: search the accounts – works from anywhere (Ctrl+K: the player search, player-view.js)
  if (ctrl && k === 'f') {
    e.preventDefault();
    if (anyOverlay()) return;
    showView('accounts'); $('search').focus(); $('search').select();
    return;
  }
  if (typing(e.target) || anyOverlay()) return;
  if (ctrl && k >= '1' && k <= '6') { e.preventDefault(); return showView(VIEWS[+k - 1]); }
  if (ctrl && k.toLowerCase() === 'n') { e.preventDefault(); showView('accounts'); return e.shiftKey ? openBulk(true) : openDrawer(true); }
  if (ctrl && k === ',') { e.preventDefault(); return openSettings(true); }
  if (k === 'F5') { e.preventDefault(); return $('toolRefresh').click(); }
  if (k === '?' ) { e.preventDefault(); return openHelp('keys'); }
  if (k === '/') { e.preventDefault(); showView('accounts'); return $('search').focus(); }
  if (view !== 'accounts') return;
  if (ctrl && k.toLowerCase() === 'a') {
    e.preventDefault();
    visibleTiles().forEach(x => picked.add(x.dataset.id));
    if (picked.size === 1) { selectedId = [...picked][0]; picked.clear(); }
    return render();
  }
  const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[k];
  if (dir) {
    e.preventDefault();
    const next = stepTile(dir);
    if (!next) return;
    if (e.shiftKey) { if (!picked.size && selectedId) picked.add(selectedId); picked.add(next.dataset.id); }
    else picked.clear();
    selectedId = next.dataset.id;
    render();
    document.querySelector(`#board .tile[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const a = S.accounts.find(x => x.puuid === selectedId);
  if (!a) return;
  if (k === 'Enter') { e.preventDefault(); return switchTo(a.puuid); }
  if (k === 'F2' || k.toLowerCase() === 'e') { e.preventDefault(); return editNote(a.puuid); }
  if (k.toLowerCase() === 'p' && !a.placeholder) { e.preventDefault(); return openProfile(a.puuid); }
  if (k === 'Delete') {
    e.preventDefault();
    if (picked.size > 1) return document.querySelector('[data-m="remove"]')?.click();
    if (await confirmBox(t('menu.removeTitle', { name: dispName(a) }), t('menu.removeText'), t('menu.remove'))) api.remove(a.puuid);
  }
});
$('keysBtn').onclick = () => openHelp('keys');
