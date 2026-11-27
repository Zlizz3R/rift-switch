// The Overview's showcase: favourites from your accounts' collections in the head, over the splash
// art – summoner icons, skins, ward skins and emotes, any mix in your own order, small / medium /
// large. Only on your own Overview (nobody else sees it; it's just for you). Kept as the setting
// `showcase`: { size: 1–3, items: [{ k: 'icon'|'skin'|'ward'|'emote', id, n: name, p: picture path }] },
// so the head draws it without reading the collections. Uses the globals of renderer.js /
// views.js / collection.js / summary.js.

const SHOW_KINDS = ['skin', 'icon', 'ward', 'emote'];
const SHOW_MAX = 24;
// how many of a kind the picker draws at once (the search finds the rest)
const SHOW_GRID = 240;
// open: the editor is open; data: every owned item of every own account, by kind (read when it opens);
// skins: filters by rarity ('' = all), Legacy only, the year they were got ('' = all)
const shv = { kind: 'skin', q: '', data: null, rar: '', leg: false, year: '' };
// the rarities in the client's order (Mythic before Legendary, as the collection shows them)
const SH_RARS = [0, 1, 2, 4, 3, 5, 6, 7];

const showSet = () => {
  const s = S.settings && S.settings.showcase;
  return s && Array.isArray(s.items) ? { size: [1, 2, 3].includes(s.size) ? s.size : 2, items: s.items } : { size: 2, items: [] };
};
const showPic = x => (x.k === 'icon' ? iconUrl(x.id) : collTile(x.p));
const showName = x => x.n || (x.k === 'icon' ? t('sh.icon', { id: x.id }) : '#' + x.id);
const showKey = x => x.k + ':' + x.id;

// the head: the showcase (if it has anything) and the button that opens the editor
function renderShowcase() {
  const el = $('ovShow'), btn = $('ovShowBtn');
  if (!el || !btn) return;
  const s = showSet();
  btn.innerHTML = `<button class="btn small ov-mine" data-shedit title="${esc(t('sh.editT'))}"><svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>${esc(t('sh.title'))}</button>`;
  el.hidden = !s.items.length;
  el.className = `ov-show s-${s.size}`;
  el.innerHTML = s.items.map(x => `<span class="shi k-${x.k}" title="${esc(showName(x))}"><img src="${esc(showPic(x))}" alt="" loading="lazy"></span>`).join('');
}

