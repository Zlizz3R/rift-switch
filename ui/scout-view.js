// Live → the ten players of the game, in the style of Porofessor: two rows (own team, enemies),
// Top · Jungle · Mid · Bot · Support from left to right so lane opponents face each other. Per card:
// icon, Riot ID, level; the champion with Ø K/D/A and mastery; Solo/Duo and Flex; a tint in the
// Solo/Duo rank's colour (the card's edge stays free for premades); win rate on this champion and
// the main role as two circles; the tags (live tags first). The games come from the backend's
// scouting (main.rs: matches-others) plus the own stored games; the tags from tags.js.
// Also: the storage of other players' games in Settings, and the one-time note at 1 GB.

const scv = { data: {}, own: null, key: '', loading: false, again: false, at: 0, timer: 0 };
const SC_POS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', MID: 'mid', BOTTOM: 'bot', BOT: 'bot', UTILITY: 'support', SUPPORT: 'support' };
const SC_NO_LANES = [...Stats.ARAM_QUEUES, 1700, 1710];
const scIds = () => { const g = liveData && liveData.inGame; return g ? [...g.teamOne, ...g.teamTwo].map(p => p.puuid).filter(Boolean) : []; };

async function loadScout(ids) {
  if (scv.loading) { scv.again = true; return; }
  scv.loading = true;
  try {
    const [d, own] = await Promise.all([api.scoutGames(ids), scv.own ? null : allGames()]);
    if (d && typeof d === 'object') scv.data = d;
    if (own) scv.own = own;
  } catch (e) { console.warn('scout', e); }
  scv.loading = false;
  scv.memo = new Map();
  if (view === 'live') renderLive(true);
  if (scv.again) { scv.again = false; loadScout(scIds()); }
}
// the backend stored more: fetch again, at most every 2.5 s (and once more after the last change)
api.onScoutChanged(() => {
  if (view !== 'live' || !scIds().length) return;
  clearTimeout(scv.timer);
  const wait = Math.max(0, 2500 - (Date.now() - scv.at));
  scv.timer = setTimeout(() => { scv.at = Date.now(); loadScout(scIds()); }, wait);
});
api.onMatchesChanged(() => { scv.own = null; });

// every known game of a player: from their match list (scouting) and the own stored games
function scGames(puuid) {
  const theirs = (scv.data[puuid] || {}).games || [];
  const own = (scv.own || []).filter(g => g.players && g.players.some(p => p.puuid === puuid));
  const seen = new Set(), out = [];
  for (const g of [...theirs, ...own]) {
    const id = String(g.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...g, owners: [puuid] });
  }
  return out;
}

// everything a card shows about one player
function scCard(p, enemyChamps) {
  const key = `${p.puuid}|${p.championId}|${(scv.data[p.puuid] || {}).games ? scv.data[p.puuid].games.length : 0}`;
  if (scv.memo && scv.memo.has(key)) return scv.memo.get(key);
  const games = scGames(p.puuid);
  const parts = Stats.byParticipation(games).filter(x => x.p.puuid === p.puuid);
  const champ = p.championId;
  const onChamp = parts.filter(x => x.p.champ === champ);
  const m = (scv.data[p.puuid] || {}).mastery || null;
  // the client lists only champions with points: a champion not in the list has 0
  const pts = m && champ ? Number(m[champ] || 0) : null;
  const topM = m ? Object.entries(m).sort((a, b) => b[1] - a[1])[0] : null;
  const mastRows = m ? [[champ, pts], topM].filter(x => x && x[0]).filter((x, i, a) => a.findIndex(y => +y[0] === +x[0]) === i)
    .map(([id, v]) => ({ id: +id, total: +v, n: 1 })).sort((a, b) => b.total - a.total) : null;
  const res = Tags.evaluate({ games, own: [p.puuid], level: p.level, mastery: mastRows, now: Date.now() });
  const roles = Tags.mainRole(parts);
  const pos = SC_POS[String(p.position || '').toUpperCase()] || '';
  const live = Tags.liveTags({ games, puuid: p.puuid, champ, mastery: pts, position: pos, main: res.main, enemyChamps, bans: [], results: res.results });
  const out = { p, n: parts.length, ag: Stats.aggregate(onChamp), pts, roles, pos, live, tags: Tags.pick(res.results) };
  if (scv.memo) scv.memo.set(key, out);
  return out;
}

