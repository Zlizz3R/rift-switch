// Live, more (docs/plans Phase 5b), on top of scout-view.js: premades as coloured frames, "do I
// know them?", the own record against the lane opponent's champion, each team's damage mix, the
// champ-select helper by game phase and the own tags before / after a game in the post-game view.
// The maths is in insights.js; uses the globals of renderer.js / views.js / scout-view.js / tags-view.js.

const lmx = { types: {}, asked: new Set(), pgTags: { id: '', html: '' } };

// every known game: the other players' (scouting) and the own stored ones
function lmGames() {
  const all = [...(scv.own || [])];
  const own = new Set(all.map(g => String(g.id)));
  for (const g of scv.games.values()) if (!own.has(String(g.id))) all.push(g);
  return all;
}
// the own stored games are needed outside a game too (champ select, post-game)
function lmNeedOwn() {
  if (scv.own || lmx.ownLoading) return;
  lmx.ownLoading = true;
  allGames().then(g => { scv.own = g || []; lmx.ownLoading = false; scv.memo = new Map(); if (view === 'live') renderLive(true); });
}
// the id of the newest own stored game ("last game" means that one)
function lmNewestOwn() {
  let best = null;
  for (const g of scv.own || []) if (!best || g.t > best.t) best = g;
  return best ? String(best.id) : '';
}
// "Last game" (the newest own game) / "Today" / "Yesterday" / "3 days ago"
function lmDay(at, last = false) {
  if (last) return t('know.lastGame');
  const d = Insights.daysAgo(at);
  return d === 0 ? t('know.today') : d === 1 ? t('know.yesterday') : t('know.daysAgo', { n: d });
}
const lmOwnIds = () => S.accounts.filter(a => !a.placeholder).map(a => a.puuid);

// ---------- damage mix ----------
function lmTypes(ids) {
  const want = ids.filter(id => id && !(id in lmx.types) && !lmx.asked.has(id));
  if (!want.length) return;
  want.forEach(id => lmx.asked.add(id));
  api.champDamage(want).then(r => { if (r && typeof r === 'object') { Object.assign(lmx.types, r); if (view === 'live') renderLive(true); } });
}
const LM_SRC = { player: 'mix.srcPlayer', champ: 'mix.srcChamp', type: 'mix.srcType' };
function dmgMixHtml(teams) {
  lmNeedOwn();
  lmTypes(teams.flatMap(tm => tm.champs.map(c => c.champ)));
  const games = lmGames();
  const rows = teams.map(tm => {
    const m = Insights.damageMix(tm.champs, games, lmx.types);
    if (!m) return '';
    const pct = x => Math.round(x * 100);
    const tip = m.per.map(p => `${(champById(p.champ) || {}).name || p.champ}: ${t(LM_SRC[p.src] || 'mix.srcNone')}`).join('\n');
    const heavy = m.ad >= 0.65 ? t('mix.heavyAd') : m.ap >= 0.65 ? t('mix.heavyAp') : '';
    return `<div class="mix" title="${esc(tip)}"><span class="mix-l">${esc(tm.label)}</span>
      <div class="mix-bar"><i class="ad" style="width:${pct(m.ad)}%"></i><i class="ap" style="width:${pct(m.ap)}%"></i><i class="tr" style="width:${pct(m.tru)}%"></i></div>
      <span class="mix-t">${t('mix.line', { ad: pct(m.ad), ap: pct(m.ap), tr: pct(m.tru) })}</span>${heavy ? `<b class="mix-h">${esc(heavy)}</b>` : ''}</div>`;
  }).filter(Boolean);
  return rows.length ? `<div class="mixes">${rows.join('')}</div>` : '';
}

