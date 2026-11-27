// The head above every Overview tab – the same for your own accounts and for any other player (the
// player page, player-view.js): who it is, the ranks, the splash art of the champion played most –
// plus the scope bar of the player page (Ranked / ARAM / Arena / All, the newest games) and the
// traits of a scope. Also every other page's head picture. Uses the globals of renderer.js /
// views.js / matches-view.js / dashboard.js / perf.js / ovfilter.js.

const sumv = { scope: '' };
const SUM_ARAM = [450, 2400];
const sumSeason = () => new Date(new Date().getFullYear(), 0, 1).getTime();

// ---------- which games ----------
// the participations of a scope: ranked or ARAM of this season, or every game
function sumScopeRows(rows, scope) {
  const from = sumSeason();
  if (scope === 'ranked') return rows.filter(x => Stats.RANKED_QUEUES.includes(x.g.q) && x.g.t >= from);
  if (scope === 'aram') return rows.filter(x => SUM_ARAM.includes(x.g.q) && x.g.t >= from);
  if (scope === 'arena') return rows.filter(x => Stats.isArena(x.g) && x.g.t >= from);
  return rows;
}
// the scope shown first: the one with the most games this season – ranked when it's a tie
// (an ARAM player sees ARAM, an Arena player Arena)
function sumAutoScope(rows) {
  const n = ['ranked', 'aram', 'arena'].map(k => [k, sumScopeRows(rows, k).length]);
  const best = n.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] ? best[0] : 'all';
}
// the bar under the head: Ranked / ARAM / All, how many of the newest games, where they come from
// attr: the data attribute of the scope buttons (own page: data-sumq, player page: data-plq)
function sumBarHtml(rows, scope, attr, basis = '') {
  const n = k => sumScopeRows(rows, k).length;
  const b = (k, label) => `<button ${attr}="${k}"${scope === k ? ' class="on"' : ''}${k !== 'all' && !n(k) ? ' disabled' : ''}>${esc(label)}${k !== 'all' ? ` <small>${num(n(k))}</small>` : ''}</button>`;
  const lastOwn = perfLastIsOwn(perf.f.last, perf.lastOwn);
  const last = `<select class="pl-last" data-pllast title="${esc(t('perf.lastT'))}">${perfLastOpts(perf.f.last, perf.lastOwn)}</select>`
    + (lastOwn ? `<input class="mh-input num" data-pllastn type="number" min="1" max="9999" placeholder="${esc(t('perf.lastPh'))}" value="${perf.f.last || ''}">` : '');
  return `<div class="seg pl-q">${b('ranked', t('pl.ranked'))}${b('aram', t('ov.scopeAram'))}${b('arena', t('ov.scopeArena'))}${b('all', t('pl.all'))}</div>${last}${basis}`;
}

