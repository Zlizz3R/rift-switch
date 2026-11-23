// Collection page: champions, skins and shards of every account (as read at its last login), and
// a search across all of them – "who has Ahri / a Star Guardian skin / an Ashe shard?".
// Riot only tells the signed-in account's collection: each account is read while you are logged
// in to it (every 5 minutes, or now with "Read now"). Uses the globals of renderer.js / views.js.

const coll = { data: null, champs: null, q: '', kind: 'all', reading: false, stamp: '' };

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
const COLL_KINDS = { all: () => true, champ: e => e.k === 'champ', skin: e => e.k === 'skin', shard: e => e.k === 'champShard' || e.k === 'skinShard' };

// "Read now": the signed-in account, right away
function renderCollBar() {
  const live = S.live || {};
  const me = S.accounts.find(a => a.puuid === live.puuid);
  const b = $('collRead');
  b.disabled = coll.reading || !live.clientUp || !me;
  b.textContent = coll.reading ? t('coll.reading') : t('coll.readNow');
  $('collReadFor').textContent = !live.clientUp ? t('coll.readClosed') : me ? t('coll.readFor', { name: dispName(me) }) : '';
}

function renderColl() {
  const el = $('collBody');
  if (!el) return;
  document.querySelectorAll('[data-ck]').forEach(b => b.classList.toggle('on', b.dataset.ck === coll.kind));
  renderCollBar();
  if (!coll.data) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const accs = S.accounts.filter(a => !a.placeholder);
  const by = new Map(coll.data.map(c => [c.puuid, c]));
  const known = accs.filter(a => by.has(a.puuid));
  const missing = accs.length - known.length;
  const foot = missing ? `<p class="coll-foot">${t('coll.missing', { n: missing })}</p>` : '';
  const q = collNorm(coll.q);
  if (!q && coll.kind === 'all') {
    // no search: every account with its numbers – or that it hasn't been read yet
    if (!accs.length) { el.innerHTML = `<div class="chart-empty">${t('coll.empty')}</div>`; return; }
    const sorted = [...known, ...accs.filter(a => !by.has(a.puuid))];
    el.innerHTML = `<table class="dash-table coll-table"><thead><tr><th>${t('dash.account')}</th><th>${t('coll.champs')}</th><th>${t('coll.skins')}</th><th>${t('coll.champShards')}</th><th>${t('coll.skinShards')}</th><th>${t('p.be')}</th><th>${t('coll.asOf')}</th></tr></thead><tbody>
      ${sorted.map(a => {
        const c = by.get(a.puuid);
        if (!c) return `<tr class="unread" data-cacc="${esc(a.puuid)}"><td><span class="dash-name">${esc(dispName(a))}</span></td><td colspan="6" class="muted">${t('coll.notRead')}</td></tr>`;
        const e = collEntries(c);
        const cnt = k => e.filter(x => x.k === k).reduce((n, x) => n + (x.n || 1), 0);
        const be = a.profile && a.profile.be;
        return `<tr data-cacc="${esc(a.puuid)}"><td><span class="dash-name">${esc(dispName(a))}</span></td>
          <td>${cnt('champ')}</td><td>${cnt('skin')}</td><td>${cnt('champShard')}</td><td>${cnt('skinShard')}</td>
          <td>${be == null || hides('wallet') ? '–' : num(be)}</td><td class="muted">${esc(fmtDate(c.at))}</td></tr>`;
      }).join('')}</tbody></table>`;
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

$('collSearch').addEventListener('input', () => { coll.q = $('collSearch').value; renderColl(); });
$('collRead').onclick = async () => {
  coll.reading = true;
  renderCollBar();
  const r = await api.readCollection();
  coll.reading = false;
  if (r && r.ok) { toast(t('coll.readDone')); await loadColl(); }
  else toast(t(r && r.closed ? 'coll.readClosed' : 'refresh.busy'), true);
  renderCollBar();
};
$('viewColl').addEventListener('click', e => {
  const k = e.target.closest('[data-ck]');
  if (k) { coll.kind = k.dataset.ck; return renderColl(); }
  const a = e.target.closest('[data-cacc]');
  if (a) openProfile(a.dataset.cacc);
});
