// Live page, right after a game: the overview of both teams (K/D/A, items, runes, ranks, damage,
// taken and gold as bars, MVP / ACE) – the short form; lane against lane, the gold lead and the
// replay stay in the match history ("Open in match history"). It stands the moment the client's end
// screen opens, while you still honor: from the end-of-game numbers (liveData.eog, live.rs); the
// stored game replaces it when the match history has it. Shown up to 12 hours after the game, until
// the next champion select. The same table is the "Players" part of a game's details in the match
// history (pgTableHtml).
// Uses the globals of renderer.js / views.js / matches-view.js.

const pg = { game: null, checked: 0, busy: false, key: '', postSince: 0 };
const PG_FRESH = 12 * 3600 * 1000;
const PG_POST = ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'];
// the game from the end-of-game numbers while the stored one isn't there yet (another id than the
// newest stored game, and newer than it)
function pgEog() {
  const e = (liveData || {}).eog;
  if (!e || !e.players || !e.id) return null;
  const g = pg.game;
  if (g && (String(g.id) === String(e.id) || g.t > e.t)) return null;
  const me = (liveData && liveData.me) || (S.live && S.live.puuid) || S.active;
  return { ...e, owners: me ? [me] : [] };
}
// the game to show: the stored one when it's the newest, else the one from the end screen
const pgShown = () => pgEog() || pg.game;
// after a game: neither the end-of-game numbers nor the stored game yet -> it is on its way
// (looked for every 4 s, at most 5 minutes)
function pgWaiting() {
  const ph = (liveData || {}).phase;
  if (!PG_POST.includes(ph)) { pg.postSince = 0; return false; }
  if (!pg.postSince) pg.postSince = Date.now();
  if (pgEog()) return false;
  const g = pg.game;
  const fresh = g && Date.now() - (g.t + (g.dur || 0) * 1000) < 90 * 60000;
  return !fresh && Date.now() - pg.postSince < 5 * 60000;
}

