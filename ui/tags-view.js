// Overview → Tags: every tag of tag-rules.js for one account or all of them together, on their
// ranked games of this season. On top "Your strengths" and "To work on", below the met tags by
// group; at the end "All possible tags" (folded): every tag – met, not met, too little data, not for
// this role (the Live-only ones are left out) – with what it measures, the own value and the
// thresholds on hover. A click on a tag shows the numbers behind it. Engine: tags.js. Uses the globals of renderer.js / views.js.

// mode: 'sr' (ranked, Summoner's Rift) | 'aram' | '' = the one with more games this season
const tagv = { role: '', mode: '', games: null, mast: null, loading: false, open: '' };

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
const tagPrevKey = () => `rs.tagPrev.${ovChosen().map(a => a.puuid.slice(0, 8)).sort().join('+') || 'none'}.${tagv.aram ? 'aram' : tagv.role || 'main'}`;
function tagPrev() { try { return new Set(JSON.parse(localStorage.getItem(tagPrevKey()) || '[]')); } catch { return new Set(); } }
function tagKeep(results) { try { localStorage.setItem(tagPrevKey(), JSON.stringify([...Tags.keys(results)])); } catch { /* private mode: no memory */ } }

// ---------- texts ----------
const tagChampName = id => (champById(id) || {}).name || '#' + id;
// a rule of either catalogue (Summoner's Rift, ARAM)
const tagRule = id => TagRules.TAG_RULES.find(r => r.id === id) || (TagRules.ARAM_RULES || []).find(r => r.id === id) || {};
function tagName(x) {
  const lv = x.level === 'master' ? 'great' : x.level;
  const key = x.id === 'mastery' ? `tag.mastery.${x.level}` : lv ? `tag.${x.id}.${lv}` : `tag.${x.id}`;
  return t(key, { champ: x.champ ? tagChampName(x.champ) : '' }) + (x.level === 'master' ? ' ★' : '');
}
// "All roles": which role a tag is about, and that role's share of the games
const tagRoleIcon = x => (x.role ? `<img class="tc-role" src="${posIcon(x.role)}" alt="">` : '');
const tagRoleText = x => (x.role ? t('tags.inRole', { role: t('pos.' + x.role), pct: Math.round(x.roleShare * 100) }) : '');
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

// a tag's name when it has no level: the first level's name ("Great farmer", "Gets caught")
function tagBaseName(r) {
  if (r.id === 'mastery') return t('dash.tabMast');
  const lv = r.type === 'metric' ? (r.levels.great != null ? '.great' : '.weak') : '';
  return t(`tag.${r.id}${lv}`, { champ: '…' });
}
// pre: 'all|' for the chips of "All possible tags" (their own open detail); title: the hover text
function tagChip(x, i, pre = '', title = null) {
  const key = `${pre}${x.id}:${x.champ || ''}:${i}`;
  if (x.state === 'met') return `<button class="tchip tc-${tagColor(x)}${tagv.open === key ? ' on' : ''}" data-tag="${esc(key)}" title="${esc(title || [tagText(x), tagRoleText(x)].filter(Boolean).join('\n'))}">${tagRoleIcon(x)}${esc(tagName(x))}</button>`;
  const why = x.state === 'few' ? (x.unread ? t('tags.unread') : t('tags.few', { n: x.n, need: x.need })) : t('tags.not');
  return `<button class="tchip tc-${x.state}${tagv.open === key ? ' on' : ''}" data-tag="${esc(key)}" title="${esc(title || why)}">${tagRoleIcon(x)}${esc(tagBaseName(tagRule(x.id)))}${x.state === 'few' && !x.unread ? ` <i>${x.n}/${x.need}</i>` : ''}</button>`;
}
// which way a threshold goes
const tagSense = r => (r.type === 'poolTop' || r.minShare != null ? '>'
  : r.below != null || r.type === 'level' ? '<' : r.type === 'roleSpread' ? '≤' : '≥');
