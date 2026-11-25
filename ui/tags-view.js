// Overview → Tags: every tag of tag-rules.js for one account or all of them together, on their
// ranked games of this season. On top "Your strengths" and "To work on", below every tag by group –
// met (in colour) or not enough data (dashed, with how many games are missing); tags that don't
// apply are left out. A click on
// a tag shows the numbers behind it. Engine: tags.js. Uses the globals of renderer.js / views.js.

const tagv = { role: '', games: null, mast: null, loading: false, open: '' };

async function loadTagsView() {
  if (tagv.loading) return;
  tagv.loading = true;
  try {
    const [g, m, ch] = await Promise.all([allGames(), api.masteries(), champs.length ? null : api.champions()]);
    tagv.games = g || [];
    tagv.mast = Array.isArray(m) ? m : [];
    if (Array.isArray(ch) && ch.length) champs = ch;
  } catch (e) { console.warn('tags', e); }
  tagv.loading = false;
  renderTagsView();
}
api.onMatchesChanged(() => { if (view === 'dash' && dashTab() === 'tags') loadTagsView(); });

// the last shown levels per account and role – a tag only goes 5 % past its threshold (tags.js)
const tagPrevKey = () => `rs.tagPrev.${ovChosen().map(a => a.puuid.slice(0, 8)).sort().join('+') || 'none'}.${tagv.role || 'main'}`;
function tagPrev() { try { return new Set(JSON.parse(localStorage.getItem(tagPrevKey()) || '[]')); } catch { return new Set(); } }
function tagKeep(results) { try { localStorage.setItem(tagPrevKey(), JSON.stringify([...Tags.keys(results)])); } catch { /* private mode: no memory */ } }

// ---------- texts ----------
const tagChampName = id => (champById(id) || {}).name || '#' + id;
const tagRule = id => TagRules.TAG_RULES.find(r => r.id === id) || {};
function tagName(x) {
  const lv = x.level === 'master' ? 'great' : x.level;
  const key = x.id === 'mastery' ? `tag.mastery.${x.level}` : lv ? `tag.${x.id}.${lv}` : `tag.${x.id}`;
  return t(key, { champ: x.champ ? tagChampName(x.champ) : '' }) + (x.level === 'master' ? ' ★' : '');
}
// a value as the tag's text shows it
function tagFmt(x, v) {
  const r = tagRule(x.id);
  if (v == null) return '–';
  if (r.pct) return Math.round(v * 100) + ' %';
  const s = v.toLocaleString(locale(), { maximumFractionDigits: r.dec == null ? 0 : r.dec, minimumFractionDigits: r.dec == null ? 0 : r.dec });
  return r.signed && v > 0 ? '+' + s : s;
}
function tagText(x) {
  const v = x.vars || {};
  if (x.id === 'mastery') return t(v.k > 1 ? 'tag.mastery.tk' : 'tag.mastery.t', { pts: num(v.pts), champ: tagChampName(x.champ), k: v.k });
  if (x.id === 'oneRole') return t('tag.oneRole.t', { pct: v.pct, n: v.n, role: t('pos.' + v.role) });
  if (x.id === 'generalist') return (v.list || []).map(([r, p]) => `${t('pos.' + r)} ${p} %`).join(', ');
  return t(`tag.${x.id}.t`, { ...v, v: tagFmt(x, v.v), n: v.n, champ: x.champ ? tagChampName(x.champ) : '' });
}
const TAG_COLOR = { master: 'master', great: 'good', weak: 'warn', terrible: 'bad', millionaire: 'info', veteran: 'info', expert: 'info' };
const tagColor = x => TAG_COLOR[x.level] || x.color || 'info';
const tagPeriod = x => (x.period === 'season' ? t('perf.season', { y: new Date().getFullYear() }) : x.period ? t('tags.p.' + x.period) : '');

