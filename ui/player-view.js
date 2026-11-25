// The player page: an Overview for any player – a click on a name in the match history, on Live or
// after a game opens it. Their games: the 200 newest from their match list (each with their own
// numbers) and the details of the newest 50 ranked ones (main.rs: the player page's loading, the
// store of other players' games), plus every own stored game they were in. On it: rank, key
// figures, roles, champions, traits, the recent games, the games with you – and "Open with".
// Uses the globals of renderer.js / views.js / matches-view.js / tags-view.js / scout-view.js.

const plv = { p: null, games: new Map(), ids: [], info: null, mastery: null, progress: null, queue: 'ranked', timer: 0, loading: false };

// open a player: { puuid, gameName, tagLine, region }; back: from the arrows (no new history step)
function openPlayer(p, back = false) {
  if (!p || !p.puuid) return;
  if (!plv.p || plv.p.puuid !== p.puuid) {
    Object.assign(plv, { p, ids: [], info: null, mastery: null, progress: null, queue: 'ranked' });
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
  if (view === 'player') renderPlayer();
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
      <img src="${champIcon(c)}" alt=""><b>${esc((champById(c) || {}).name || '#' + c)}</b>
      <span>${t('pl.gamesN', { n: a.n })}</span><span class="${a.winrate >= 0.55 ? 'good' : a.winrate <= 0.45 ? 'bad' : ''}">${pct(a.winrate)}</span>
      <span>${a.perfect ? t('perf.perfect') : a.kda.toFixed(2) + ' KDA'}</span><small>${mast[c] ? t('pl.points', { n: num(Number(mast[c])) }) : ''}</small></div>`).join('');

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

  el.innerHTML = `<div class="pl-bar">${seg}<span class="coll-for">${esc(t('pl.basis', { n: num(all.length) }))}</span></div>
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
  if (q && !q.disabled) { plv.queue = q.dataset.plq; renderPlayer(); }
});
