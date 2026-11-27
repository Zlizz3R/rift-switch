// The player page: an Overview for any player – a click on a name in the match history, on Live or
// after a game opens it. Their games: the 200 newest from their match list (each with their own
// numbers) and the details of the newest 50 ranked ones (main.rs: the player page's loading, the
// store of other players' games), plus every own stored game they were in. The Overview's tabs
// (Performance, Traits, Mastery, Match history, Seasons – no LP history: there is none for another
// player), drawn with the same code from their games – and "Open with".
// Uses the globals of renderer.js / views.js / matches-view.js / tags-view.js / scout-view.js.

// tab: one of PL_TABS; role: '' or a position (Performance, Traits); queue: 'ranked' | 'aram' |
// 'arena' | 'all', '' = the one with the most games; show: rows of the match list; withYou: only
// the games with one of your accounts
const plv = { p: null, games: new Map(), ids: [], info: null, mastery: null, progress: null, queue: '', tab: 'stats', role: '', show: 40, withYou: false, timer: 0, loading: false };
const PL_TABS = [['stats', 'dash.tabStats'], ['tags', 'dash.tabTags'], ['mast', 'dash.tabMast'], ['matches', 'mh.title'], ['seasons', 'dash.tabSeasons']];

// open a player: { puuid, gameName, tagLine, region }; back: from the arrows (no new history step)
function openPlayer(p, back = false) {
  if (!p || !p.puuid) return;
  if (!plv.p || plv.p.puuid !== p.puuid) {
    Object.assign(plv, { p, ids: [], info: null, mastery: null, progress: null, queue: '', role: '', show: 40, withYou: false });
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
    const noAssets = !assets || !Object.keys(assets.items || {}).length;
    const [d, own, ch, as] = await Promise.all([api.playerGames(p.puuid, have), scv.own ? null : allGames(), champs.length ? null : api.champions(), noAssets ? api.matchesAssets() : null]);
    if (own) scv.own = own;
    if (as) assets = as;
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

// why the player's games don't come (yet): League closed, or Live goes first (champion select, a
// game) – null while they can come. Only while something is still missing (the list or details).
function plHalt(own) {
  if (own) return null;
  const pr = plv.progress, live = S.live || {};
  if (pr && pr.listed && pr.done >= pr.total) return null;
  if (!live.clientUp) return 'pl.noClient';
  return LIVE_GAME_PHASES.includes(live.phase) ? 'pl.waitGame' : null;
}
// League opened or closed, a game started or ended: the page says so (and asks again)
let plLive = '';
api.onState(() => {
  const up = !!(S.live && S.live.clientUp);
  const now = `${up}:${(S.live && S.live.phase) || ''}`;
  if (now === plLive) return;
  const wasUp = plLive.startsWith('true');
  plLive = now;
  if (view !== 'player' || !plv.p) return;
  renderPlayer();
  if (up && !wasUp) loadPlayer();
});

// another player's traits: only what speaks for them or is neutral (Riot's policies: no shaming)
const plOthers = res => ({ ...res, results: Tags.forOthers(res.results), others: true });

const plSiteOf = () => ({ gameName: (plv.info && plv.info.gameName) || plv.p.gameName, tagLine: (plv.info && plv.info.tagLine) || plv.p.tagLine, region: plv.p.region || (S.live && S.live.region) || 'EUW' });

function renderPlayer() {
  const el = $('plBody');
  if (!el || !plv.p) return;
  const p = plv.p, info = plv.info || {};
  const site = plSiteOf();
  const own = (S.accounts || []).some(a => a.puuid === p.puuid);
  // the head: icon, Riot ID, level, ranks, open with, the loading
  const pr = plv.progress;
  const halt = plHalt(own);
  let load = '';
  if (halt) load = `<div class="pl-note${halt === 'pl.noClient' ? ' warn' : ''}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg><span>${esc(t(halt))}</span></div>`;
  else if (!own && pr) {
    const txt = !pr.listed ? t('pl.reading') : pr.done < pr.total ? t('scout.games', { done: pr.done, total: pr.total }) : '';
    const pct = !pr.listed ? 5 : pr.total ? Math.round((100 * pr.done) / pr.total) : 100;
    if (txt) load = `<div class="sc-prog pl-prog"><span>${esc(txt)}</span><b>${pct} %</b><span class="bar"><i style="width:${pct}%"></i></span></div>`;
  }
  const all = plGames();
  const rowsAll = Stats.byParticipation(all, [p.puuid]);
  // the chosen scope – none chosen (or one without games): the one with the most games
  const scope = plv.queue && (plv.queue === 'all' || sumScopeRows(rowsAll, plv.queue).length) ? plv.queue : sumAutoScope(rowsAll);
  const scoped = sumScopeRows(rowsAll, scope);
  const sub = [info.level ? t('scout.level', { n: info.level }) : '', site.region || '', own ? t('pl.own') : ''].filter(Boolean).map(esc).join(' · ');
  $('plHead').innerHTML = sumWho({ icons: info.iconId != null ? [info.iconId] : [], name: site.gameName || '?', tag: site.tagLine, sub,
    ranks: sumRank('Solo/Duo', info.solo) + sumRank('Flex', info.flex) })
    + `<div class="pl-open"><span class="p-open">${t('p.openWith')}</span>${site.gameName ? SITES.map(([k, n]) => `<button class="chip" data-plsite="${k}">${n}</button>`).join('') : ''}</div>${load}`;
  sumArt($('plArt'), sumTopChamp(scoped.length ? scoped : rowsAll));
  $('plTabs').innerHTML = PL_TABS.map(([k, l]) => `<button data-pltab="${k}"${plv.tab === k ? ' class="on"' : ''}>${t(l)}</button>`).join('');

  if (!all.length) {
    el.innerHTML = `<div class="ov-empty"><b>${esc(t('ov.emptyT'))}</b><p>${esc(t(halt || (pr && !pr.listed && !own ? 'pl.wait' : 'pl.none')))}</p></div>`;
    return;
  }
  const rows = PerfMath.lastGames(scoped, perf.f.last);
  const basis = `<span class="coll-for">${esc(t('pl.basis', { n: num(all.length) }))}</span>`;
  const bar = sumBarHtml(rowsAll, scope, 'data-plq');
  const mastRows = plv.mastery && Object.keys(plv.mastery).length ? Object.entries(plv.mastery).map(([id, v]) => ({ id: +id, total: +v, n: 1 })).sort((a, b) => b.total - a.total) : null;
  const level = info.level != null ? info.level : null;
  const roleSeg = `<div class="seg perf-roles">` + `<button data-plrole=""${!plv.role ? ' class="on"' : ''}>${t(plv.tab === 'tags' ? 'tags.allRoles' : 'perf.allRoles')}</button>` +
    Stats.POSITIONS.map(r => `<button data-plrole="${r}" title="${esc(t('pos.' + r))}"${plv.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('') + '</div>';
  // the traits of the scope (another player: only what speaks for them)
  const traitsOf = role => {
    const ctx = { games: all, own: [p.puuid], level, mastery: mastRows, now: Date.now() };
    const res = scope === 'aram' || scope === 'arena' ? sumRes(all, [p.puuid], level, mastRows, scope) : role ? Tags.evaluate({ ...ctx, role }) : Tags.evaluateAll(ctx);
    return res && !own ? plOthers(res) : res;
  };
  let body, head = `${bar}${basis}`;
  if (plv.tab === 'tags') {
    const res = traitsOf(plv.role);
    body = res ? tagsBodyHtml(res, scope === 'aram' ? null : res.role) : `<div class="chart-empty">${t(scope === 'arena' ? 'ov.noArenaTraits' : 'ov.noAramTraits')}</div>`;
    head = `${bar}${scope === 'aram' || scope === 'arena' ? '' : roleSeg}${basis}`;
  } else if (plv.tab === 'mast') {
    body = mastPlayerHtml(mastRows, p.puuid, all);
    head = basis;
  } else if (plv.tab === 'matches') {
    body = plMatchesHtml(rows, own);
  } else if (plv.tab === 'seasons') {
    const ranked = rowsAll.filter(x => Stats.RANKED_QUEUES.includes(x.g.q));
    body = ssAccHtml({ puuid: p.puuid, solo: info.solo, flex: info.flex }, ranked, false) + `<p class="coll-foot">${t('pl.seasonsNote')}</p>`;
    head = basis;
  } else {
    // Performance: the same page as the own Overview's, for a role to look at
    const parts = plv.role ? rows.filter(x => PerfMath.roleOf(x) === plv.role) : rows;
    const agR = Stats.aggregate(parts);
    body = !agR ? `<div class="chart-empty">${t('mh.noMatch')}</div>`
      : perfAllHtml(parts, agR, { player: true, role: plv.role, traits: { res: traitsOf(''), scope, player: true, role: plv.role } });
    head = `${bar}${roleSeg}${basis}`;
  }
  el.innerHTML = `<div class="pl-bar">${head}</div><div class="pl-tabbody">${body}</div>`;
  if (plv.tab === 'matches') loadRanks(plv.shown || []);
}

// the player's match history: the games with you on top (a filter), what the list shows, the games
// as in the own match history – a click unfolds one (all ten players when its details are stored)
function plMatchesHtml(rows, own) {
  const p = plv.p;
  const ownIds = (S.accounts || []).filter(a => !a.placeholder).map(a => a.puuid);
  const m = own ? null : Insights.meetings(scv.own || [], ownIds, p.puuid, null);
  const seen = new Set(), games = [];
  for (const x of [...rows].sort((a, b) => b.g.t - a.g.t)) {
    if (seen.has(String(x.g.id))) continue;
    seen.add(String(x.g.id));
    games.push(x.g);
  }
  const mineIds = new Set(ownIds);
  const withYou = g => g.players.some(x => x.puuid !== p.puuid && mineIds.has(x.puuid));
  const list = plv.withYou ? games.filter(withYou) : games;
  const met = m ? `<div class="pl-with"><b>${esc(t('pl.withYou'))}</b><span>${esc(t('know.total', { n: m.n, e: m.against.n, ew: m.against.w, el: m.against.n - m.against.w, tm: m.same.n, tw: m.same.w }))}</span>
      <div class="seg"><button data-plwith=""${plv.withYou ? '' : ' class="on"'}>${esc(t('pl.all'))}</button><button data-plwith="1"${plv.withYou ? ' class="on"' : ''}>${esc(t('pl.withYou'))} <small>${games.filter(withYou).length}</small></button></div></div>`
    : `<p class="pl-with muted">${esc(t(own ? 'pl.own' : 'pl.never'))}</p>`;
  if (!list.length) return `${met}<div class="mh-empty">${t('mh.noMatch')}</div>`;
  const shown = list.slice(0, plv.show);
  plv.shown = shown;
  const more = list.length > shown.length ? `<div class="mh-more"><button class="btn" data-plmore>${t('mh.showMore', { n: Math.min(40, list.length - shown.length) })}</button>`
    + `<button class="btn" data-plall>${t('mh.showAll', { n: num(list.length) })}</button></div>` : '';
  return `${met}${summaryHtml(list, { player: true })}<div class="pl-mh">${shown.map(g => gameRow(g, assets || {})).join('')}</div>${more}`;
}

$('viewPlayer').addEventListener('change', e => {
  if (e.target.matches('[data-pllast]')) {
    perf.lastOwn = e.target.value === 'own';
    if (!perf.lastOwn) perfSetLast(Number(e.target.value));
    renderPlayer();
    if (perf.lastOwn) { const n = $('plBody').querySelector('[data-pllastn]'); if (n) { n.focus(); n.select(); } }
  } else if (e.target.matches('[data-pllastn]')) { perfSetLast(Number(e.target.value)); renderPlayer(); }
});
$('viewPlayer').addEventListener('click', e => {
  const s = e.target.closest('[data-plsite]');
  if (s) return openSite(plSiteOf(), s.dataset.plsite);
  const q = e.target.closest('[data-plq]');
  if (q && !q.disabled) { plv.queue = q.dataset.plq; return renderPlayer(); }
  const tb = e.target.closest('[data-pltab]');
  if (tb) { plv.tab = tb.dataset.pltab; return renderPlayer(); }
  // the match list: more rows, only the games with you, a game unfolded, a record's game
  if (e.target.closest('[data-plmore]')) { plv.show += 40; return renderPlayer(); }
  if (e.target.closest('[data-plall]')) { plv.show = Infinity; return renderPlayer(); }
  const wy = e.target.closest('[data-plwith]');
  if (wy) { plv.withYou = !!wy.dataset.plwith; plv.show = 40; return renderPlayer(); }
  if (e.target.closest('[data-mast-all]')) { mast.all = true; return renderPlayer(); }
  const rec = e.target.closest('#plBody [data-goto]');
  if (rec) {
    const find = () => document.querySelector(`#plBody .mh-row[data-gid="${CSS.escape(rec.dataset.goto)}"]`);
    if (!find()) { plv.show = Infinity; renderPlayer(); }
    const row = find();
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
    return;
  }
  // a game from their match list only (no details stored): nothing to unfold
  const mr = e.target.closest('#plBody .mh-row:not(.lite)');
  if (mr && !e.target.closest('[data-player], [data-pin], [data-goto], button, a, input, select, .mh-det')) {
    const id = mr.dataset.gid;
    if (mh.open.has(id)) mh.open.delete(id); else mh.open.add(id);
    return renderPlayer();
  }
  const go = e.target.closest('[data-ovgo]');
  if (go) {
    const sec = PERF_SECS.includes(go.dataset.ovgo) ? go.dataset.ovgo : '';
    plv.tab = sec ? 'stats' : go.dataset.ovgo;
    renderPlayer();
    const top = document.querySelector('main');
    if (top) top.scrollTop = 0;
    perfScrollTo(sec);
    return;
  }
  if (e.target.closest('#plMine')) return showView('dash');
  // the traits tab: "All possible traits" and the numbers behind one
  if (e.target.closest('[data-tagall]')) {
    try { localStorage.setItem(TAG_ALL_KEY, tagAllOpen() ? '0' : '1'); } catch { /* stays as it is */ }
    return renderPlayer();
  }
  const tg = e.target.closest('[data-tag]');
  if (tg) { tagv.open = tagv.open === tg.dataset.tag ? '' : tg.dataset.tag; return renderPlayer(); }
  const ro = e.target.closest('[data-plrole]');
  if (ro) { plv.role = ro.dataset.plrole; return renderPlayer(); }
  // the Overview's own controls inside the tabs (sorting, unfolding, more champions)
  const cs = e.target.closest('[data-csort]');
  if (cs) { perf.cSort = cs.dataset.csort; return renderPlayer(); }
  if (e.target.closest('[data-pall]')) { perf.all = !perf.all; return renderPlayer(); }
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
  toast(S.live && S.live.clientUp ? t('pl.notFound', { q }) : t('pl.searchNoClient'), true);
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      // the search lives in the Overview's head (and the player page's)
      if (view !== 'dash' && view !== 'player') showView('dash');
      inp.focus(); inp.select();
    }
  });
})();