// the five of a team on their positions: from the client where it tells, else the main role
// (then marked as guessed); ARAM / Arena: the client's order
function scOrder(cards, queue) {
  if (SC_NO_LANES.includes(queue)) return cards.map(c => ({ c, slot: '', guess: false }));
  const slots = new Map();
  for (const c of cards) if (c.pos && !slots.has(c.pos)) slots.set(c.pos, { c, guess: false });
  for (const c of cards) {
    if ([...slots.values()].some(s => s.c === c)) continue;
    const want = c.roles.main || c.roles.most;
    if (want && !slots.has(want)) slots.set(want, { c, guess: true });
  }
  const free = Stats.POSITIONS.filter(r => !slots.has(r));
  for (const c of cards) if (![...slots.values()].some(s => s.c === c) && free.length) slots.set(free.shift(), { c, guess: true });
  return Stats.POSITIONS.filter(r => slots.has(r)).map(r => ({ ...slots.get(r), slot: r }));
}

// ---------- texts ----------
function scTagTexts(x) {
  const v = x.vars || {};
  const champ = x.champ ? tagChampName(x.champ) : '';
  if (x.id === 'newTo') return [t('tag.newTo', { champ }), t('tag.newTo.t', { n: v.n, pts: num(v.pts), champ })];
  if (x.id === 'mainTaken' || x.id === 'mainBanned') return [t('tag.' + x.id), t(`tag.${x.id}.t`, { champ, n: v.n })];
  if (x.id === 'autofill') return [t('tag.autofill'), t('tag.autofill.t', { role: t('pos.' + v.role), now: t('pos.' + v.now), pct: v.pct })];
  return [tagName(x), tagText(x)];
}
function scChip(x) {
  const [short, long] = scTagTexts(x);
  const exact = !!(S.settings && S.settings.tagsLong);
  return `<span class="tchip tc-${tagColor(x)}" title="${esc(exact ? short : long)}">${esc(exact ? long : short)}</span>`;
}
function scRank(label, r) {
  if (!r) return `<div class="sc-rk none"><span>${label}</span><b>${t('tile.unranked')}</b></div>`;
  const games = r.wins + r.losses;
  // wins and losses in the tooltip: the card stays narrow
  return `<div class="sc-rk" title="${esc(r.wl !== false && games ? t('tile.wlTitle', { w: r.wins, l: r.losses }) : t('tile.wlUnknown'))}"><span>${label}</span>
    <img src="${crestUrl(r.tier)}" alt=""><b>${tierName(r.tier)}${APEX.includes(r.tier) ? '' : ' ' + r.division} · ${r.lp} LP</b></div>`;
}
// n people (2–5) in a row, the middle ones in front and bigger – the premade badge
function scPeople(n) {
  n = Math.max(2, Math.min(5, n || 2));
  const c = (n - 1) / 2, step = 6.4;
  const ps = Array.from({ length: n }, (_, i) => {
    // two: the left one behind; else the middle one(s) in front
    const level = n === 2 ? 1 - i : Math.round(Math.abs(i - c) - (n % 2 ? 0 : 0.5));
    return { x: i * step, s: 1 - 0.16 * level, yb: 15 - 2.4 * level, level };
  });
  const f = v => +v.toFixed(2);
  const minX = Math.min(...ps.map(p => p.x - 5 * p.s)) - 1, maxX = Math.max(...ps.map(p => p.x + 5 * p.s)) + 1;
  const shapes = [...ps].sort((a, b) => b.level - a.level).map(({ x, s, yb }) =>
    `<path d="M${f(x - 5 * s)} ${f(yb)}V${f(yb - 2 * s)}A${f(5 * s)} ${f(4.6 * s)} 0 0 1 ${f(x + 5 * s)} ${f(yb - 2 * s)}V${f(yb)}Z"/><circle cx="${f(x)}" cy="${f(yb - 9 * s)}" r="${f(3.6 * s)}"/>`).join('');
  return `<svg class="sc-ppl" data-n="${n}" viewBox="${f(minX)} 0 ${f(maxX - minX)} 16">${shapes}</svg>`;
}
const scRing = (pct, inner, cls = '') => `<div class="sc-ring ${cls}" style="--p:${pct == null ? 0 : Math.round(pct)}">${inner}</div>`;