// the newest stored game of the signed-in account (the match history fills in right after a game)
async function loadPostgame(force) {
  const me = (S.live && S.live.puuid) || S.active;
  if (!me || pg.busy) return;
  if (!force && Date.now() - pg.checked < (pgWaiting() ? 4000 : 15000)) return;
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
// the match history stored new games (right after the end-of-game screen): look at once
api.onMatchesChanged(() => { if (view === 'live') loadPostgame(true); });
async function pgRanks(g) {
  if (pg.rankedFor === String(g.id) + ':' + g.players.length) return;
  pg.rankedFor = String(g.id) + ':' + g.players.length;
  const owner = S.accounts.find(a => a.puuid === (g.owners || [])[0]);
  const ids = g.players.map(p => p.puuid).filter(Boolean).filter(id => !mh.ranks[id]);
  if (!ids.length) return;
  const r = await api.playerRanks([{ region: (owner && owner.region) || '', ids }]);
  Object.assign(mh.ranks, (r && r.ranks) || {});
  if (r && r.pending) setTimeout(() => { pg.rankedFor = ''; pgRanks(g); }, 800);
  if (view === 'live') renderLive();
}

// lane against lane, and MVP / ACE with the placement of all ten: ui/mvp.js
function pgLane(g, p) { return Mvp.lane(g, p); }
function pgPlacements(g) { return Mvp.placements(g); }

// ---------- the players' table: which figures are its columns (Columns, kept per window) ----------
// every column: its heading, the value (null or missing: the game doesn't say), the bar's colour
// ('side' = the team's), the format. Stored games leave out a figure that is 0 – missing counts as 0
// while another player of the game has it, the whole column says "–" when nobody has.
const pgMin = g => Math.max(1, (g.dur || 0) / 60);
const pgX = (p, k) => (p.x ? p.x[k] : undefined);
const PG_COLS = {
  dmg: { h: 'pg.dealt', v: p => p.dmg, bar: 'side' },
  taken: { h: 'pg.taken', v: p => pgX(p, 'taken'), bar: 'taken' },
  gold: { h: 'mh.gold', v: p => p.gold, bar: 'gold' },
  dpm: { h: 'pg.c.dpm', v: (p, g) => (p.dmg == null ? undefined : p.dmg / pgMin(g)), bar: 'side', fmt: 'int' },
  gpm: { h: 'pg.c.gpm', v: (p, g) => (p.gold == null ? undefined : p.gold / pgMin(g)), bar: 'gold', fmt: 'int' },
  mitig: { h: 'pg.c.mitig', v: p => pgX(p, 'mitig'), bar: 'taken' },
  heal: { h: 'pg.c.heal', v: p => pgX(p, 'heal'), bar: 'heal' },
  obj: { h: 'pg.c.obj', v: p => pgX(p, 'obj'), bar: 'obj' },
  turret: { h: 'pg.c.turret', v: p => pgX(p, 'turretDmg'), bar: 'obj' },
  cc: { h: 'pg.c.cc', v: p => pgX(p, 'cc'), bar: 'cc', fmt: 'sec' },
  wards: { h: 'pg.c.wards', v: p => pgX(p, 'wards'), bar: 'vis', fmt: 'int' },
};
const PG_COLS_DEFAULT = ['dmg', 'taken', 'gold'];
const PG_COLS_MAX = 5;
function pgColsChosen() {
  try {
    const k = JSON.parse(localStorage.getItem('rs.pgCols') || 'null');
    if (Array.isArray(k)) { const ok = k.filter(x => PG_COLS[x]).slice(0, PG_COLS_MAX); if (ok.length) return ok; }
  } catch { /* the default */ }
  return PG_COLS_DEFAULT.slice();
}
// the tables on screen, to draw them again when the columns change (the newest 20)
const pgTables = new Map();

// both teams as one table: header per team, a row per player (mine = own accounts, marked). Arena:
// a block per team of the arena by its placing (1st … 6th) – red and blue mean nothing there
function pgTableHtml(g, as, mine) {
  as = as || {};
  const { place, mvp, ace, lane } = pgPlacements(g);
  const all = g.players;
  const key = String(g.id);
  pgTables.delete(key);
  pgTables.set(key, { g, as, mine });
  if (pgTables.size > 20) pgTables.delete(pgTables.keys().next().value);
  // the chosen columns: each value (0 for a figure left out while others have it), the best of the ten
  const cols = pgColsChosen();
  const colVal = {};
  for (const k of cols) {
    const raw = all.map(p => PG_COLS[k].v(p, g));
    const has = raw.some(v => v != null);
    colVal[k] = { v: raw.map(v => (v == null ? (has ? 0 : null) : v)), max: Math.max(1e-9, ...raw.map(v => v || 0)) };
  }
  const colFmt = (k, v) => (PG_COLS[k].fmt === 'int' ? num(Math.round(v)) : PG_COLS[k].fmt === 'sec' ? `${num(Math.round(v))} s` : k1(Math.round(v)));
  // Arena, ARAM: Mayhem: every player's augments in a column of their own, right of the gold
  const augs = all.some(p => p.aug && p.aug.length);
  const arena = Stats.isArena(g) && all.some(p => p.place);
  const keyOf = p => (arena ? p.place || 9 : p.team);
  const teams = [...new Set(all.map(keyOf))].sort((a, b) => (arena ? a - b : a === 100 ? -1 : b === 100 ? 1 : a - b));
  const bar = (v, m, cls) => `<span class="pg-bar ${cls}"><i style="width:${Math.max(2, Math.round((100 * v) / m))}%"></i></span>`;
  // ×1.15 under the placement: green better than the lane opponent, red worse
  const laneChip = l => {
    if (!l) return '';
    const cls = l.mult >= 1.02 ? 'up' : l.mult <= 0.98 ? 'down' : '';
    return `<small class="pg-lane ${cls}" title="${esc(t('pg.laneT', { name: l.opp.name || '?', n: Math.round(l.share * 100) }))}">×${l.mult.toFixed(2)}</small>`;
  };
  const teamHtml = team => {
    const ps = all.map((p, i) => ({ p, i })).filter(x => keyOf(x.p) === team);
    const sumA = f => ps.reduce((s, x) => s + (f(x.p) || 0), 0);
    if (arena) {
      // the arena's teams: their placing (the top half wins), no sides, no objectives
      const head = `<div class="pg-head arena p${team} ${team <= 3 ? 'win' : 'loss'}">
        <b class="pg-side">${esc(t('pg.place', { n: team }))}</b>
        <span class="pg-kda">${sumA(p => p.k)} / ${sumA(p => p.d)} / ${sumA(p => p.a)}</span><span class="pg-obj"></span>
        <span class="pg-sum">${k1(sumA(p => p.gold))} ${t('mh.gold')}</span>
        <span class="pg-sum">${k1(sumA(p => p.dmg))} ${t('mh.dmg')}</span>
      </div>`;
      return head + ps.map(x => rowHtml(x, 'blue')).join('');
    }
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
    return head + ps.map(x => rowHtml(x, team === 100 ? 'blue' : 'red')).join('');
  };
  // a player's row; side: the colour of the damage bar
  const rowHtml = ({ p, i }, side) => {
      const x = p.x || {};
      const st = Stats.perGame(g, p);
      const kda = st.perfect ? null : st.kda;
      const badge = i === mvp ? `<b class="pg-pl mvp">MVP</b>` : i === ace ? `<b class="pg-pl ace">ACE</b>` : `<b class="pg-pl">#${place(i)}</b>`;
      const r = mh.ranks[p.puuid] || {};
      const wards = x.wards != null ? ` title="${esc(t('det.visionT'))}: ${x.wards} / ${x.wardsKilled || 0} / ${x.pinks || 0}"` : '';
      return `<div class="pg-row${mine.has(p.puuid) ? ' me' : ''}">
        <span class="pg-ch"><img src="${CHAMP_ICON(p.champ)}" alt=""><i>${p.lvl}</i></span>
        <span class="pg-sp">${icon(as.spells, p.spells && p.spells[0], 'pg-s')}${icon(as.perks, p.keystone, 'pg-s')}${icon(as.spells, p.spells && p.spells[1], 'pg-s')}${icon(as.styles, p.sub, 'pg-s')}</span>
        <span class="pg-who"><span class="pg-name" data-player="${esc(JSON.stringify({ puuid: p.puuid, gameName: p.name, tagLine: p.tag }))}" title="${esc(p.name + (p.tag ? '#' + p.tag : ''))}">${esc(p.name || '?')}</span>${r.s ? rankChip(r.s, 'solo') : ''}</span>
        <span class="pg-place" title="${esc(t('pg.placeT'))}">${badge}${laneChip(lane(i))}</span>
        <span class="pg-items">${(p.items || []).map((id, k) => (id ? icon(as.items, id, 'pg-it' + (k === 6 ? ' trinket' : '')) : `<span class="pg-it none${k === 6 ? ' trinket' : ''}"></span>`)).join('')}</span>
        <span class="pg-k"><b>${p.k} / <em>${p.d}</em> / ${p.a}</b><small><span class="${kda == null || kda >= 5 ? 'hi' : ''}">${kda == null ? t('mh.perfect') : kda.toFixed(2) + ' KDA'}</span> · ${st.kp == null ? '–' : Math.round(100 * st.kp) + '%'} KP</small></span>
        <span class="pg-k"${wards}><b>${p.cs} CS</b><small>${st.csMin.toFixed(1)}/min · ${p.vis || 0} ${t('det.vision')}</small></span>
        ${cols.map(k => { const v = colVal[k].v[i]; return v == null ? '<span class="pg-b"><b>–</b></span>' : `<span class="pg-b"><b>${colFmt(k, v)}</b>${bar(v, colVal[k].max, PG_COLS[k].bar === 'side' ? side : PG_COLS[k].bar)}</span>`; }).join('')}
        ${augs ? `<span class="pg-aug">${augIcons(p, as, 'pg-augs')}</span>` : ''}
      </div>`;
  };
  // the head: Columns over the items (choose the figures), then a heading per column
  const colBtn = `<button class="pg-colbtn" data-pgcols title="${esc(t('pg.colsT', { n: PG_COLS_MAX }))}"><svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>${esc(t('pg.cols'))}</button>`;
  const head = `<div class="pg-cols"><span></span><span></span><span></span><span></span><span>${colBtn}</span><span>K / D / A · KP</span><span>CS · ${t('det.vision')}</span>${cols.map(k => `<span>${esc(t(PG_COLS[k].h))}</span>`).join('')}${augs ? `<span>${t('pg.augs')}</span>` : ''}</div>`;
  const grid = `40px 48px minmax(96px, 190px) 50px 186px 112px 104px ${cols.map(() => 'minmax(76px, 110px)').join(' ')}${augs ? ' minmax(116px, 170px)' : ''}`;
  const minW = 612 + 96 * cols.length + (augs ? 140 : 0);
  return `<div class="pg-wrap" data-pgid="${esc(key)}"><div class="pg-table${augs ? ' with-aug' : ''}" style="--pg-grid: ${grid}; min-width: ${minW}px">${head}${teams.map(teamHtml).join('')}</div></div>`;
}

// Columns: a menu of every figure (up to PG_COLS_MAX at once, at least one); every table on screen
// follows at once
const pgColMenu = document.createElement('div');
pgColMenu.className = 'menu pg-colmenu'; pgColMenu.id = 'pgColMenu'; pgColMenu.hidden = true;
document.body.appendChild(pgColMenu);
function pgColMenuFill() {
  const on = pgColsChosen();
  pgColMenu.innerHTML = `<div class="menu-label">${esc(t('pg.colsT', { n: PG_COLS_MAX }))}</div>`
    + Object.keys(PG_COLS).map(k => `<button data-pgcol="${k}" class="${on.includes(k) ? 'on' : ''}"${!on.includes(k) && on.length >= PG_COLS_MAX ? ' disabled' : ''}><i class="pg-check">${on.includes(k) ? '✓' : ''}</i>${esc(t(PG_COLS[k].h))}</button>`).join('')
    + `<hr><button data-pgcol="">${esc(t('pg.colsReset'))}</button>`;
}
function pgColsRedraw() {
  document.querySelectorAll('.pg-wrap[data-pgid]').forEach(el => {
    const d = pgTables.get(el.dataset.pgid);
    if (d) el.outerHTML = pgTableHtml(d.g, d.as, d.mine);
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pgcols]');
  if (b) {
    e.stopPropagation();
    if (!pgColMenu.hidden) { pgColMenu.hidden = true; return; }
    pgColMenuFill();
    const r = b.getBoundingClientRect();
    pgColMenu.hidden = false;
    pgColMenu.style.left = Math.max(8, Math.min(r.left, innerWidth - pgColMenu.offsetWidth - 8)) + 'px';
    pgColMenu.style.top = Math.min(r.bottom + 4, innerHeight - pgColMenu.offsetHeight - 8) + 'px';
    return;
  }
  const c = e.target.closest('[data-pgcol]');
  if (c && pgColMenu.contains(c)) {
    const k = c.dataset.pgcol, on = pgColsChosen();
    const next = !k ? PG_COLS_DEFAULT.slice() : on.includes(k) ? on.filter(x => x !== k) : [...on, k].slice(0, PG_COLS_MAX);
    if (!next.length) return;
    // in the catalogue's order, so a column always sits in the same place
    const ordered = Object.keys(PG_COLS).filter(x => next.includes(x));
    try { localStorage.setItem('rs.pgCols', JSON.stringify(ordered)); } catch { /* only for now */ }
    pgColMenuFill();
    pgColsRedraw();
    return;
  }
  if (!pgColMenu.hidden && !e.target.closest('#pgColMenu')) pgColMenu.hidden = true;
});

function postgameHtml() {
  if (pgWaiting()) return `<div class="live-card pg-card pg-wait"><div class="lc-head"><h3>${t('pg.title')}</h3></div>
    <p class="fine"><i class="dots">●</i> ${t('pg.wait')}</p></div>`;
  const g = pgShown();
  if (!g || g.remake || !g.players || g.players.length < 2) return '';
  const ended = g.t + (g.dur || 0) * 1000;
  // it stays until the next champ select (lobby and queue keep it), at most PG_FRESH
  if (Date.now() - ended > PG_FRESH || pg.closedId === String(g.id)) return '';
  const mine = new Set(S.accounts.map(a => a.puuid));
  if (g.eog) pgRanks(g);
  // the end screen's numbers: the details (lane against lane, gold lead, replay) once it's stored
  const open = g.eog ? `<span class="chip pg-soon" title="${esc(t('pg.eogT'))}">${t('pg.eog')}</span>` : `<button class="chip" id="pgOpen">${t('pg.open')}</button>`;
  return `<div class="live-card pg-card"><div class="lc-head"><h3>${t('pg.title')} · ${esc(queueLabel(g))} · ${dur(g.dur)} · ${esc(ago(ended))}</h3>${open}</div>
    ${!g.eog && typeof pgTagsHtml === 'function' ? pgTagsHtml(g) : ''}
    ${pgTableHtml(g, assets, mine)}</div>`;
}

document.addEventListener('click', e => {
  if (e.target.closest('#pgOpen') && pg.game) openGame(pg.game.id);
});

// "Last game" (compact) when no game and no post-game overview is on
function lastGameHtml() {
  if (pgWaiting()) return '';
  const g = pgShown();
  if (!g || !g.players) return '';
  return `<div class="live-card"><div class="lc-head"><h3>${t('last.title')}</h3></div>${gameRowShort(g)}</div>`;
}
