// Collection page: champions, skins and shards of every account (as read at its last login), and
// a search across all of them – "who has Ahri / a Star Guardian skin / an Ashe shard?".
// Riot only tells the signed-in account's collection: each account is read while you are logged
// in to it (every 5 minutes, or now with "Load"). Uses the globals of renderer.js / views.js.

const coll = { data: null, champs: null, q: '', kind: 'all', stamp: '' };

async function loadColl() {
  coll.stamp = collStamp();
  const [d, ch] = await Promise.all([api.collections(), coll.champs ? null : api.champions()]);
  coll.data = Array.isArray(d) ? d : [];
  if (Array.isArray(ch) && ch.length) coll.champs = new Map(ch.map(c => [c.id, c.name]));
  if (view === 'coll') renderColl();
}
// a new reading of any account (the state carries only its time): fetch again while the page is open
const collStamp = () => S.accounts.map(a => a.collAt || 0).join(',');
api.onState(() => {
  if (view !== 'coll') return;
  if (collStamp() !== coll.stamp) loadColl(); else renderCollBar();
});

// a skin's own picture: the client's tilePath ("/lol-game-data/assets/…") at CommunityDragon
const collTile = p => (p ? `${CDRAGON}/rcp-be-lol-game-data/global/default/${p.toLowerCase().replace('/lol-game-data/assets/', '')}` : '');
const collChamp = id => (coll.champs && coll.champs.get(id)) || '#' + id;
// a skin id is champion id * 1000 + skin number
const collSkinChamp = id => Math.floor(id / 1000);
const collNorm = s => String(s || '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// the client also lists copies of every champion for special modes (ids from 60000 on): left out
const collReal = champ => champ > 0 && champ < 10000;

// everything one account owns, as searchable entries
function collEntries(c) {
  const out = [];
  for (const id of c.champs || []) if (collReal(id)) out.push({ k: 'champ', id, name: collChamp(id), champ: id });
  for (const [id, name, tile] of c.skins || []) {
    if (collReal(collSkinChamp(id))) out.push({ k: 'skin', id, name: name || collChamp(collSkinChamp(id)), champ: collSkinChamp(id), tile: collTile(tile) });
  }
  for (const [kind, id, n, name, tile] of c.shards || []) {
    const isSkin = kind === 's' || kind === 'S';
    const champ = isSkin ? collSkinChamp(id) : id;
    if (!collReal(champ)) continue;
    out.push({ k: isSkin ? 'skinShard' : 'champShard', id, n, perm: kind === 'C' || kind === 'S', name: name || collChamp(champ), champ, tile: isSkin ? collTile(tile) : '' });
  }
  return out;
}
function collMatch(e, q) {
  if (!q) return true;
  return collNorm(e.name).includes(q) || collNorm(collChamp(e.champ)).includes(q);
}
// ---------- by rarity: one table per kind, a row per account (to compare them) ----------
const COLL_RAR_KINDS = [['skin', 'coll.skins'], ['chroma', 'coll.n.chroma'], ['ward', 'coll.n.ward'], ['icon', 'coll.n.icon']];
const collBdOpen = () => { try { return localStorage.getItem('rs.collBd') === '1'; } catch { return false; } };
function collRarityHtml(known, by) {
  const open = collBdOpen();
  const btn = `<button class="btn small coll-bd-btn${open ? ' open' : ''}" data-collbd>${t(open ? 'coll.bdHide' : 'coll.bdShow')}</button>`;
  if (!open) return `<div class="coll-bd">${btn}</div>`;
  const rowsOf = k => known.map(a => ({ a, r: ((by.get(a.puuid).counts || {}).rar || {})[k] })).filter(x => Array.isArray(x.r));
  // one set of columns for every table – the rarities anyone has of any kind, lowest first – so
  // each rarity sits in the same place in all of them
  const cols = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => COLL_RAR_KINDS.some(([k]) => rowsOf(k).some(x => x.r[i] > 0)));
  const tables = !cols.length ? '' : COLL_RAR_KINDS.map(([k, label]) => {
    const rows = rowsOf(k);
    if (!rows.length || !rows.some(x => x.r.some(v => v > 0))) return '';
    const sum = cols.map(i => rows.reduce((s, x) => s + (x.r[i] || 0), 0));
    return `<table class="dash-table coll-table coll-rar"><colgroup><col class="rar-name">${cols.map(() => '<col>').join('')}</colgroup><thead><tr><th>${t(label)}</th>${cols.map(i => `<th><i class="rar r${i}"></i>${t('rar.' + i)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(({ a, r }) => `<tr><td><span class="dash-name">${esc(dispName(a))}</span></td>${cols.map(i => `<td>${r[i] ? num(r[i]) : '<span class="muted">0</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      ${rows.length > 1 ? `<tfoot><tr><td>${t('coll.total')}</td>${sum.map(v => `<td>${num(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
  }).join('');
  return `<div class="coll-bd">${btn}${tables || `<p class="coll-foot">${t('coll.bdLater')}</p>`}<p class="coll-foot">${t('coll.bdNote')}</p></div>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-collbd]')) return;
  try { localStorage.setItem('rs.collBd', collBdOpen() ? '0' : '1'); } catch { /* not kept */ }
  renderColl();
});

// the counted things beside champions and skins (riot.rs counts_of)
const COLL_COUNTS = ['chroma', 'ward', 'icon', 'emote', 'finisher', 'runes'];
// read before these were counted: say once that the next "Load" fills them in
const collCountsHint = (known, by) => known.some(a => !by.get(a.puuid).counts) ? `<p class="coll-foot">${t('coll.countsLater')}</p>` : '';
const COLL_KINDS = { all: () => true, champ: e => e.k === 'champ', skin: e => e.k === 'skin', shard: e => e.k === 'champShard' || e.k === 'skinShard' };

// the shared "Load" button (views.js) reads the signed-in account; the others at their next login
function renderCollBar() {
  const live = S.live || {};
  const me = S.accounts.find(a => a.puuid === live.puuid);
  $('collReadFor').textContent = !live.clientUp ? t('coll.readClosed') : me ? t('coll.readFor', { name: dispName(me) }) : '';
  refreshLoadBtns();
}

function renderColl() {
  const el = $('collBody');
  if (!el) return;
  document.querySelectorAll('[data-ck]').forEach(b => b.classList.toggle('on', b.dataset.ck === coll.kind));
  renderCollBar();
  if (!coll.data) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; $('collTiles').innerHTML = ''; return; }
  const accs = S.accounts.filter(a => !a.placeholder);
  const by = new Map(coll.data.map(c => [c.puuid, c]));
  const known = accs.filter(a => by.has(a.puuid));
  const missing = accs.length - known.length;
  const foot = missing ? `<p class="coll-foot">${t('coll.missing', { n: missing })}</p>` : '';
  const q = collNorm(coll.q);
  renderCollTiles(accs, by, q);
  if (!q && coll.kind === 'all') {
    // no search: every account with its numbers – or that it hasn't been read yet
    if (!accs.length) { el.innerHTML = `<div class="chart-empty">${t('coll.empty')}</div>`; return; }
    const sorted = [...known, ...accs.filter(a => !by.has(a.puuid))];
    // per account: what it owns, counted (shards are in the search, not here)
    const nums = c => {
      const e = collEntries(c);
      const n = c.counts || {};
      // not read yet (e.g. the client hadn't loaded them at login): "–", not 0
      return [c.champs ? e.filter(x => x.k === 'champ').length : null, c.skins ? e.filter(x => x.k === 'skin').length : null, ...COLL_COUNTS.map(k => n[k])];
    };
    const cell = v => `<td>${v == null ? '<span class="muted">–</span>' : num(v)}</td>`;
    const rows = sorted.map(a => {
      const c = by.get(a.puuid);
      if (!c) return `<tr class="unread" data-cacc="${esc(a.puuid)}"><td><span class="dash-name">${esc(dispName(a))}</span></td><td colspan="${COLL_COUNTS.length + 5}" class="muted">${t('coll.notRead')}</td></tr>`;
      const pr = a.profile || {};
      const wallet = k => (pr[k] == null || hides('wallet') ? null : pr[k]);
      return `<tr data-cacc="${esc(a.puuid)}"><td><span class="dash-name">${esc(dispName(a))}</span></td>${nums(c).map(cell).join('')}
        ${cell(wallet('be'))}${cell(wallet('rp'))}<td class="muted">${esc(fmtDate(c.at))}</td></tr>`;
    });
    // all accounts together (a number nobody has read yet stays "–")
    let foot2 = '';
    if (known.length > 1) {
      const all = known.map(a => nums(by.get(a.puuid)));
      const sum = all[0].map((_, i) => all.some(r => r[i] != null) ? all.reduce((x, r) => x + (r[i] || 0), 0) : null);
      foot2 = `<tfoot><tr><td>${t('coll.total')}</td>${sum.map(cell).join('')}<td></td><td></td><td></td></tr></tfoot>`;
    }
    const head = ['coll.champs', 'coll.skins', ...COLL_COUNTS.map(k => 'coll.n.' + k), 'p.be', 'coll.rp', 'coll.asOf'];
    el.innerHTML = `<table class="dash-table coll-table"><thead><tr><th>${t('dash.account')}</th>${head.map(k => `<th>${t(k)}</th>`).join('')}</tr></thead><tbody>
      ${rows.join('')}</tbody>${foot2}</table>${collCountsHint(known, by)}${collRarityHtml(known, by)}`;
    return;
  }
  if (!known.length) { el.innerHTML = `<div class="chart-empty">${t('coll.empty')}</div>`; return; }
  // a search: per account what matches, grouped
  const rows = known.map(a => ({ a, hits: collEntries(by.get(a.puuid)).filter(e => COLL_KINDS[coll.kind](e) && collMatch(e, q)) }))
    .filter(r => r.hits.length);
  if (!rows.length) { el.innerHTML = `<div class="chart-empty">${t('coll.none')}</div>${foot}`; return; }
  const COLL_LABEL = { champ: 'coll.champ', skin: 'coll.skin', champShard: 'coll.champShard', skinShard: 'coll.skinShard' };
  el.innerHTML = `<div class="coll-hits">${rows.map(({ a, hits }) => `<div class="coll-acc" data-cacc="${esc(a.puuid)}">
      <div class="ca-head"><b>${esc(dispName(a))}</b><span>${t('coll.hits', { n: hits.length })}</span></div>
      <div class="ca-list">${hits.sort((x, y) => x.k.localeCompare(y.k) || x.name.localeCompare(y.name)).slice(0, 60).map(h =>
        `<span class="cl-chip ${h.k}" title="${esc(t(COLL_LABEL[h.k]))}"><img src="${h.tile || CHAMP_ICON(h.champ)}" alt="" loading="lazy">${esc(h.name)}${h.n > 1 ? ` <i>×${h.n}</i>` : ''}${h.k.endsWith('Shard') ? ` <em>${t(h.perm ? 'coll.perm' : 'coll.shard')}</em>` : ''}</span>`).join('')}</div></div>`).join('')}</div>${foot}`;
}

// Mini tiles above the list: every account at a glance. With a search ("Yorick", "K/DA") the
// border tells what each account has – green: the champion and a matching skin, yellow: the
// champion but no such skin, greyed out: not the champion. Not read yet: dashed.
function collSearchChamps(by, q) {
  const ids = new Set();
  if (coll.champs) for (const [id, name] of coll.champs) if (collReal(id) && collNorm(name).includes(q)) ids.add(id);
  // a skin name ("Shepherd of Souls") stands for its champion
  for (const c of by.values()) for (const e of collEntries(c)) if ((e.k === 'champ' || e.k === 'skin') && collMatch(e, q)) ids.add(e.champ);
  return ids;
}
function collTileState(c, q, ids) {
  const e = collEntries(c);
  const own = new Set(e.filter(x => x.k === 'champ').map(x => x.champ));
  const hasChamp = [...ids].some(id => own.has(id));
  const skins = e.filter(x => x.k === 'skin' && ids.has(x.champ) && own.has(x.champ) && collMatch(x, q)).length;
  return { st: !hasChamp ? 'none' : skins ? 'both' : 'champ', skins };
}
function renderCollTiles(accs, by, q) {
  const el = $('collTiles');
  if (!accs.length) { el.innerHTML = ''; return; }
  const ids = q ? collSearchChamps(by, q) : null;
  const ORDER = { both: 0, champ: 1, none: 2, unread: 3 };
  const tiles = accs.map(a => {
    const c = by.get(a.puuid);
    if (!c) return { a, st: 'unread', sub: t('coll.notRead').split(/ [–-] /)[0], tip: t('coll.notRead') };
    if (!q) return { a, st: '', sub: `${t('coll.champs')}: ${c.champs ? collEntries(c).filter(x => x.k === 'champ').length : '–'}`, tip: '' };
    const { st, skins } = collTileState(c, q, ids);
    const tip = t(st === 'both' ? 'coll.tBoth' : st === 'champ' ? 'coll.tChamp' : 'coll.tNone');
    return { a, st, sub: st === 'none' ? tip : `${t('coll.skins')}: ${skins}`, tip };
  });
  if (q) tiles.sort((x, y) => ORDER[x.st] - ORDER[y.st]);
  const key = q ? `<div class="coll-key">${['both', 'champ', 'none'].map(s => `<span><i class="${s}"></i>${esc(t(s === 'both' ? 'coll.tBoth' : s === 'champ' ? 'coll.tChamp' : 'coll.tNone'))}</span>`).join('')}</div>` : '';
  // like the account tiles: the summoner icon with the level small at the bottom
  const av = a => `<div class="avatar">${a.iconId != null && !hides('icon') ? `<img src="${iconUrl(a.iconId)}" alt="" loading="lazy">` : '<div class="ph"></div>'}${a.level && !hides('level') ? `<span class="level">${a.level}</span>` : ''}</div>`;
  el.innerHTML = tiles.map(({ a, st, sub, tip }) => `<button class="ct ${st}" data-cacc="${esc(a.puuid)}"${tip ? ` title="${esc(tip)}"` : ''}>${av(a)}<b>${esc(dispName(a))}</b><span>${esc(sub)}</span></button>`).join('') + key;
}

$('collSearch').addEventListener('input', () => { coll.q = $('collSearch').value; renderColl(); });
$('viewColl').addEventListener('click', e => {
  const k = e.target.closest('[data-ck]');
  if (k) { coll.kind = k.dataset.ck; return renderColl(); }
  const a = e.target.closest('[data-cacc]');
  if (a) openProfile(a.dataset.cacc);
});