function scCardHtml(c, side, slot, guess, ex = {}) {
  const p = c.p;
  // live tags first, then the hints about this game (premades, met before, record), then the rest
  const chips = [...c.live.map(scChip), ...(ex.chips || []), ...c.tags.map(scChip)];
  const party = ex.party ? ` data-party="${ex.party}"` : '';
  const pcls = ex.party ? ` pa${((ex.party - 1) % 4) + 1}` : '';
  const tier = p.solo && p.solo.tier;
  // the Solo/Duo rank: a frame and a band in its colour, the band on the edge facing the other team
  const rk = tier && TIER_COLORS[tier];
  const band = `<i class="sc-rkband" title="${esc(rk ? 'Solo/Duo: ' + tierName(tier) + (APEX.includes(tier) ? '' : ' ' + p.solo.division) : t('tile.unranked'))}"></i>`;
  const prog = ((S.scout && S.scout.players) || {})[p.puuid];
  const bar = prog && prog[1] && prog[0] < prog[1] ? `<i class="sc-bar" style="width:${Math.round((100 * prog[0]) / prog[1])}%"></i>` : '';
  const champName = (champById(p.championId) || {}).name || '';
  const ag = c.ag;
  const wr = ag ? `${scRing(ag.winrate * 100, `<b>${Math.round(ag.winrate * 100)}%</b>`)}<small>${esc(t('scout.wrGames', { n: ag.n }))}</small>`
    : `${scRing(null, '<b>–</b>', 'none')}<small>${esc(t('scout.noGamesOn'))}</small>`;
  const wrTip = ag ? t('scout.wrTip', { champ: champName, n: ag.n, w: ag.wins, all: c.n }) : t('scout.noGamesTip', { champ: champName, all: c.n });
  const main = c.roles.main || c.roles.most;
  const share = main && c.roles.total ? (100 * (c.roles.shares.get(main) || 0)) / c.roles.total : null;
  const role = main ? `${scRing(share, `<img src="${posIcon(main)}" alt="">`)}<small>${Math.round(share)} %</small>` : `${scRing(null, '<b>–</b>', 'none')}<small>${esc(t('scout.noRole'))}</small>`;
  const roleTip = main ? t(c.roles.main ? 'scout.roleTip' : 'scout.roleMostTip', { role: t('pos.' + main), pct: Math.round(share), n: c.roles.total }) : t('scout.noRole');
  return `<div class="sc-card ${side}${rk ? ' ranked' : ''}${p.puuid && liveData && p.puuid === liveData.me ? ' me' : ''}${pcls}" data-sc="${esc(p.puuid || '')}"${party}${rk ? ` style="--rk:${rk}"` : ''}>
    ${band}${bar}
    <div class="sc-head">${p.iconId != null ? `<img class="sc-ic" src="${iconUrl(p.iconId)}" alt="">` : '<span class="sc-ic"></span>'}
      <span class="sc-name"><b>${esc(p.gameName || '?')}</b><small>${p.tagLine ? '#' + esc(p.tagLine) : ''}${p.level ? ' · ' + esc(t('scout.level', { n: p.level })) : ''}</small></span>
      ${ex.party ? `<span class="sc-party" title="${esc(ex.partyTip || '')}">${scPeople(ex.size)}<b>${ex.num || ex.party}</b></span>` : ''}
      ${slot ? `<img class="sc-pos${guess ? ' guess' : ''}" src="${posIcon(slot)}" alt="" title="${esc(t('pos.' + slot) + (guess ? ' – ' + t('scout.guessed') : ''))}">` : ''}</div>
    <div class="sc-mid">
      <div class="sc-champ" data-scflip="${esc(p.puuid || '')}" title="${esc(t('rad.flip'))}">${p.championId ? `<img src="${champIcon(p.championId)}" alt="">` : '<span></span>'}
        <span><b>${esc(champName)}</b><small>${ag ? `Ø ${perfAvg(ag)}` : '–'}</small><small>${c.pts != null ? esc(t('scout.mastery', { pts: num(c.pts) })) : '&nbsp;'}</small></span></div>
      <div class="sc-ranks">${scRank('Solo/Duo', p.solo)}${scRank('Flex', p.flex)}</div>
    </div>
    ${typeof rdv !== 'undefined' && rdv.flipped.has(p.puuid) ? scRadarHtml(c) : `<div class="sc-rings"><div title="${esc(wrTip)}">${wr}</div><div title="${esc(roleTip)}">${role}</div></div>
    <div class="sc-tags">${chips.length ? chips.join('') : `<span class="muted">${esc(c.n ? t('scout.noTags', { n: c.n }) : t('scout.noData'))}</span>`}</div>`}
  </div>`;
}