// ---------- the head ----------
// the splash art of a champion's base skin (CommunityDragon): uncentered, else centered, else none
const sumArtUrl = (alias, kind) => `${CDRAGON}/rcp-be-lol-game-data/global/default/assets/characters/${alias}/skins/base/images/${alias}_splash_${kind}_0.jpg`;
function sumArt(el, champ) {
  if (!el) return;
  const c = champ ? champById(champ) : null;
  const alias = c && c.alias ? String(c.alias).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  if (el.dataset.alias === alias) return;
  el.dataset.alias = alias;
  el.classList.remove('on');
  if (!alias) { el.style.backgroundImage = ''; return; }
  const kinds = ['uncentered', 'centered'];
  const next = () => {
    const kind = kinds.shift();
    if (!kind) return;
    const img = new Image();
    img.onload = () => {
      if (el.dataset.alias !== alias) return;
      el.style.backgroundImage = `url("${img.src}")`;
      el.classList.add('on');
    };
    img.onerror = next;
    img.src = sumArtUrl(alias, kind);
  };
  next();
}
// the most played champion of some participations (the head's picture)
function sumTopChamp(rows) {
  const m = new Map();
  for (const x of rows) m.set(x.p.champ, (m.get(x.p.champ) || 0) + 1);
  return ([...m].sort((a, b) => b[1] - a[1])[0] || [0])[0];
}
// one queue's rank, big: crest, tier, LP, wins / losses; note: a line under it (peak, which account)
function sumRank(label, r, note = '') {
  if (!r || !r.tier || !TIERS.includes(r.tier)) {
    return `<div class="ov-rank none"><span class="ov-crest"></span><div><span class="ov-rl">${esc(label)}</span><b>${esc(t('tile.unranked'))}</b>${note ? `<small class="ov-note">${note}</small>` : ''}</div></div>`;
  }
  const games = (r.wins || 0) + (r.losses || 0);
  const wl = r.wl !== false && games ? `${r.wins} W · ${r.losses} L · ${Stats.winPct(r.wins, games)} %` : '';
  return `<div class="ov-rank t-${r.tier.toLowerCase()}"><img class="ov-crest" src="${crestUrl(r.tier)}" alt=""><div><span class="ov-rl">${esc(label)}</span>
    <b>${esc(tierName(r.tier) + (APEX.includes(r.tier) ? '' : ' ' + r.division))} <i>${num(r.lp)} LP</i></b>${wl ? `<small>${esc(wl)}</small>` : ''}${note ? `<small class="ov-note">${note}</small>` : ''}</div></div>`;
}
const sumRankTxt = r => (r && r.tier ? tierName(r.tier) + (APEX.includes(r.tier) ? '' : ' ' + r.division) : '');
// who it is: o = { icons: [iconId …] (more than one: stacked), name, tag, sub, ranks (html) }
function sumWho(o) {
  const icons = (o.icons || []).filter(i => i != null);
  const av = icons.length > 1
    ? `<div class="ov-stack">${icons.slice(0, 4).map(i => `<img src="${iconUrl(i)}" alt="">`).join('')}${icons.length > 4 ? `<span>+${icons.length - 4}</span>` : ''}</div>`
    : `<div class="ov-ava">${icons.length ? `<img src="${iconUrl(icons[0])}" alt="">` : '<span></span>'}</div>`;
  return `<div class="ov-id">${av}<div class="ov-nm"><h1>${esc(o.name)}${o.tag ? `<small>#${esc(o.tag)}</small>` : ''}</h1>${o.sub ? `<p class="sub">${o.sub}</p>` : ''}</div></div>
    ${o.ranks ? `<div class="ov-ranks">${o.ranks}</div>` : ''}${o.open || ''}`;
}

// the own Overview's head: one account – that account; several – all of them, each queue's best rank
function renderOvHero() {
  const el = $('ovWho');
  if (!el) return;
  const chosen = ovChosen();
  const ranks = q => chosen.filter(a => a[q] && TIERS.includes(a[q].tier)).sort((a, b) => rankScore(b[q]) - rankScore(a[q]))[0];
  const rows = perf.games ? Stats.byParticipation(perf.games).filter(x => chosen.some(a => a.puuid === x.p.puuid)) : [];
  const season = sumScopeRows(rows, sumv.scope || sumAutoScope(rows));
  let who;
  if (chosen.length === 1) {
    const a = chosen[0];
    const peak = a.solo && a.solo.peak && a.solo.peak.tier ? t('ov.peak', { r: sumRankTxt(a.solo.peak) }) : '';
    who = { icons: hides('icon') ? [] : [a.iconId], name: dispName(a), tag: dispTag(a),
      sub: esc([!hides('level') && a.level ? t('scout.level', { n: a.level }) : '', a.region || '', season.length ? t('dash.nGames', { n: num(Stats.uniqueGames(season)) }) : ''].filter(Boolean).join(' · ')),
      ranks: hides('ranks') ? '' : sumRank('Solo/Duo', a.solo, esc(peak)) + sumRank('Flex', a.flex) };
  } else {
    const bs = ranks('solo'), bf = ranks('flex');
    const of = a => (a ? esc(t('ov.bestOf', { name: dispName(a) })) : '');
    who = { icons: hides('icon') ? [] : chosen.map(a => a.iconId), name: t('ov.yourAccounts'),
      sub: esc([t('ov.nAccounts', { n: chosen.length }), season.length ? t('dash.nGames', { n: num(Stats.uniqueGames(season)) }) : ''].filter(Boolean).join(' · ')),
      ranks: hides('ranks') ? '' : sumRank('Solo/Duo', bs && bs.solo, of(bs)) + sumRank('Flex', bf && bf.flex, of(bf)) };
  }
  // "Open with" for the own accounts too: one – its pages; several – op.gg's multi-search first,
  // then a tab per account (as the Accounts page does for several). Not in streamer mode.
  const named = chosen.filter(a => !a.placeholder && a.gameName && a.tagLine);
  who.open = named.length && !hides('name') ? `<div class="pl-open"><span class="p-open">${t('p.openWith')}</span>${named.length > 1 ? `<button class="chip" data-ovsite="multi">${esc(t('multi.opgg'))}</button>` : ''}`
    + SITES.map(([k, n]) => `<button class="chip" data-ovsite="${k}">${n}</button>`).join('') + '</div>' : '';
  el.innerHTML = sumWho(who);
  sumArt($('ovArt'), sumTopChamp(season.length ? season : rows));
  if (typeof renderShowcase === 'function') renderShowcase();
}

// ---------- the win rate as a ring (the key figures of Performance) ----------
function sumRing(v) {
  const r = 15, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v || 0));
  const cls = v >= 0.53 ? 'good' : v <= 0.47 ? 'bad' : '';
  return `<svg class="ov-ring ${cls}" viewBox="0 0 38 38"><circle cx="19" cy="19" r="${r}"/><circle class="v" cx="19" cy="19" r="${r}" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
}
// the traits of a scope: ranked (all roles) or ARAM
// rows: the participations a filter chose (Performance: queues, period, last n games, champion) – the
// traits judge exactly those; role: one role (the role filter) instead of every role
function sumRes(games, puuids, level, mastery, scope, rows = null, role = '') {
  const ctx = { games, own: puuids, level, mastery, now: Date.now(), ...(rows ? { rows } : {}) };
  if (scope === 'aram') return typeof Tags.evaluateAram === 'function' ? Tags.evaluateAram(ctx) : null;
  if (scope === 'arena') return typeof Tags.evaluateArena === 'function' ? Tags.evaluateArena(ctx) : null;
  return role ? Tags.evaluate({ ...ctx, role }) : Tags.evaluateAll(ctx);
}
api.onState(() => { if (view === 'dash') renderOvHero(); });
// a way into a tab ("Traits →" in the key figures)
$('viewDash').addEventListener('click', e => {
  const os = e.target.closest('[data-ovsite]');
  if (os) {
    const named = ovChosen().filter(a => !a.placeholder && a.gameName && a.tagLine);
    return named.length === 1 && os.dataset.ovsite !== 'multi' ? openSite(named[0], os.dataset.ovsite) : openMany(named, os.dataset.ovsite);
  }
  const go = e.target.closest('[data-ovgo]');
  if (!go) return;
  showDashTab(go.dataset.ovgo);
  const top = document.querySelector('main');
  if (top) top.scrollTop = 0;
});

