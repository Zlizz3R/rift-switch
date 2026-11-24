// Live page, right after a game: the whole match at a glance (like a post-game screen) – both teams
// with K/D/A, items, runes, ranks, damage dealt and taken and gold as bars (best player = 100 %),
// and a placement of every player worked out by Rift Switch (MVP = best winner, ACE = best loser).
// Shown for two hours after the game, while no champion select or game is on.
// The same table is the "Players" part of a game's details in the match history (pgTableHtml).
// Uses the globals of renderer.js / views.js / matches-view.js.

const pg = { game: null, checked: 0, busy: false, key: '' };
const PG_FRESH = 2 * 3600 * 1000;

// the newest stored game of the signed-in account (the match history fills in right after a game)
async function loadPostgame(force) {
  const me = (S.live && S.live.puuid) || S.active;
  if (!me || pg.busy) return;
  if (!force && Date.now() - pg.checked < 15000) return;
  pg.busy = true;
  pg.checked = Date.now();
  try {
    if (!assets || !Object.keys(assets.items || {}).length) assets = (await api.matchesAssets()) || null;
    const d = await api.matches({ puuid: me, queue: null });
    const row = d && d.index && d.index[0];
    if (row && (!pg.game || String(pg.game.id) !== String(row[0]))) {
      const [g] = (await api.matchesGet([row[0]])) || [];
      if (g) {
        pg.game = { ...g, owners: row.slice(3) };
        pgRanks(pg.game);
      }
    }
  } catch (e) { console.warn('postgame', e); }
  pg.busy = false;
  if (view === 'live') renderLive();
}
async function pgRanks(g) {
  const owner = S.accounts.find(a => a.puuid === (g.owners || [])[0]);
  const ids = g.players.map(p => p.puuid).filter(Boolean).filter(id => !mh.ranks[id]);
  if (!ids.length) return;
  const r = await api.playerRanks([{ region: (owner && owner.region) || '', ids }]);
  Object.assign(mh.ranks, (r && r.ranks) || {});
  if (r && r.pending) setTimeout(() => pgRanks(g), 800);
  if (view === 'live') renderLive();
}

// the lane opponent: the enemy on the same position (none outside Summoner's Rift, e.g. ARAM)
function pgOpponent(g, p) {
  const ro = gameRoles(g);
  if (!ro) return null;
  return g.players.find(x => x.team !== p.team && ro.get(x) === ro.get(p)) || null;
}
// how much better than the lane opponent: per stat my share of the two of us (0.5 = even),
// weighted, turned into a factor from ×0.60 to ×1.40 (a 60 : 40 lane is ×1.15)
const PG_LANE = { gold: 0.3, dmg: 0.25, kda: 0.25, cs: 0.1, vis: 0.1 };
function pgLane(g, p) {
  const o = pgOpponent(g, p);
  if (!o) return null;
  const v = x => ({ gold: x.gold || 0, dmg: x.dmg || 0, kda: Stats.kda(x.k, x.d, x.a), cs: x.cs || 0, vis: x.vis || 0 });
  const a = v(p), b = v(o);
  const share = Object.keys(PG_LANE).reduce((s, k) => s + PG_LANE[k] * (a[k] + b[k] > 0 ? a[k] / (a[k] + b[k]) : 0.5), 0);
  return { opp: o, share, mult: Math.min(1.4, Math.max(0.6, 1 + (share - 0.5) * 1.5)) };
}