// ---------- the board's extras: parties, hints, meetings, record ----------
// g: liveData.inGame; rows: [[{c, slot}], [{c, slot}]] as laid out (blue side first)
function lmBoardExtras(g, rows) {
  lmNeedOwn();
  const out = new Map();
  const add = (p, chip) => { if (!out.has(p)) out.set(p, { chips: [] }); out.get(p).chips.push(chip); };
  const all = [...g.teamOne, ...g.teamTwo];
  const ids = all.map(p => p.puuid).filter(Boolean);
  const byId = new Map(all.map(p => [p.puuid, p]));
  const champName = id => (champById(id) || {}).name || '';
  const games = lmGames();
  const pairs = Insights.together(games, ids, g.gameId);
  const loaded = p => scGames(p).length;
  // parties: a badge in the party's colour on each member's card – as many heads as the party has,
  // and its number in the team (1, 2); party = the number on the whole board (colour, hover)
  let party = 0;
  for (const row of rows) {
    const team = row.map(x => x.c.p.puuid).filter(Boolean);
    let num = 0;
    // the own lobby: those in it who are in this team (the client said so – no guessing needed);
    // the parties found in earlier games only for the others
    const lobby = (g.party || []).filter(p => team.includes(p));
    const fromLobby = lobby.length > 1 ? [lobby] : [];
    const found2 = Insights.parties(pairs, team).map(x => x.filter(p => !lobby.includes(p) || lobby.length < 2)).filter(x => x.length > 1);
    for (const found of [...fromLobby, ...found2].slice(0, 2)) {
      party++; num++;
      // Flex can't be queued as four: four premades means the fifth is one too
      const extra = g.queueId === 440 && found.length === 4 && team.length === 5 ? team.find(p => !found.includes(p)) : null;
      const grp = extra ? [...found, extra] : found;
      for (const p of grp) {
        if (p === extra) {
          const e = out.get(p) || { chips: [] };
          out.set(p, Object.assign(e, { party, num, size: grp.length, partyTip: t('party.flex5') }));
          continue;
        }
        const others = grp.filter(x => x !== p);
        const nameOf = o => { const q = byId.get(o) || {}; return q.gameName ? `${q.gameName}#${q.tagLine}` : '?'; };
        if (found === fromLobby[0]) {
          const e = out.get(p) || { chips: [] };
          out.set(p, Object.assign(e, { party, num, size: grp.length, partyTip: t('party.lobby', { names: others.map(nameOf).join(', ') }) }));
          continue;
        }
        const sameGames = others.map(o => (pairs.get([p, o].sort().join('|')) || { same: [] }).same).flat();
        const last = sameGames.sort((a, b) => b.t - a.t)[0];
        const tip = t('party.tip', { names: others.map(o => { const q = byId.get(o) || {}; return q.gameName ? `${q.gameName}#${q.tagLine}` : '?'; }).join(', '),
          n: new Set(sameGames.map(x => String(x.id))).size, m: loaded(p), ago: last ? ago(last.t + (last.dur || 0) * 1000) : '–' });
        const e = out.get(p) || { chips: [] };
        Object.assign(e, { party, num, size: grp.length, partyTip: tip });
        out.set(p, e);
      }
    }
  }
  // exactly one earlier game together: a hint on both cards, the other named by this game's champion
  const ownIds = lmOwnIds();
  for (const h of Insights.onceMet(pairs)) {
    const [a, b] = [byId.get(h.a), byId.get(h.b)];
    // with an own account "do I know them?" says it (with more detail); premades of one party
    // play together anyway – that they met before says nothing
    if (!a || !b || ownIds.includes(h.a) || ownIds.includes(h.b)) continue;
    const pa = (out.get(h.a) || {}).party;
    if (pa && pa === (out.get(h.b) || {}).party) continue;
    const when = new Date(h.g.t).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
    const day = lmDay(h.g.t);
    for (const [me, other] of [[a, b], [b, a]]) {
      const pm = h.g.players.find(x => x.puuid === me.puuid), po = h.g.players.find(x => x.puuid === other.puuid);
      const tip = t('hint.tip', { when, a: champName(pm && pm.champ), b: champName(po && po.champ), res: t(pm && pm.win ? 'hint.won' : 'hint.lost') });
      // the other one by this game's champion (to find him on the board), this one by his champion then
      add(me.puuid, `<span class="tchip tc-info" title="${esc(tip)}">${esc(t(h.same ? 'hint.team' : 'hint.enemy', { when: day, champ: champName(other.championId), then: champName(pm && pm.champ) }))}</span>`);
    }
  }
  // do I know them: every player against all own stored games
  const own = lmOwnIds();
  const myLobby = g.party || [];
  for (const p of all) {
    // the own premades: of course you played with them before
    if (!p.puuid || own.includes(p.puuid) || myLobby.includes(p.puuid)) continue;
    const m = Insights.meetings(scv.own || [], own, p.puuid, g.gameId);
    if (!m) continue;
    const L = m.last;
    const when = lmDay(L.g.t, String(L.g.id) === lmNewestOwn());
    const acc = S.accounts.find(a => a.puuid === L.me.puuid);
    const tip = [t(L.same ? 'know.tipTeam' : 'know.tipEnemy', { champ: champName(L.them.champ), kda: `${L.them.k}/${L.them.d}/${L.them.a}`,
      res: t(L.win ? 'hint.won' : 'hint.lost'), when: new Date(L.g.t).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }), acc: acc ? dispName(acc) : '?' })];
    if (m.n > 1) tip.push(t('know.total', { n: m.n, e: m.against.n, ew: m.against.w, el: m.against.n - m.against.w, tm: m.same.n, tw: m.same.w }));
    add(p.puuid, `<button class="tchip tc-info" data-opengame="${esc(L.g.id)}" title="${esc(tip.join('\n'))}">${esc(t(L.same ? 'know.team' : 'know.enemy', { when, champ: champName(L.them.champ) }))}</button>`);
  }
  // my record against my lane opponent's champion (on my card)
  const myRow = rows.find(r => r.some(x => x.c.p.puuid === liveData.me));
  const oppRow = myRow && rows.find(r => r !== myRow);
  if (myRow && oppRow) {
    const meX = myRow.find(x => x.c.p.puuid === liveData.me);
    const mine = meX.c.p, opp = meX.slot && oppRow.find(x => x.slot === meX.slot);
    const fmt = (r, champ) => t(r.all ? 'rec.lineAll' : 'rec.line', { champ: champName(champ), w: r.w, l: r.l, pct: Math.round((100 * r.w) / r.n) });
    if (opp) {
      const r = Insights.recordVs(scv.own || [], own, mine.championId, opp.c.p.championId);
      if (r) add(mine.puuid, `<span class="tchip tc-info" title="${esc(t('rec.tip'))}">${esc(fmt(r, opp.c.p.championId))}</span>`);
    } else {
      // the lane opponent is unknown: the record against each enemy champion on the chip itself
      // (Ahri 3–1 · Zed 0–2, the most played first; * = over all your champions), in full when hovering
      const recs = oppRow.map(x => ({ champ: x.c.p.championId, r: Insights.recordVs(scv.own || [], own, mine.championId, x.c.p.championId) }))
        .filter(x => x.r).sort((a, b) => (a.r.all - b.r.all) || (b.r.n - a.r.n));
      if (recs.length) {
        const short = recs.slice(0, 3).map(x => `${champName(x.champ)} ${x.r.w}–${x.r.l}${x.r.all ? '*' : ''}`).join(' · ') + (recs.length > 3 ? ` · +${recs.length - 3}` : '');
        const tip = [t('rec.tip'), ...recs.map(x => fmt(x.r, x.champ))].join('\n');
        add(mine.puuid, `<span class="tchip tc-info" title="${esc(tip)}">${esc(`${t('rec.vsAll')}: ${short}`)}</span>`);
      }
    }
  }
  return out;
}
// hovering a party card lights up its partners
document.addEventListener('mouseover', e => {
  const c = e.target.closest && e.target.closest('.sc-card[data-party]');
  document.querySelectorAll('.sc-card.hl').forEach(x => { if (!c || x.dataset.party !== c.dataset.party) x.classList.remove('hl'); });
  if (c) document.querySelectorAll(`.sc-card[data-party="${c.dataset.party}"]`).forEach(x => x.classList.add('hl'));
});