// what a tag measures and what its value means ('tag.<id>.d')
const tagDesc = id => t(`tag.${id}.d`);
// the hover text in "All possible tags": what it measures, met or why not, the own value, the
// thresholds of the role and where they come from, the games
function tagWhy(x, role) {
  const r = tagRule(x.id), lines = [tagDesc(x.id), ''];
  if (x.state === 'met') lines.push(tagText(x));
  else if (x.state === 'few') lines.push(x.unread ? t('tags.unread') : t('tags.few', { n: x.n, need: x.need }));
  else lines.push(t('tags.not'));
  if (x.state !== 'few' && x.value != null && x.id !== 'mastery') lines.push(t('tags.yours', { v: tagFmt(x, x.value) }));
  if (r.type === 'metric') {
    const lv = (role && r[role]) || r.levels;
    const good = r.dir > 0 ? '≥' : '≤', bad = r.dir > 0 ? '≤' : '≥';
    lines.push((role ? t('tags.thFor', { role: t('pos.' + role) }) : t('tags.th')) + ': ' + ['master', 'great', 'weak', 'terrible'].filter(k => lv[k] != null)
      .map(k => `${t('tags.lv.' + k)} ${k === 'master' || k === 'great' ? good : bad} ${tagFmt(x, lv[k])}`).join(' · '));
    lines.push(t('tags.thHow'));
  } else if (x.th != null && x.state !== 'few') lines.push(t('tags.needs', { th: `${tagSense(r)} ${tagFmt(x, x.th)}` }));
  if (x.n != null && x.state !== 'few' && x.id !== 'mastery') lines.push(`${t('perf.games')}: ${num(x.n)}`);
  return lines.join('\n');
}
// every tag of the catalogue, by group (folded; the state is remembered)
const TAG_ALL_KEY = 'rs.tagsAll';
const tagAllOpen = () => { try { return localStorage.getItem(TAG_ALL_KEY) === '1'; } catch { return false; } };
function tagAllHtml(list, role, openX, aram = false) {
  // the Live-only tags are about the game being played – nothing to show here
  const rules = (aram ? TagRules.ARAM_RULES || [] : TagRules.TAG_RULES).filter(r => !r.off && !r.live);
  const metN = new Set(list.filter(({ x }) => x.state === 'met').map(({ x }) => x.id)).size;
  const head = `<button class="tag-all-h" data-tagall>${tagAllOpen() ? '▾' : '▸'} ${esc(t('tags.all'))} <small>${esc(t('tags.allSub', { met: metN, total: rules.length }))}</small></button>`;
  if (!tagAllOpen()) return `<div class="tag-group tag-all">${head}</div>`;
  const body = (aram && Tags.ARAM_GROUPS ? Tags.ARAM_GROUPS : Tags.GROUPS).map(g => {
    const chips = rules.filter(r => r.group === g).map(r => {
      const mine = list.filter(({ x }) => x.id === r.id);
      if (mine.length) return mine.map(({ x, i }) => tagChip(x, i, 'all|', tagWhy(x, x.role || role))).join('');
      // nothing came out: not judged for this role, or no data at all
      const why = r.roles && role && !r.roles.includes(role) ? t('tags.notRole', { role: t('pos.' + role) }) : t('tags.noData');
      return `<span class="tchip tc-na" title="${esc(`${tagDesc(r.id)}\n\n${why}`)}">${esc(tagBaseName(r))}</span>`;
    }).join('');
    const det = openX && openX.all && openX.x.group === g ? tagDetail(openX.x) : '';
    return `<div class="tag-sub"><span class="d-sec-t">${t('tags.g.' + g)}</span><div class="tchips">${chips}</div>${det}</div>`;
  }).join('');
  return `<div class="tag-group tag-all">${head}${body}</div>`;
}
// the numbers behind one tag
function tagDetail(x) {
  const cells = [];
  if (x.state === 'met') cells.push(`<b>${esc(tagText(x))}</b>`);
  if (x.role) cells.push(esc(tagRoleText(x)));
  else cells.push(`<b>${esc(x.state === 'few' ? (x.unread ? t('tags.unread') : t('tags.few', { n: x.n, need: x.need })) : t('tags.not'))}</b>`);
  if (x.value != null && x.th != null) cells.push(`${t('tags.value')}: ${esc(tagFmt(x, x.value))}`, `${t('tags.th')}: ${esc(tagFmt(x, x.th))}`);
  if (x.n != null && x.id !== 'mastery') cells.push(`${t('perf.games')}: ${num(x.n)}`);
  if (tagPeriod(x)) cells.push(esc(tagPeriod(x)));
  return `<div class="tdetail"><p class="tdesc">${esc(tagDesc(x.id))}</p>${cells.join('<span>·</span>')}</div>`;
}