// a score per player from what the game says, each part relative to the best of the ten,
// then multiplied by the lane factor (how much better or worse than the lane opponent)
function pgPlacements(g) {
  const ps = g.players;
  const val = p => ({
    kda: Math.min(10, Stats.kda(p.k, p.d, p.a)),
    kp: Stats.kp(g, p) ?? 0,
    dmg: p.dmg || 0,
    gold: p.gold || 0,
    taken: (p.x && p.x.taken) || 0,
    vis: p.vis || 0,
    cs: Stats.csMin(g, p),
  });
  const W = { kda: 0.25, kp: 0.2, dmg: 0.2, gold: 0.1, taken: 0.1, vis: 0.1, cs: 0.05 };
  const vals = ps.map(val);
  const max = Object.fromEntries(Object.keys(W).map(k => [k, Math.max(1e-9, ...vals.map(v => v[k]))]));
  const lanes = ps.map(p => pgLane(g, p));
  const score = vals.map((v, i) => Object.keys(W).reduce((s, k) => s + W[k] * (v[k] / max[k]), 0) * (lanes[i] ? lanes[i].mult : 1));
  const order = ps.map((p, i) => i).sort((a, b) => score[b] - score[a]);
  const place = new Map(order.map((i, n) => [i, n + 1]));
  const best = win => order.find(i => ps[i].win === win);
  return { place: i => place.get(i), mvp: best(true), ace: best(false), lane: i => lanes[i] };
}