// ---------- the editor ----------
// every owned item of the own accounts, each once: { skin: [{ k, id, n, p }], icon, ward, emote }
function showOwned(list) {
  const by = { skin: new Map(), icon: new Map(), ward: new Map(), emote: new Map() };
  for (const c of list || []) {
    // a skin read with the game data: [id, name, picture, rarity, legacy, year got]
    for (const [id, n, p, r, l, y] of c.skins || []) {
      if (!collReal(collSkinChamp(id))) continue;
      const had = by.skin.get(id);
      // the same skin on two accounts (one maybe read before these were kept): what is known, the earlier year
      const year = had && had.y && (!y || had.y < y) ? had.y : y || 0;
      by.skin.set(id, { k: 'skin', id, n: n || (had && had.n) || '', p: p || (had && had.p) || '', r: r != null ? r : had ? had.r : null, l: !!l || !!(had && had.l), y: year });
    }
    for (const id of c.icons || []) by.icon.set(id, { k: 'icon', id, n: '', p: '' });
    for (const [id, n, p] of c.wards || []) by.ward.set(id, { k: 'ward', id, n: n || '', p: p || '' });
    for (const [id, n, p] of c.emotes || []) by.emote.set(id, { k: 'emote', id, n: n || '', p: p || '' });
  }
  const out = {};
  for (const k of SHOW_KINDS) out[k] = [...by[k].values()].sort((a, b) => (k === 'icon' ? b.id - a.id : a.n.localeCompare(b.n)));
  return out;
}
async function openShowcase() {
  $('showBox').hidden = false;
  shv.q = '';
  renderShowEd();
  try { shv.data = showOwned(await api.collections()); } catch (e) { shv.data = showOwned([]); }
  renderShowEd();
}
function renderShowEd() {
  const el = $('showEd');
  if (!el) return;
  const s = showSet();
  const size = `<div class="sh-row"><span class="sh-l">${esc(t('sh.size'))}</span><div class="seg">${[[1, 'ov.sizeS'], [2, 'sh.sizeM'], [3, 'sh.sizeL']].map(([n, k]) => `<button data-shsize="${n}"${s.size === n ? ' class="on"' : ''}>${esc(t(k))}</button>`).join('')}</div></div>`;
  const cur = s.items.length
    ? s.items.map((x, i) => `<span class="sh-cur k-${x.k}" title="${esc(showName(x))}"><img src="${esc(showPic(x))}" alt="" loading="lazy">
        <span class="sh-tools"><button data-shmove="${i}:-1" title="${esc(t('ov.moveL'))}">←</button><button data-shdel="${i}" title="${esc(t('sh.remove'))}">✕</button><button data-shmove="${i}:1" title="${esc(t('ov.moveR'))}">→</button></span></span>`).join('')
    : `<span class="muted">${esc(t('sh.empty'))}</span>`;
  const head = `<div class="sh-row"><span class="sh-l">${esc(t('sh.inIt', { n: s.items.length, max: SHOW_MAX }))}</span></div><div class="sh-curs">${cur}</div>`;
  if (!shv.data) { el.innerHTML = size + head + `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const kinds = `<div class="seg sh-kinds">${SHOW_KINDS.map(k => `<button data-shkind="${k}"${shv.kind === k ? ' class="on"' : ''}>${esc(t('sh.k.' + k))} <small>${num(shv.data[k].length)}</small></button>`).join('')}</div>`;
  const q = collNorm(shv.q);
  // skins: by rarity, Legacy, the year they were got (only what the skins have; read before these
  // were kept: no filters until the next Load)
  const skins = shv.kind === 'skin' ? shv.data.skin : [];
  const rars = SH_RARS.filter(r => skins.some(x => x.r === r));
  const years = [...new Set(skins.map(x => x.y).filter(Boolean))].sort((a, b) => b - a);
  if (shv.rar !== '' && !rars.includes(Number(shv.rar))) shv.rar = '';
  if (shv.year !== '' && !years.includes(Number(shv.year))) shv.year = '';
  const filters = rars.length ? `<div class="sh-row sh-filters"><div class="seg sh-rars"><button data-shrar=""${shv.rar === '' ? ' class="on"' : ''}>${esc(t('sh.allRars'))}</button>${rars.map(r =>
    `<button data-shrar="${r}"${String(shv.rar) === String(r) ? ' class="on"' : ''}><i class="rar r${r}"></i>${esc(t('rar.' + r))}</button>`).join('')}</div>
    ${skins.some(x => x.l) ? `<button class="chip${shv.leg ? ' on' : ''}" data-shleg title="${esc(t('coll.legacyT'))}">${esc(t('coll.legacy'))}</button>` : ''}
    ${years.length ? `<select id="showYear" title="${esc(t('sh.yearT'))}"><option value="">${esc(t('sh.allYears'))}</option>${years.map(y => `<option value="${y}"${String(shv.year) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}</select>` : ''}</div>` : '';
  const all = shv.data[shv.kind].filter(x => (!q || collNorm(x.n).includes(q) || String(x.id) === q)
    && (shv.kind !== 'skin' || ((shv.rar === '' || x.r === Number(shv.rar)) && (!shv.leg || x.l) && (shv.year === '' || x.y === Number(shv.year)))));
  const inIt = new Set(s.items.map(showKey));
  const grid = all.slice(0, SHOW_GRID).map(x => `<button class="sh-pick k-${x.k}${inIt.has(showKey(x)) ? ' on' : ''}" data-shadd="${showKey(x)}" title="${esc(showName(x))}"><img src="${esc(showPic(x))}" alt="" loading="lazy">${x.k === 'skin' ? `<small>${esc(x.n)}</small>` : ''}</button>`).join('');
  const none = !shv.data[shv.kind].length ? `<p class="muted">${esc(t(shv.kind === 'skin' ? 'sh.noneSkin' : 'sh.noneRead'))}</p>` : !all.length ? `<p class="muted">${esc(t('sh.noMatch'))}</p>` : '';
  const more = all.length > SHOW_GRID ? `<p class="fine">${esc(t('sh.more', { n: num(all.length - SHOW_GRID) }))}</p>` : '';
  const hadQ = document.activeElement && document.activeElement.id === 'showQ';
  el.innerHTML = size + head + `<div class="sh-row">${kinds}<input class="mh-input" id="showQ" type="search" spellcheck="false" placeholder="${esc(t('sh.searchPh'))}" value="${esc(shv.q)}"></div>
    ${filters}<div class="sh-grid k-${shv.kind}">${grid}</div>${none}${more}`;
  if (hadQ) { const i = $('showQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function saveShowcase(s) {
  const v = { size: s.size, items: s.items.slice(0, SHOW_MAX) };
  S.settings = { ...S.settings, showcase: v };
  api.setSetting('showcase', v);
  renderShowcase();
  renderShowEd();
}
const closeShowcase = () => { $('showBox').hidden = true; };

document.addEventListener('click', e => {
  if (e.target.closest('[data-shedit]')) return openShowcase();
  const box = $('showBox');
  if (!box || box.hidden) return;
  if (e.target === box || e.target.closest('#showDone')) return closeShowcase();
  const b = e.target.closest('[data-shsize], [data-shkind], [data-shadd], [data-shdel], [data-shmove], [data-shrar], [data-shleg], #showClear');
  if (!b || !box.contains(b)) return;
  const s = showSet(), items = [...s.items];
  if (b.id === 'showClear') return saveShowcase({ size: s.size, items: [] });
  if (b.dataset.shrar != null) { shv.rar = b.dataset.shrar; return renderShowEd(); }
  if (b.dataset.shleg != null) { shv.leg = !shv.leg; return renderShowEd(); }
  if (b.dataset.shkind) { shv.kind = b.dataset.shkind; shv.q = ''; return renderShowEd(); }
  if (b.dataset.shsize) return saveShowcase({ size: Number(b.dataset.shsize), items });
  if (b.dataset.shdel) { items.splice(Number(b.dataset.shdel), 1); return saveShowcase({ size: s.size, items }); }
  if (b.dataset.shmove) {
    const [i, d] = b.dataset.shmove.split(':').map(Number), j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    return saveShowcase({ size: s.size, items });
  }
  if (b.dataset.shadd) {
    // a second click takes it out again
    const i = items.findIndex(x => showKey(x) === b.dataset.shadd);
    if (i >= 0) items.splice(i, 1);
    else {
      if (items.length >= SHOW_MAX) return;
      const x = shv.data && shv.data[b.dataset.shadd.split(':')[0]].find(y => showKey(y) === b.dataset.shadd);
      if (x) items.push({ k: x.k, id: x.id, n: x.n, p: x.p });
    }
    return saveShowcase({ size: s.size, items });
  }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'showYear') return;
  shv.year = e.target.value;
  renderShowEd();
});
document.addEventListener('input', e => {
  if (e.target.id !== 'showQ') return;
  shv.q = e.target.value;
  renderShowEd();
});
document.addEventListener('keydown', e => {
  const box = $('showBox');
  if (e.key === 'Escape' && box && !box.hidden) { e.stopPropagation(); closeShowcase(); }
}, true);