// ---------- the helper by game phase ----------
// champ select: all of it; no game: the champion pool, folded (kept); a game on: not there
const lmPoolOpen = () => ((S.settings && S.settings.uiTabs) || {}).pool === 'open';
function helperByPhase(d) {
  if (d.inGame) return '';
  if (d.champSelect) return helperHtml();
  const n = pool().length;
  const head = `<button class="pool-fold${lmPoolOpen() ? ' open' : ''}" data-poolfold><span>${t('pool.title')}</span><small>${t('pool.count', { n })}</small><i></i></button>`;
  return lmPoolOpen() ? `<div class="pool-box">${head}${helperHtml()}</div>` : `<div class="live-card pool-box">${head}</div>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-poolfold]')) return;
  const tabs = { ...((S.settings && S.settings.uiTabs) || {}), pool: lmPoolOpen() ? 'closed' : 'open' };
  S.settings = { ...S.settings, uiTabs: tabs };
  api.setSetting('uiTabs', tabs);
  renderLive(true);
});

// ---------- post-game: the own tags before and after this game ----------
function pgTagsHtml(g) {
  if (lmx.pgTags.id === String(g.id)) return lmx.pgTags.html;
  lmx.pgTags = { id: String(g.id), html: '' };
  allGames().then(all => {
    const own = lmOwnIds();
    const me = g.players.find(p => own.includes(p.puuid));
    if (!me || !all) return;
    const eval1 = games => Tags.evaluate({ games, own: [me.puuid], now: g.t + (g.dur || 0) * 1000 + 1 }).results;
    const before = eval1(all.filter(x => String(x.id) !== String(g.id) && x.t < g.t));
    const after = eval1(all.filter(x => x.t <= g.t));
    const dirOf = x => { const r = TagRules.TAG_RULES.find(y => y.id === x.id) || {}; return r.dir || (r.below != null ? -1 : 1); };
    const diff = Insights.tagDiff(before, after, dirOf).slice(0, 6);
    const chip = x => {
      const name = x.kind === 'gone' && !x.level ? t(`tag.${x.id}${(TagRules.TAG_RULES.find(y => y.id === x.id) || {}).type === 'metric' ? '.great' : ''}`, { champ: x.champ ? tagChampName(x.champ) : '' }) : tagName(x.x || x);
      const tip = x.kind === 'new' ? t('pgt.new', { name }) : x.kind === 'gone' ? t('pgt.gone', { name, from: tagFmt(x, x.from), to: tagFmt(x, x.to) })
        : t('pgt.change', { name, from: tagFmt(x, x.from), to: tagFmt(x, x.to) });
      return `<span class="pgt ${x.dir > 0 ? 'up' : 'down'}" title="${esc(tip)}"><i>${x.dir > 0 ? '▲' : '▼'}</i>${esc(name)}</span>`;
    };
    lmx.pgTags.html = diff.length ? `<div class="pgt-row"><span class="d-sec-t">${t('pgt.title')}</span>${diff.map(chip).join('')}</div>` : '';
    if (view === 'live') renderLive(true);
  });
  return '';
}
