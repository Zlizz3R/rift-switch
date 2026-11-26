// The player page: an Overview for any player – a click on a name in the match history, on Live or
// after a game opens it. Their games: the 200 newest from their match list (each with their own
// numbers) and the details of the newest 50 ranked ones (main.rs: the player page's loading, the
// store of other players' games), plus every own stored game they were in. On it: rank, key
// figures, roles, champions, traits, the recent games, the games with you – and "Open with".
// Uses the globals of renderer.js / views.js / matches-view.js / tags-view.js / scout-view.js.

// tab: the page's view – 'overview' or one of the Overview's own (Performance, Champions, Play
// style, Map), drawn with the same code from this player's games; role: '' or a position (those tabs)
const plv = { p: null, games: new Map(), ids: [], info: null, mastery: null, progress: null, queue: 'ranked', tab: 'overview', role: '', timer: 0, loading: false };
const PL_TABS = [['overview', 'dash.title'], ['stats', 'dash.tabStats'], ['champs', 'dash.tabChamps'], ['style', 'dash.tabStyle'], ['map', 'dash.tabMap']];

// open a player: { puuid, gameName, tagLine, region }; back: from the arrows (no new history step)
function openPlayer(p, back = false) {
  if (!p || !p.puuid) return;
  if (!plv.p || plv.p.puuid !== p.puuid) {
    Object.assign(plv, { p, ids: [], info: null, mastery: null, progress: null, queue: 'ranked', role: '' });
    // the games of the last player stay only if this one was in them too (the next load says)
  }
  showView('player', { p, back });
  renderPlayer();
  loadPlayer();
}
async function loadPlayer() {
  const p = plv.p;
  if (!p || plv.loading) return;
  plv.loading = true;
  try {
    const have = [...plv.games.values()].map(g => g.k).filter(Boolean);
    const [d, own, ch] = await Promise.all([api.playerGames(p.puuid, have), scv.own ? null : allGames(), champs.length ? null : api.champions()]);
    if (own) scv.own = own;
    if (Array.isArray(ch) && ch.length) champs = ch;
    if (d && plv.p && plv.p.puuid === p.puuid) {
      for (const g of Array.isArray(d.games) ? d.games : []) if (g && g.id != null) plv.games.set(String(g.id), g);
      plv.ids = (d.ids || []).map(String);
      const keep = new Set(plv.ids);
      for (const id of plv.games.keys()) if (!keep.has(id)) plv.games.delete(id);
      if (d.info) plv.info = d.info;
      if (d.mastery) plv.mastery = d.mastery;
      plv.progress = d.progress || null;
    }
  } catch (e) { console.warn('player', e); }
  plv.loading = false;
  // not while minutes are dragged on the map's chart (the chart would be replaced under the mouse)
  if (view === 'player' && !mvDrag) renderPlayer();
  else if (view === 'player') setTimeout(() => { if (view === 'player' && !mvDrag) renderPlayer(); }, 600);
}
// more of this player's games stored: fetch again, at most every 2 s
api.onPlayerChanged(e => {
  if (!e || !plv.p || e.puuid !== plv.p.puuid) return;
  plv.progress = e.progress || plv.progress;
  if (view !== 'player') return;
  clearTimeout(plv.timer);
  plv.timer = setTimeout(loadPlayer, 2000);
});

// every known game of the player: own stored games first (all ten players), then theirs
function plGames() {
  const id = plv.p.puuid;
  const own = (scv.own || []).filter(g => g.players && g.players.some(x => x.puuid === id));
  const theirs = plv.ids.map(i => plv.games.get(i)).filter(Boolean);
  const seen = new Set(), out = [];
  for (const g of [...theirs.filter(g => !g.lite), ...own, ...theirs.filter(g => g.lite)]) {
    const k = String(g.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...g, owners: [id] });
  }
  return out.sort((a, b) => b.t - a.t);
}

const plSiteOf = () => ({ gameName: (plv.info && plv.info.gameName) || plv.p.gameName, tagLine: (plv.info && plv.info.tagLine) || plv.p.tagLine, region: plv.p.region || (S.live && S.live.region) || 'EUW' });