function tagChip(x, i) {
  const key = `${x.id}:${x.champ || ''}:${i}`;
  if (x.state === 'met') return `<button class="tchip tc-${tagColor(x)}${tagv.open === key ? ' on' : ''}" data-tag="${esc(key)}" title="${esc(tagText(x))}">${esc(tagName(x))}</button>`;
  const name = x.id === 'mastery' ? t('dash.tabMast') : t(`tag.${x.id}${tagRule(x.id).type === 'metric' ? '.great' : ''}`, { champ: '…' });
  const why = x.state === 'few' ? (x.unread ? t('tags.unread') : t('tags.few', { n: x.n, need: x.need })) : t('tags.not');
  return `<button class="tchip tc-${x.state}${tagv.open === key ? ' on' : ''}" data-tag="${esc(key)}" title="${esc(why)}">${esc(name)}${x.state === 'few' && !x.unread ? ` <i>${x.n}/${x.need}</i>` : ''}</button>`;
}
// the numbers behind one tag
function tagDetail(x) {
  const cells = [];
  if (x.state === 'met') cells.push(`<b>${esc(tagText(x))}</b>`);
  else cells.push(`<b>${esc(x.state === 'few' ? (x.unread ? t('tags.unread') : t('tags.few', { n: x.n, need: x.need })) : t('tags.not'))}</b>`);
  if (x.value != null && x.th != null) cells.push(`${t('tags.value')}: ${esc(tagFmt(x, x.value))}`, `${t('tags.th')}: ${esc(tagFmt(x, x.th))}`);
  if (x.n != null && x.id !== 'mastery') cells.push(`${t('perf.games')}: ${num(x.n)}`);
  if (tagPeriod(x)) cells.push(esc(tagPeriod(x)));
  return `<div class="tdetail">${cells.join('<span>·</span>')}</div>`;
}

// ---------- rendering ----------
function renderTagsView() {
  const el = $('tagBody');
  if (!el || $('dashTags').hidden) return;
  const accs = ovChosen();
  $('tagRole').innerHTML = `<button data-trole=""${!tagv.role ? ' class="on"' : ''}>${t('tags.mainRole')}</button>` +
    Stats.POSITIONS.map(r => `<button data-trole="${r}" title="${esc(t('pos.' + r))}"${tagv.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('');
  if (!tagv.games) { $('tagSub').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const own = accs.map(a => a.puuid);
  const read = (tagv.mast || []).filter(m => own.includes(m.puuid));
  const acc = accs.length === 1 ? accs[0] : null;
  const res = Tags.evaluate({ games: tagv.games, own, role: tagv.role || null, prev: tagPrev(),
    level: acc && acc.level != null ? acc.level : null, mastery: read.length ? MastMath.masteryTable(read) : null });
  tagKeep(res.results);
  tagv.res = res.results;
  const seasonN = res.results.find(x => x.id === 'otp');
  const n = seasonN ? (seasonN.n || 0) : 0;
  if (!n && !res.results.some(x => x.state === 'met')) { $('tagSub').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('tags.none')}</div>`; return; }
  const roleTxt = !res.role ? '' : tagv.role ? t('pos.' + res.role) : res.main ? t('tags.roleMain', { role: t('pos.' + res.role) }) : t('tags.roleMost', { role: t('pos.' + res.role) });
  $('tagSub').textContent = [t('tags.sub', { n: num(n) }), roleTxt].filter(Boolean).join(' · ');

  const list = res.results.map((x, i) => ({ x, i }));
  const chips = f => list.filter(({ x }) => f(x)).map(({ x, i }) => tagChip(x, i)).join('');
  const strong = chips(Tags.isStrength), weak = chips(Tags.isWeakness);
  const openX = list.find(({ x, i }) => `${x.id}:${x.champ || ''}:${i}` === tagv.open);
  const top = `<div class="tag-top">
      <div><span class="d-sec-t">${t('tags.strengths')}</span><div class="tchips">${strong || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
      <div><span class="d-sec-t">${t('tags.work')}</span><div class="tchips">${weak || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
    </div>`;
  const groups = Tags.GROUPS.map(g => {
    const inG = list.filter(({ x }) => x.group === g && x.state !== 'not');
    if (!inG.length) return '';
    // met first, then too little data
    const order = { met: 0, few: 1 };
    const sorted = [...inG].sort((a, b) => order[a.x.state] - order[b.x.state]);
    const det = openX && openX.x.group === g ? tagDetail(openX.x) : '';
    return `<div class="tag-group"><span class="d-sec-t">${t('tags.g.' + g)}</span><div class="tchips">${sorted.map(({ x, i }) => tagChip(x, i)).join('')}</div>${det}</div>`;
  }).join('');
  el.innerHTML = `${top}${groups}<p class="coll-foot">${t('tags.basis')}</p>`;
}

$('dashTags').addEventListener('click', e => {
  const r = e.target.closest('[data-trole]');
  if (r) { tagv.role = r.dataset.trole; tagv.open = ''; return renderTagsView(); }
  const c = e.target.closest('[data-tag]');
  if (c) { tagv.open = tagv.open === c.dataset.tag ? '' : c.dataset.tag; renderTagsView(); }
});