// ---------- rendering ----------
function renderTagsView() {
  const el = $('tagBody');
  if (!el || $('dashTags').hidden) return;
  const accs = ovChosen();
  $('tagRole').innerHTML = `<button data-trole=""${!tagv.role ? ' class="on"' : ''}>${t('tags.mainRole')}</button>` +
    `<button data-trole="all"${tagv.role === 'all' ? ' class="on"' : ''}>${t('tags.allRoles')}</button>` +
    Stats.POSITIONS.map(r => `<button data-trole="${r}" title="${esc(t('pos.' + r))}"${tagv.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('');
  if (!tagv.games) { $('tagSub').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const own = accs.map(a => a.puuid);
  // Summoner's Rift (ranked) or ARAM: an ARAM player starts on ARAM
  const rows = Stats.byParticipation(tagv.games).filter(x => own.includes(x.p.puuid));
  const nSr = sumScopeRows(rows, 'ranked').length, nAram = sumScopeRows(rows, 'aram').length;
  tagv.aram = (tagv.mode || (nAram > nSr ? 'aram' : 'sr')) === 'aram';
  $('tagMode').innerHTML = [['sr', t('tags.modeSr'), nSr], ['aram', 'ARAM', nAram]]
    .map(([k, l, n]) => `<button data-tmode="${k}"${(k === 'aram') === tagv.aram ? ' class="on"' : ''}>${esc(l)} <small>${num(n)}</small></button>`).join('');
  $('tagRole').hidden = tagv.aram;
  if (tagv.aram) {
    const res = Tags.evaluateAram({ games: tagv.games, own, prev: tagPrev() });
    tagKeep(res.results);
    tagv.res = res.results;
    if (!res.n) { $('tagSub').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('ov.noAramTraits')}</div>`; return; }
    $('tagSub').textContent = t('tags.subAram', { n: num(res.n) });
    el.innerHTML = tagsBodyHtml(res, null);
    return;
  }
  const read = (tagv.mast || []).filter(m => own.includes(m.puuid));
  const acc = accs.length === 1 ? accs[0] : null;
  const ctx = { games: tagv.games, own, role: tagv.role && tagv.role !== 'all' ? tagv.role : null, prev: tagPrev(),
    level: acc && acc.level != null ? acc.level : null, mastery: read.length ? MastMath.masteryTable(read) : null };
  const res = tagv.role === 'all' ? Tags.evaluateAll(ctx) : Tags.evaluate(ctx);
  tagKeep(res.results);
  tagv.res = res.results;
  const seasonN = res.results.find(x => x.id === 'otp');
  const n = seasonN ? (seasonN.n || 0) : 0;
  if (!n && !res.results.some(x => x.state === 'met')) { $('tagSub').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('tags.none')}</div>`; return; }
  const roleTxt = res.all ? res.roles.map(r => `${t('pos.' + r.role)} ${Math.round(r.share * 100)} %`).join(' · ')
    : !res.role ? '' : tagv.role ? t('pos.' + res.role) : res.main ? t('tags.roleMain', { role: t('pos.' + res.role) }) : t('tags.roleMost', { role: t('pos.' + res.role) });
  $('tagSub').textContent = [t('tags.sub', { n: num(n) }), roleTxt].filter(Boolean).join(' · ');

  el.innerHTML = tagsBodyHtml(res, res.role);
}
// the page of one evaluation (the Overview's tab, the player page's): strengths and things to work
// on, the met tags by group, "All possible tags"; res.aram: the ARAM catalogue and its texts
function tagsBodyHtml(res, role) {
  const list = res.results.map((x, i) => ({ x, i }));
  const chips = f => list.filter(({ x }) => f(x)).map(({ x, i }) => tagChip(x, i)).join('');
  const strong = chips(Tags.isStrength), weak = chips(Tags.isWeakness);
  const openKey = tagv.open.replace(/^all\|/, '');
  const found = list.find(({ x, i }) => `${x.id}:${x.champ || ''}:${i}` === openKey);
  const openX = found && { ...found, all: tagv.open.startsWith('all|') };
  const top = `<div class="tag-top">
      <div><span class="d-sec-t">${t('tags.strengths')}</span><div class="tchips">${strong || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
      <div><span class="d-sec-t">${t('tags.work')}</span><div class="tchips">${weak || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
    </div>`;
  const groups = tagGroupsOf(res).map(g => {
    // only the met ones here; everything else is in "All possible tags"
    const inG = list.filter(({ x }) => x.group === g && x.state === 'met');
    if (!inG.length) return '';
    const det = openX && !openX.all && openX.x.group === g ? tagDetail(openX.x) : '';
    return `<div class="tag-group"><span class="d-sec-t">${t('tags.g.' + g)}</span><div class="tchips">${inG.map(({ x, i }) => tagChip(x, i)).join('')}</div>${det}</div>`;
  }).join('');
  return `${top}${groups}${tagAllHtml(list, role, openX, res.aram)}<p class="coll-foot">${t(res.aram ? 'tags.basisAram' : 'tags.basis')}</p>`;
}
// the groups of a catalogue, in their order
const tagGroupsOf = res => (res.aram && Tags.ARAM_GROUPS ? Tags.ARAM_GROUPS : Tags.GROUPS);

$('dashTags').addEventListener('click', e => {
  const r = e.target.closest('[data-trole]');
  if (r) { tagv.role = r.dataset.trole; tagv.open = ''; return renderTagsView(); }
  const m = e.target.closest('[data-tmode]');
  if (m) { tagv.mode = m.dataset.tmode; tagv.open = ''; return renderTagsView(); }
  if (e.target.closest('[data-tagall]')) {
    try { localStorage.setItem(TAG_ALL_KEY, tagAllOpen() ? '0' : '1'); } catch { /* private mode: stays as it is */ }
    return renderTagsView();
  }
  const c = e.target.closest('[data-tag]');
  if (c) { tagv.open = tagv.open === c.dataset.tag ? '' : c.dataset.tag; renderTagsView(); }
});