function renderPlayer() {
  const el = $('plBody');
  if (!el || !plv.p) return;
  const p = plv.p, info = plv.info || {};
  const site = plSiteOf();
  const own = (S.accounts || []).some(a => a.puuid === p.puuid);
  // the head: icon, Riot ID, level, ranks, open with, the loading
  const pr = plv.progress;
  let load = '';
  if (!own && pr) {
    const txt = !pr.listed ? t('pl.reading') : pr.done < pr.total ? t('scout.games', { done: pr.done, total: pr.total }) : '';
    const pct = !pr.listed ? 5 : pr.total ? Math.round((100 * pr.done) / pr.total) : 100;
    if (txt) load = `<div class="sc-prog pl-prog"><span>${esc(txt)}</span><b>${pct} %</b><span class="bar"><i style="width:${pct}%"></i></span></div>`;
  }
  $('plHead').innerHTML = `<div class="pl-id">
      ${info.iconId != null ? `<img class="pl-icon" src="${iconUrl(info.iconId)}" alt="">` : '<span class="pl-icon"></span>'}
      <div><h1>${esc(site.gameName || '?')}<small>${site.tagLine ? '#' + esc(site.tagLine) : ''}</small></h1>
      <p class="sub">${[info.level ? t('scout.level', { n: info.level }) : '', own ? t('pl.own') : ''].filter(Boolean).map(esc).join(' · ')}</p></div>
    </div>
    <div class="pl-ranks">${queueRank('Solo/Duo', info.solo)}${queueRank('Flex', info.flex)}</div>
    <div class="pl-open"><span class="p-open">${t('p.openWith')}</span>${site.gameName ? SITES.map(([k, n]) => `<button class="chip" data-plsite="${k}">${n}</button>`).join('') : ''}</div>
    ${load}`;

  const all = plGames();
  if (!all.length) {
    el.innerHTML = `<div class="live-card"><p class="fine">${t(pr && !pr.listed && !own ? 'pl.wait' : 'pl.none')}</p></div>`;
    return;
  }
  const season = new Date(new Date().getFullYear(), 0, 1).getTime();
  const rankedRows = Stats.byParticipation(all, [p.puuid]).filter(x => Stats.RANKED_QUEUES.includes(x.g.q) && x.g.t >= season);
  if (plv.queue === 'ranked' && !rankedRows.length) plv.queue = 'all';
  const rows = plv.queue === 'ranked' ? rankedRows : Stats.byParticipation(all, [p.puuid]);
  const ag = Stats.aggregate(rows);
  const pct = v => (v == null ? '–' : Math.round(v * 100) + ' %');
  const fig = (label, v, sub = '') => `<div class="pl-fig"><span>${esc(label)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const seg = `<div class="seg pl-q"><button data-plq="ranked"${plv.queue === 'ranked' ? ' class="on"' : ''}${rankedRows.length ? '' : ' disabled'}>${t('pl.ranked')}</button><button data-plq="all"${plv.queue === 'all' ? ' class="on"' : ''}>${t('pl.all')}</button></div>`;
  const tabs = `<div class="subtabs pl-tabs">${PL_TABS.map(([k, l]) => `<button data-pltab="${k}"${plv.tab === k ? ' class="on"' : ''}>${t(l)}</button>`).join('')}</div>`;
  const basis = `<span class="coll-for">${esc(t('pl.basis', { n: num(all.length) }))}</span>`;
  // the Overview's views for this player: the same code, their games, a role to look at
  if (plv.tab !== 'overview') {
    const roleSeg = `<div class="seg perf-roles">` + `<button data-plrole=""${!plv.role ? ' class="on"' : ''}>${t('perf.allRoles')}</button>` +
      Stats.POSITIONS.map(r => `<button data-plrole="${r}" title="${esc(t('pos.' + r))}"${plv.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('') + '</div>';
    const parts = plv.role ? rows.filter(x => PerfMath.roleOf(x) === plv.role) : rows;
    const agR = Stats.aggregate(parts);
    const body = !agR ? `<div class="chart-empty">${t('mh.noMatch')}</div>`
      : plv.tab === 'stats' ? perfStatsHtml(parts, agR, { player: true })
        : plv.tab === 'champs' ? perfChampsHtml(parts, agR, { player: true })
          : plv.tab === 'style' ? perfStyleHtml(parts, plv.role)
            : perfMapHtml(parts, { foot: false });
    el.innerHTML = `${tabs}<div class="pl-bar">${seg}${roleSeg}${basis}</div><div class="pl-tabbody">${body}</div>`;
    return;
  }
  const figures = ag ? `<div class="pl-figs">
      ${fig(t('perf.games'), num(ag.n), `${ag.wins} W / ${ag.losses} L`)}
      ${fig('Winrate', pct(ag.winrate))}
      ${fig('KDA', ag.perfect ? t('perf.perfect') : ag.kda.toFixed(2), `${ag.avg.k.toFixed(1)} / ${ag.avg.d.toFixed(1)} / ${ag.avg.a.toFixed(1)}`)}
      ${fig('CS/min', ag.csMin.toFixed(1))}
      ${fig(t('perf.dmgMin'), num(Math.round(ag.dmgMin)))}
      ${fig(t('perf.kp'), pct(ag.kp))}
    </div>` : '';

  // roles: share of the games on each position
  const mr = Tags.mainRole(rows);
  const roles = mr.total ? [...mr.shares].sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="pl-role"><img src="${posIcon(r)}" alt=""><span>${esc(t('pos.' + r))}</span>
      <span class="bar"><i style="width:${Math.round((100 * n) / mr.total)}%"></i></span><b>${Math.round((100 * n) / mr.total)} %</b></div>`).join('') : `<p class="fine">${t('pl.noRoles')}</p>`;

  // champions: the most played, with win rate, KDA and mastery
  const mast = plv.mastery || {};
  const champsRows = [...Stats.groupBy(rows, x => x.p.champ)].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([c, a]) => `<div class="pl-champ">
      <img src="${champIcon(c)}" alt=""><span class="pl-cn"><b title="${esc((champById(c) || {}).name || '')}">${esc((champById(c) || {}).name || '#' + c)}</b>${mast[c] ? `<small>${t('pl.points', { n: num(Number(mast[c])) })}</small>` : ''}</span>
      <span>${perfGames(a.n)}</span><span class="${a.winrate >= 0.55 ? 'good' : a.winrate <= 0.45 ? 'bad' : ''}">${pct(a.winrate)}</span>
      <span>${a.perfect ? t('perf.perfect') : a.kda.toFixed(2) + ' KDA'}</span></div>`).join('');

  // traits: this season's ranked games, every role (as on the Overview)
  const mastRows = Object.keys(mast).length ? Object.entries(mast).map(([id, v]) => ({ id: +id, total: +v, n: 1 })).sort((a, b) => b.total - a.total) : null;
  const res = Tags.evaluateAll({ games: all, own: [p.puuid], level: info.level != null ? info.level : null, mastery: mastRows, now: Date.now() });
  const picked = Tags.pick(res.results);
  const chip = x => `<span class="tchip tc-${tagColor(x)}" title="${esc([tagText(x), tagRoleText(x)].filter(Boolean).join('\n'))}">${tagRoleIcon(x)}${esc(tagName(x))}</span>`;
  const strong = picked.filter(Tags.isStrength), weak = picked.filter(Tags.isWeakness), rest = picked.filter(x => !Tags.isStrength(x) && !Tags.isWeakness(x));
  const traits = picked.length ? `<div class="tag-top">
      <div><span class="d-sec-t">${t('tags.strengths')}</span><div class="tchips">${strong.map(chip).join('') || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
      <div><span class="d-sec-t">${t('tags.work')}</span><div class="tchips">${weak.map(chip).join('') || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
    </div>${rest.length ? `<div class="tchips pl-rest">${rest.map(chip).join('')}</div>` : ''}` : `<p class="fine">${t('tags.none')}</p>`;

  // the recent games (all queues): champion, result, K/D/A, queue, when
  const recent = Stats.byParticipation(all.slice(0, 20), [p.puuid]).map(({ g, p: x }) => {
    const res2 = Stats.isRemake(g) ? 'remake' : x.win ? 'win' : 'loss';
    return `<div class="pl-game ${res2}"><img src="${champIcon(x.champ)}" alt=""><b>${t('mh.' + res2)}</b>
      <span>${x.k} / ${x.d} / ${x.a}</span><span>${esc(queueLabel(g))}</span><small>${esc(ago(g.t))}</small></div>`;
  }).join('');

  // the games with you
  const ownIds = (S.accounts || []).filter(a => !a.placeholder).map(a => a.puuid);
  const m = own ? null : Insights.meetings(scv.own || [], ownIds, p.puuid, null);
  const withYou = m ? `<p>${esc(t('know.total', { n: m.n, e: m.against.n, ew: m.against.w, el: m.against.n - m.against.w, tm: m.same.n, tw: m.same.w }))}</p>
      <p class="fine">${esc(t(m.last.same ? 'know.team' : 'know.enemy', { when: ago(m.last.g.t), champ: (champById(m.last.them.champ) || {}).name || '' }))}</p>`
    : `<p class="fine">${t(own ? 'pl.own' : 'pl.never')}</p>`;

  el.innerHTML = `${tabs}<div class="pl-bar">${seg}${basis}</div>
    <div class="pl-grid">
      <div class="live-card pl-card wide"><div class="lc-head"><h3>${t('pl.figures')}</h3></div>${figures}</div>
      <div class="live-card pl-card"><div class="lc-head"><h3>${t('perf.role')}</h3></div>${roles}</div>
      <div class="live-card pl-card"><div class="lc-head"><h3>${t('pl.withYou')}</h3></div>${withYou}</div>
      <div class="live-card pl-card wide"><div class="lc-head"><h3>${t('dash.tabTags')}</h3></div>${traits}</div>
      <div class="live-card pl-card"><div class="lc-head"><h3>${t('pl.champs')}</h3></div>${champsRows || `<p class="fine">${t('pl.none')}</p>`}</div>
      <div class="live-card pl-card"><div class="lc-head"><h3>${t('pl.recent')}</h3></div>${recent}</div>
    </div>`;
}

$('viewPlayer').addEventListener('click', e => {
  const s = e.target.closest('[data-plsite]');
  if (s) return openSite(plSiteOf(), s.dataset.plsite);
  const q = e.target.closest('[data-plq]');
  if (q && !q.disabled) { plv.queue = q.dataset.plq; return renderPlayer(); }
  const tb = e.target.closest('[data-pltab]');
  if (tb) { plv.tab = tb.dataset.pltab; return renderPlayer(); }
  const ro = e.target.closest('[data-plrole]');
  if (ro) { plv.role = ro.dataset.plrole; return renderPlayer(); }
  // the Overview's own controls inside the tabs (sorting, unfolding, more champions)
  const so = e.target.closest('[data-psort]');
  if (so) { const k = so.dataset.psort; perf.dir = perf.sort === k ? -perf.dir : -1; perf.sort = k; return renderPlayer(); }
  const cs = e.target.closest('[data-csort]');
  if (cs) { perf.cSort = cs.dataset.csort; return renderPlayer(); }
  if (e.target.closest('[data-pall]')) { perf.all = !perf.all; return renderPlayer(); }
  const fold = e.target.closest('[data-prow]');
  if (fold) { const k = fold.dataset.prow; if (perf.open.has(k)) perf.open.delete(k); else perf.open.add(k); return renderPlayer(); }
});

// ---------- the search in the title bar: any player by Riot ID ----------
// Suggestions from everyone in the own stored games (and the current Live game); Enter or a click
// opens the player page – a Riot ID nobody knows yet is looked up through the client (find-player).
const pls = { list: [], at: -1, busy: false };
// everyone known: puuid → { puuid, gameName, tagLine, n: games with you }
function plKnown() {
  const mine = new Set((S.accounts || []).map(a => a.puuid));
  const by = new Map();
  const add = (puuid, name, tag, n = 0) => {
    if (!puuid || !name || mine.has(puuid)) return;
    const x = by.get(puuid) || { puuid, gameName: name, tagLine: tag || '', n: 0 };
    x.n += n;
    by.set(puuid, x);
  };
  for (const g of scv.own || []) for (const p of g.players || []) add(p.puuid, p.name, p.tag, 1);
  const ig = S.live && S.live.inGame;
  for (const c of ig ? [...(ig.teamOne || []), ...(ig.teamTwo || [])] : []) add(c.puuid, c.gameName, c.tagLine);
  return [...by.values()];
}
const plNorm = x => String(x || '').toLowerCase().replace(/\s+/g, '');
function plSuggest(q) {
  const n = plNorm(q);
  if (!n) return [];
  const [qn, qt] = n.split('#');
  return plKnown()
    .map(x => {
      const name = plNorm(x.gameName), tag = plNorm(x.tagLine);
      if (qt != null && qt !== '' && !tag.startsWith(qt)) return null;
      const score = name === qn ? 0 : name.startsWith(qn) ? 1 : name.includes(qn) ? 2 : -1;
      return score < 0 ? null : { ...x, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || b.n - a.n || a.gameName.localeCompare(b.gameName))
    .slice(0, 8);
}
function plDrawSuggest() {
  const box = $('plSuggest'), q = $('plSearch').value.trim();
  if (!q) { box.hidden = true; return; }
  pls.list = plSuggest(q);
  const rows = pls.list.map((x, i) => `<button class="pl-sug${i === pls.at ? ' on' : ''}" data-plsug="${i}"><span>${esc(x.gameName)}</span><small>#${esc(x.tagLine)}</small>`
    + `<span class="n">${x.n ? esc(t('pl.searchWith', { n: x.n })) : ''}</span></button>`).join('');
  box.innerHTML = rows + `<div class="pl-sug-hint">${esc(t(pls.busy ? 'pl.searching' : 'pl.searchEnter'))}</div>`;
  box.hidden = false;
}
async function plGo() {
  const inp = $('plSearch'), q = inp.value.trim();
  const pick = pls.list[pls.at >= 0 ? pls.at : -1];
  // a suggestion chosen – or the only one that fits the typed name exactly
  const exact = pls.list.find(x => plNorm(x.gameName + (q.includes('#') ? '#' + x.tagLine : '')) === plNorm(q));
  const hit = pick || exact;
  if (hit) return plOpenFound(hit);
  if (!q || pls.busy) return;
  pls.busy = true;
  plDrawSuggest();
  let r = null;
  try { r = await api.findPlayer(q); } catch (e) { console.warn('find', e); }
  pls.busy = false;
  if (r && r.puuid) return plOpenFound(r);
  plDrawSuggest();
  toast(t('pl.notFound', { q }), true);
}
function plOpenFound(x) {
  const inp = $('plSearch');
  inp.value = '';
  inp.blur();
  $('plSuggest').hidden = true;
  pls.at = -1;
  openPlayer({ puuid: x.puuid, gameName: x.gameName, tagLine: x.tagLine, region: x.region });
}
(function plSearchInit() {
  const inp = $('plSearch');
  if (!inp) return;
  inp.addEventListener('focus', () => {
    // the own games for the suggestions (once)
    if (!scv.own) allGames().then(g => { if (g && !scv.own) scv.own = g; if (document.activeElement === inp) plDrawSuggest(); }).catch(() => {});
    plDrawSuggest();
  });
  inp.addEventListener('input', () => { pls.at = -1; plDrawSuggest(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = pls.list.length;
      if (n) pls.at = (pls.at + (e.key === 'ArrowDown' ? 1 : n - 1 + (pls.at < 0 ? 1 : 0))) % n;
      plDrawSuggest();
    } else if (e.key === 'Enter') { e.preventDefault(); plGo(); }
    else if (e.key === 'Escape') { inp.value = ''; inp.blur(); $('plSuggest').hidden = true; }
  });
  inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) $('plSuggest').hidden = true; }, 150));
  $('plSuggest').addEventListener('mousedown', e => {
    const b = e.target.closest('[data-plsug]');
    if (!b) return;
    e.preventDefault();
    plOpenFound(pls.list[Number(b.dataset.plsug)]);
  });
  // Ctrl+K: into the search
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); inp.focus(); inp.select(); }
  });
})();