// both teams as one table: header per team, a row per player (mine = own accounts, marked)
function pgTableHtml(g, as, mine) {
  as = as || {};
  const { place, mvp, ace, lane } = pgPlacements(g);
  const all = g.players;
  const max = k => Math.max(1, ...all.map(k));
  const maxDmg = max(p => p.dmg || 0), maxTaken = max(p => (p.x && p.x.taken) || 0), maxGold = max(p => p.gold || 0);
  const teams = [...new Set(all.map(p => p.team))].sort((a, b) => (a === 100 ? -1 : b === 100 ? 1 : a - b));
  const bar = (v, m, cls) => `<span class="pg-bar ${cls}"><i style="width:${Math.max(2, Math.round((100 * v) / m))}%"></i></span>`;
  // ×1.15 under the placement: green better than the lane opponent, red worse
  const laneChip = l => {
    if (!l) return '';
    const cls = l.mult >= 1.02 ? 'up' : l.mult <= 0.98 ? 'down' : '';
    return `<small class="pg-lane ${cls}" title="${esc(t('pg.laneT', { name: l.opp.name || '?', n: Math.round(l.share * 100) }))}">×${l.mult.toFixed(2)}</small>`;
  };
  const teamHtml = team => {
    const ps = all.map((p, i) => ({ p, i })).filter(x => x.p.team === team);
    const tm = (g.teams || []).find(x => x.id === team) || {};
    const win = ps[0] && ps[0].p.win;
    const sum = f => ps.reduce((s, x) => s + (f(x.p) || 0), 0);
    const obj = (k, label) => (tm[k] != null ? `<span title="${esc(t('det.' + k))}">${label} <b>${tm[k]}</b></span>` : '');
    const bans = (tm.bans || []).filter(Boolean);
    const head = `<div class="pg-head ${team === 100 ? 'blue' : 'red'} ${win ? 'win' : 'loss'}">
      <b class="pg-side">${t(team === 100 ? 'pg.blue' : 'pg.red')} · ${t(win ? 'mh.win' : 'mh.loss')}</b>
      <span class="pg-kda">${sum(p => p.k)} / ${sum(p => p.d)} / ${sum(p => p.a)}</span>
      <span class="pg-obj">${obj('towers', '🏰')}${obj('inhibs', '⬢')}${obj('drakes', '🐉')}${obj('heralds', '👁')}${obj('barons', '🟣')}</span>
      <span class="pg-sum">${k1(sum(p => p.gold))} ${t('mh.gold')}</span>
      <span class="pg-sum">${k1(sum(p => p.dmg))} ${t('mh.dmg')}</span>
      ${bans.length ? `<span class="pg-bans" title="${esc(t('pg.bans'))}">${bans.map(id => `<img src="${CHAMP_ICON(id)}" alt="">`).join('')}</span>` : ''}
    </div>`;
    const rows = ps.map(({ p, i }) => {
      const x = p.x || {};
      const st = Stats.perGame(g, p);
      const kda = st.perfect ? null : st.kda;
      const badge = i === mvp ? `<b class="pg-pl mvp">MVP</b>` : i === ace ? `<b class="pg-pl ace">ACE</b>` : `<b class="pg-pl">#${place(i)}</b>`;
      const r = mh.ranks[p.puuid] || {};
      const wards = x.wards != null ? ` title="${esc(t('det.visionT'))}: ${x.wards} / ${x.wardsKilled || 0} / ${x.pinks || 0}"` : '';
      return `<div class="pg-row${mine.has(p.puuid) ? ' me' : ''}">
        <span class="pg-ch"><img src="${CHAMP_ICON(p.champ)}" alt=""><i>${p.lvl}</i></span>
        <span class="pg-sp">${icon(as.spells, p.spells && p.spells[0], 'pg-s')}${icon(as.perks, p.keystone, 'pg-s')}${icon(as.spells, p.spells && p.spells[1], 'pg-s')}${icon(as.styles, p.sub, 'pg-s')}</span>
        <span class="pg-who"><span class="pg-name" data-player="${esc(JSON.stringify({ gameName: p.name, tagLine: p.tag }))}" title="${esc(p.name + (p.tag ? '#' + p.tag : ''))}">${esc(p.name || '?')}</span>${r.s ? rankChip(r.s, 'solo') : ''}</span>
        <span class="pg-place" title="${esc(t('pg.placeT'))}">${badge}${laneChip(lane(i))}</span>
        <span class="pg-items">${(p.items || []).map((id, k) => (id ? icon(as.items, id, 'pg-it' + (k === 6 ? ' trinket' : '')) : `<span class="pg-it none${k === 6 ? ' trinket' : ''}"></span>`)).join('')}</span>
        <span class="pg-k"><b>${p.k} / <em>${p.d}</em> / ${p.a}</b><small><span class="${kda == null || kda >= 5 ? 'hi' : ''}">${kda == null ? t('mh.perfect') : kda.toFixed(2) + ' KDA'}</span> · ${st.kp == null ? '–' : Math.round(100 * st.kp) + '%'} KP</small></span>
        <span class="pg-k"${wards}><b>${p.cs} CS</b><small>${st.csMin.toFixed(1)}/min · ${p.vis || 0} ${t('det.vision')}</small></span>
        <span class="pg-b"><b>${k1(p.dmg)}</b>${bar(p.dmg, maxDmg, team === 100 ? 'blue' : 'red')}</span>
        <span class="pg-b"><b>${x.taken != null ? k1(x.taken) : '–'}</b>${bar(x.taken || 0, maxTaken, 'taken')}</span>
        <span class="pg-b"><b>${k1(p.gold)}</b>${bar(p.gold, maxGold, 'gold')}</span>
      </div>`;
    }).join('');
    return head + rows;
  };
  const cols = `<div class="pg-cols"><span></span><span></span><span></span><span></span><span></span><span>K / D / A · KP</span><span>CS · ${t('det.vision')}</span><span>${t('pg.dealt')}</span><span>${t('pg.taken')}</span><span>${t('mh.gold')}</span></div>`;
  return `<div class="pg-wrap"><div class="pg-table">${cols}${teams.map(teamHtml).join('')}</div></div>`;
}

function postgameHtml() {
  const g = pg.game;
  if (!g || g.remake || !g.players || g.players.length < 10) return '';
  const ended = g.t + (g.dur || 0) * 1000;
  if (Date.now() - ended > PG_FRESH) return '';
  const mine = new Set(S.accounts.map(a => a.puuid));
  return `<div class="live-card pg-card"><div class="lc-head"><h3>${t('pg.title')} · ${esc(queueLabel(g))} · ${dur(g.dur)} · ${esc(ago(ended))}</h3>
      <button class="chip" id="pgOpen">${t('pg.open')}</button></div>
    ${pgTableHtml(g, assets, mine)}
    <p class="fine">${t('pg.note')}</p></div>`;
}

document.addEventListener('click', e => {
  if (e.target.closest('#pgOpen') && pg.game) openGame(pg.game.id);
});

// "Last game" (compact) when no game and no post-game overview is on
function lastGameHtml() {
  const g = pg.game;
  if (!g || !g.players) return '';
  return `<div class="live-card"><div class="lc-head"><h3>${t('last.title')}</h3></div>${gameRowShort(g)}</div>`;
}