// the whole board (called by renderLive while a game is on)
function scoutBoardHtml(d) {
  const g = d.inGame;
  const ids = scIds();
  const key = ids.join(',');
  if (key !== scv.key) { scv.key = key; scv.data = {}; scv.memo = new Map(); if (ids.length) loadScout(ids); }
  const mineKey = g.teamTwo.some(p => p.puuid === d.me) ? 'teamTwo' : 'teamOne';
  const theirsKey = mineKey === 'teamOne' ? 'teamTwo' : 'teamOne';
  const champsOf = team => g[team].map(p => p.championId).filter(Boolean);
  // blue side always on top, red side below
  const laid = [['teamOne', 'teamTwo'], ['teamTwo', 'teamOne']].map(([team, enemy]) => scOrder(g[team].map(p => scCard(p, champsOf(enemy))), g.queueId));
  const extras = typeof lmBoardExtras === 'function' ? lmBoardExtras(g, laid) : new Map();
  const row = (i, side) => laid[i].map(({ c, slot, guess }) => scCardHtml(c, side, slot, guess, extras.get(c.p.puuid))).join('');
  const team = k => g[k].map(p => ({ puuid: p.puuid, champ: p.championId }));
  const mix = typeof dmgMixHtml === 'function' ? dmgMixHtml([{ label: t('live.enemies'), champs: team(theirsKey) }, { label: t('live.allies'), champs: team(mineKey) }]) : '';
  const sc = S.scout;
  let prog = '';
  if (sc && sc.of) {
    const text = sc.running && sc.done < sc.total ? t('scout.paused', { done: sc.done, total: sc.total })
      : sc.listed < sc.of ? t('scout.lists', { n: sc.listed, of: sc.of })
      : sc.done < sc.total ? t('scout.games', { done: sc.done, total: sc.total }) : '';
    const pct = sc.listed < sc.of ? (100 * sc.listed) / sc.of : sc.total ? (100 * sc.done) / sc.total : 100;
    if (text) prog = `<div class="sc-prog"><span>${esc(text)}</span><i style="width:${Math.round(pct)}%"></i></div>`;
  }
  const exact = !!(S.settings && S.settings.tagsLong);
  const opgg = g[theirsKey].filter(o => o.gameName).map(o => o.gameName + '#' + o.tagLine);
  return `<div class="live-card sc-board">
    <div class="lc-head"><h3>${t('scout.title')}</h3>${mix}
      <div class="seg sc-mode"><span>${t('scout.tags')}</span><button data-sctags="0"${exact ? '' : ' class="on"'}>${t('scout.short')}</button><button data-sctags="1"${exact ? ' class="on"' : ''}>${t('scout.exact')}</button></div>
      ${opgg.length ? `<button class="btn gold ext-btn multi-btn" data-ids="${esc(opgg.join('|'))}"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${t('live.multiOpgg')}</button>` : ''}</div>
    ${prog}
    <div class="sc-row">${row(0, 'top')}</div>
    <div class="sc-row">${row(1, 'bot')}</div>
  </div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sctags]');
  if (!b) return;
  const on = b.dataset.sctags === '1';
  S.settings = { ...S.settings, tagsLong: on };
  api.setSetting('tagsLong', on);
  scv.memo = new Map();
  renderLive(true);
});

// ---------- Settings: the stored games, own and other players' apart; the limit ----------
async function loadStoreBox() {
  const [own, oth] = await Promise.all([api.matchesStorage(), api.othersStorage()]);
  if (own) $('storeOwn').textContent = t('set.storeLine', { size: fmtBytes(own.bytes), n: num(own.games) });
  if (oth) $('storeOthers').textContent = t('set.storeLine', { size: fmtBytes(oth.bytes), n: num(oth.games) });
  $('othersClear').disabled = !(oth && (oth.games || oth.bytes));
  $('othersLimit').value = (S.settings && S.settings.othersLimit) || '0';
  scBigStore(((own && own.bytes) || 0) + ((oth && oth.bytes) || 0));
}
// over 1 GB for the first time: once, a choice
async function scBigStore(bytes) {
  if (bytes < 1e9 || (S.settings && S.settings.bigStoreAsked)) return;
  S.settings = { ...S.settings, bigStoreAsked: true };
  api.setSetting('bigStoreAsked', true);
  const limit = await confirmBox(t('store.bigTitle'), t('store.bigText', { size: fmtBytes(bytes) }), t('store.setLimit'));
  if (limit) { api.setSetting('othersLimit', '2000'); S.settings = { ...S.settings, othersLimit: '2000' }; toast(t('store.limitSet')); }
}
$('othersLimit').onchange = () => { const v = $('othersLimit').value; S.settings = { ...S.settings, othersLimit: v }; api.setSetting('othersLimit', v); };
$('othersClear').onclick = async () => {
  const oth = (await api.othersStorage()) || { bytes: 0, games: 0 };
  if (!(await confirmBox(t('set.othersClearTitle'), t('set.othersClearText', { n: num(oth.games), size: fmtBytes(oth.bytes) }), t('mh.clearYes')))) return;
  await api.othersClear();
  scv.data = {}; scv.memo = new Map();
  toast(t('mh.cleared'));
  loadStoreBox();
};
const scOpenSettings = openSettings;
// eslint-disable-next-line no-global-assign
openSettings = function (open) { scOpenSettings(open); if (open) loadStoreBox(); };