// ---------- the head of every other page: a champion's splash art ----------
// Accounts: the signed-in (or first) account's best mastery champion; Collection and Tools: the next
// ones; Live: the champion picked now.
const PG_ART = { accounts: 'pgArtAccounts', coll: 'pgArtColl', live: 'pgArtLive', tools: 'pgArtTools' };
let pgArtAsked = false;
function pgTopChamps() {
  const accs = (S.accounts || []).filter(a => !a.placeholder);
  const first = accs.find(a => a.puuid === (S.live && S.live.puuid)) || accs.find(a => a.puuid === S.active);
  const out = [];
  for (const a of [first, ...accs].filter(Boolean)) for (const m of (a.profile && a.profile.topMastery) || []) if (m && m.id && !out.includes(m.id)) out.push(m.id);
  return out;
}
function pgLiveChamp() {
  const d = typeof liveData !== 'undefined' ? liveData : null;
  if (!d || !d.me) return 0;
  const list = [...((d.champSelect && d.champSelect.allies) || []), ...((d.inGame && [...(d.inGame.teamOne || []), ...(d.inGame.teamTwo || [])]) || [])];
  const me = list.find(p => p.puuid === d.me && p.championId);
  return me ? me.championId : 0;
}
function pageArt(v) {
  const el = $(PG_ART[v] || '');
  if (!el) return;
  if (!champs.length) {
    if (!pgArtAsked) { pgArtAsked = true; api.champions().then(c => { if (Array.isArray(c) && c.length) { champs = c; pageArt(view); } }).catch(() => {}); }
    return;
  }
  const top = pgTopChamps();
  let champ = { accounts: top[0], coll: top[1] || top[0], tools: top[2] || top[0] }[v] || 0;
  if (v === 'live') champ = pgLiveChamp() || top[0];
  sumArt(el, champ || 0);
}
api.onState(() => pageArt(view));
