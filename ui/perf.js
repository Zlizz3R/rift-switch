// Overview → Performance, the Overview's start page: one filter (account, queue, time, role) over
// all stored games; on top one strip with the key figures and their trend and the traits, then the
// champions (op.gg-style), the roles, the play style and the map as cards. The maths is in
// perfmath.js / stats.js. A click on a champion opens the match history with the same filters.
// Uses the globals of renderer.js / views.js / matches-view.js / summary.js / tags-view.js.

// "All ranked": every ranked queue and Clash – the start
const PERF_RANKED = ['solo', 'flex', 'r5', 'clash'];
const perfIsRanked = q => q.length === PERF_RANKED.length && PERF_RANKED.every(k => q.includes(k));
function perfQueuesKept() {
  try { const q = JSON.parse(localStorage.getItem('rs.perfQ')); if (Array.isArray(q)) return q; } catch { /* default */ }
  return null;
}
// how many of the newest games count (0 = all); kept like the queues
function perfLastKept() {
  try { const n = Number(localStorage.getItem('rs.perfLast')); return n > 0 ? Math.min(9999, Math.round(n)) : 0; } catch { return 0; }
}
const PERF_LAST = [10, 20, 50, 100, 200];
const perf = {
  // queues: groups switched on (none = all); kept like the account choice; last: the newest n games only
  f: { queues: perfQueuesKept() || [...PERF_RANKED], range: 'y' + new Date().getFullYear(), from: '', to: '', role: '', last: perfLastKept() },
  // no queues chosen by hand yet: the ones the chosen accounts play most this season (an ARAM player
  // starts on ARAM)
  qAuto: !perfQueuesKept(),
  lastOwn: false,
  all: false, cSort: 'n', games: null, mast: null, loading: false,
  // a champion picked in the list: every other card shows only its games (0 = all champions)
  champ: 0,
};
perf.lastOwn = perf.f.last > 0 && !PERF_LAST.includes(perf.f.last);

async function loadPerf() {
  if (perf.loading) return;
  perf.loading = true;
  try {
    if (!champs.length) champs = (await api.champions()) || [];
    // the mastery: for the traits (one-trick, champion pool)
    const [g, m] = await Promise.all([allGames(), api.masteries()]);
    perf.games = g || [];
    perf.mast = Array.isArray(m) ? m : [];
  } catch (e) { console.warn('perf', e); }
  perf.loading = false;
  renderPerf();
  // the Overview's head counts the games and shows the champion played most
  if (view === 'dash' && typeof renderOvHero === 'function') renderOvHero();
}
const perfOn = () => view === 'dash' && dashTab() === 'stats';
api.onMatchesChanged(() => { if (perfOn()) loadPerf(); });

// ---------- formatting ----------
const perfDec = (x, d = 1) => (x == null ? '–' : x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }));
const perfPct = x => (x == null ? '–' : Math.round(x * 100) + ' %');
const perfAvg = r => `${perfDec(r.avg.k)} / ${perfDec(r.avg.d)} / ${perfDec(r.avg.a)}`;
const perfKda = r => (r.perfect ? t('mh.perfect') : perfDec(r.kda, 2));
const perfGames = n => (n === 1 ? t('perf.game1') : t('dash.nGames', { n: num(n) }));
const perfChamp = id => (champById(id) || {}).name || '#' + id;
const PERF_QUEUES = () => [['solo', 'Solo/Duo'], ['flex', 'Flex'], ['r5', 'Ranked 5v5'], ['classic', 'Classic 5v5'], ['normal', t('mh.normal')],
  ['aram', 'ARAM'], ['arena', 'Arena'], ['clash', 'Clash'], ['custom', t('mh.custom')]];
// what the filter counts, for select(): the chosen accounts and queues
const perfF = () => ({ ...perf.f, accs: ovChosen().map(a => a.puuid) });

// ---------- the filter ----------
function renderPerfFilter() {
  const f = perf.f;
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  // queues like the match history: each one on or off, "All" = every queue
  const rk = perfIsRanked(f.queues);
  $('perfQueues').innerHTML = `<button data-pq=""${!f.queues.length ? ' class="on"' : ''}>${t('mh.allQueues')}</button>`
    + `<button data-pq="ranked" title="${esc(t('perf.allRankedT'))}"${rk ? ' class="on"' : ''}>${esc(t('perf.allRanked'))}</button>` +
    PERF_QUEUES().map(([k, l]) => `<button data-pq="${k}"${!rk && f.queues.includes(k) ? ' class="on"' : ''}>${esc(l)}</button>`).join('');
  // seasons (calendar years) with games, the current one always; then the usual ranges
  const years = [...new Set([new Date().getFullYear(), ...PerfMath.years(perf.games || [])])].sort((a, b) => b - a);
  const ranges = [...years.map(y => ['y' + y, t('perf.season', { y })]), ['90', t('mh.r90')], ['30', t('mh.r30')], ['7', t('mh.r7')], ['all', t('mh.rAll')], ['custom', t('mh.rCustom')]];
  $('perfRange').innerHTML = ranges.map(([k, l]) => opt(k, l, f.range === k)).join('');
  // own dates: both days included (matchfilter.js)
  $('perfDates').hidden = f.range !== 'custom';
  if (document.activeElement !== $('perfFrom')) $('perfFrom').value = f.from || '';
  if (document.activeElement !== $('perfTo')) $('perfTo').value = f.to || '';
  // the newest n games only
  $('perfLast').innerHTML = perfLastOpts(f.last, perf.lastOwn);
  const own = perfLastIsOwn(f.last, perf.lastOwn);
  $('perfLastN').hidden = !own;
  if (own && document.activeElement !== $('perfLastN')) $('perfLastN').value = f.last || '';
  $('perfRole').innerHTML = `<button data-prole=""${!f.role ? ' class="on"' : ''}>${t('perf.allRoles')}</button>` +
    Stats.POSITIONS.map(r => `<button data-prole="${r}" title="${esc(t('pos.' + r))}"${f.role === r ? ' class="on"' : ''}><img src="${posIcon(r)}" alt="${esc(t('pos.' + r))}"></button>`).join('');
}
// the choice "how many of the newest games": All, 10 … 200, an own number (shown in its field)
const perfLastIsOwn = (n, own) => own || (n > 0 && !PERF_LAST.includes(n));
function perfLastOpts(n, own) {
  const isOwn = perfLastIsOwn(n, own);
  const opt = (v, label, on) => `<option value="${v}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  return opt(0, t('perf.lastAll'), !n && !isOwn) + PERF_LAST.map(k => opt(k, t('perf.last', { n: k }), !isOwn && n === k)).join('')
    + opt('own', t('perf.lastCustom'), isOwn);
}
// a new number: the newest n games (0 = all), kept for the next start
function perfSetLast(n) {
  perf.f.last = n > 0 ? Math.min(9999, Math.round(n)) : 0;
  try { localStorage.setItem('rs.perfLast', String(perf.f.last)); } catch { /* not kept */ }
}
// "86 games · Ranked (Solo + Flex) · Season 2026 · Top · 3 accounts"
function perfLine(ag) {
  const f = perf.f;
  const parts = [perfGames(ag ? ag.n : 0)];
  parts.push(perfIsRanked(f.queues) ? t('perf.allRanked') : f.queues.length ? PERF_QUEUES().filter(([k]) => f.queues.includes(k)).map(q => q[1]).join(' + ') : t('perf.qAll'));
  parts.push(f.range === 'custom' ? [f.from, f.to].map(d => (d ? fmtDate(new Date(d + 'T00:00').getTime()) : '…')).join(' – ') : $('perfRange').selectedOptions[0] ? $('perfRange').selectedOptions[0].textContent : '');
  if (f.last) parts.push(t('perf.last', { n: num(f.last) }));
  if (f.role) parts.push(t('pos.' + f.role));
  if (perf.champ) parts.push(perfChamp(perf.champ));
  const chosen = ovChosen();
  parts.push(chosen.length === 1 ? dispName(chosen[0]) : ag && ag.accounts === 1 ? t('mast.account1') : t('mast.accounts', { n: ag ? ag.accounts : 0 }));
  return parts.filter(Boolean).join(' · ');
}

// ---------- rendering ----------
function renderPerf() {
  const el = $('perfBody');
  if (!el || $('dashPerf').hidden) return;
  renderPerfFilter();
  if (!perf.games) { $('perfLine').textContent = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  if (perf.qAuto) {
    const ids = ovChosen().map(a => a.puuid);
    const scope = sumAutoScope(Stats.byParticipation(perf.games).filter(x => ids.includes(x.p.puuid)));
    const q = { ranked: [...PERF_RANKED], aram: ['aram'], arena: ['arena'], all: [] }[scope] || [...PERF_RANKED];
    if (q.join() !== perf.f.queues.join()) { perf.f.queues = q; renderPerfFilter(); }
  }
  const parts = PerfMath.select(perf.games, perfF());
  const ag = Stats.aggregate(parts);
  $('perfLine').textContent = perfLine(ag);
  if (!ag) { el.innerHTML = `<div class="chart-empty">${t('mh.noMatch')}</div>`; return; }
  // a champion no longer among these games: all champions again
  if (perf.champ && !parts.some(x => x.p.champ === perf.champ)) perf.champ = 0;
  if (perf.champ) $('perfLine').textContent = perfLine(Stats.aggregate(parts.filter(x => x.p.champ === perf.champ)));
  el.innerHTML = perfAllHtml(parts, ag, { role: perf.f.role, champ: perf.champ, traits: perfOwnTraits(perf.champ, parts) });
}
// the own accounts' traits for the strip: from exactly the games the filter chose (accounts, queues,
// season or dates, the newest n, the role) – ARAM's catalogue when only ARAM is chosen, Arena's for
// Arena; with a champion picked, from that champion's games only
function perfOwnTraits(champ = 0, parts = null) {
  const chosen = ovChosen(), ids = chosen.map(a => a.puuid);
  const q = perf.f.queues;
  const scope = q.length && q.every(x => x === 'aram') ? 'aram' : q.length && q.every(x => x === 'arena') ? 'arena' : 'ranked';
  const read = (perf.mast || []).filter(m => ids.includes(m.puuid));
  const table = read.length ? MastMath.masteryTable(read) : null;
  const acc = chosen.length === 1 ? chosen[0] : null;
  const games = champ ? perf.games.filter(g => g.players.some(p => ids.includes(p.puuid) && p.champ === champ)) : perf.games;
  const rows = parts ? (champ ? parts.filter(x => x.p.champ === champ) : parts) : null;
  return { res: sumRes(games, ids, acc && acc.level != null ? acc.level : null, table, scope, rows, perf.f.role), scope, champ };
}
// one page: the key figures and the traits on top, then the champions, the roles, the play style and
// the map as cards – champions left of the others on a medium window, three columns on a wide one, one
// under the other on a narrow one. ARAM and Arena only: the share of the team instead of the roles and
// the play style (no lanes there); ARAM's own map.
// opts: { player: the player page, role: the role filter, champ: a champion picked in the list (every
//   other card shows only its games; the list keeps all champions), traits: { res, scope, others } }
function perfAllHtml(parts, ag, opts = {}) {
  const card = (id, title, body, sub = '') => `<section class="perf-card pc-${id}" id="perfSec-${id}"><h3 class="perf-card-h">${esc(title)}${sub ? `<small>${sub}</small>` : ''}</h3>${body}</section>`;
  const champ = opts.champ && parts.some(x => x.p.champ === opts.champ) ? opts.champ : 0;
  const sel = champ ? parts.filter(x => x.p.champ === champ) : parts;
  const agS = champ ? Stats.aggregate(sel) : ag;
  const off = sel.length > 0 && sel.every(x => Stats.offRift(x.g));
  const champsCard = card('champs', t('dash.tabChamps'), perfChampsHtml(parts, ag, { ...opts, champ }),
    champ ? `<button class="oc-clear" data-pchamp="0">${esc(perfChamp(champ))} ✕</button>` : '');
  // ARAM and Arena: no lanes – the share of the team instead of roles and play style; ARAM keeps its map
  const cards = off
    ? [champsCard,
      sel.some(x => ['aram', 'arena'].includes(MapMath.mapOf(x.g))) ? card('map', t('dash.tabMap'), perfMapHtml(sel, opts.player ? { foot: false } : {})) : '',
      card('share', t('ov.teamShare'), perfShareHtml(sel), esc(t('ov.fair')))]
    : [champsCard,
      card('map', t('dash.tabMap'), perfMapHtml(sel, opts.player ? { foot: false } : {})),
      opts.role ? '' : card('roles', t('ov.roles'), perfRolesHtml(sel)),
      // another player: the play profile (no figures, no lane opponent); own accounts: the exact radar
      card('style', t('dash.tabStyle'), opts.others ? gpiHtml(sel, opts.role) : perfStyleHtml(sel, opts.role))];
  return `${perfStripHtml(sel, agS, opts.traits)}<div class="perf-grid${off ? ' off' : opts.role ? ' one-role' : ''}">${cards.join('')}</div>`;
}
// a way into a section ("Champions →" on At a glance): Performance, scrolled to it
function perfScrollTo(sec) {
  if (!sec) return;
  requestAnimationFrame(() => { const el = $('perfSec-' + sec); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
}

// ---------- the strip on top: the key figures and the traits ----------
// Games (wins green, losses red), the win rate as a ring, KDA with the average K / D / A, CS, damage,
// kill participation and vision (ARAM / Arena: the share of the team's damage) – each with its trend
// (the newest 10 games against the 10 before, from 20 games on). On the right the traits of the
// main role (or of the chosen role), a way into the Traits tab.
function perfStripHtml(parts, ag, traits) {
  const tr = k => (parts.length >= 20 ? PerfMath.trend(parts, 10, k) : { ok: false });
  const arrow = (cur, prev, better, fmt) => {
    if (cur == null || prev == null || Math.abs(cur - prev) < 1e-9) return '';
    const up = (cur - prev) * better > 0;
    return `<em class="${up ? 'up' : 'down'}" title="${esc(t('ov.trendT'))}">${cur > prev ? '▲' : '▼'} ${fmt(Math.abs(cur - prev))}</em>`;
  };
  const trA = (k, fmt) => { const x = tr(k); return x.ok ? arrow(x.cur, x.prev, x.better, fmt) : ''; };
  const wrT = tr('kda');
  const pct = v => Math.round(v * 100) + ' %';
  const off = parts.length > 0 && parts.every(x => Stats.offRift(x.g));
  const fig = (cls, label, value, sub = '', title = '') => `<div class="pf ${cls}"${title ? ` title="${esc(title)}"` : ''}><span>${esc(label)}</span><b>${value}</b><small>${sub}</small></div>`;
  const wrCls = ag.winrate >= 0.53 ? 'good' : ag.winrate <= 0.47 ? 'bad' : '';
  const kdaCls = PerfMath.markKda(ag);
  const figs = [
    fig('games', t('perf.games'), num(ag.n), `<i class="w">${esc(t('perf.wins', { n: num(ag.wins) }))}</i> · <i class="l">${esc(t('perf.losses', { n: num(ag.losses) }))}</i>`,
      ag.games !== ag.n ? t('perf.inGames', { n: num(ag.games) }) : ''),
    `<div class="pf wr">${sumRing(ag.winrate)}<div><span>${esc(t('dash.wr'))}</span><b class="${wrCls}">${perfPct(ag.winrate)}</b><small>${wrT.ok ? arrow(wrT.wr[0], wrT.wr[1], 1, pct) : ''}</small></div></div>`,
    fig('kda', t('mh.kda'), `<span class="${kdaCls}">${esc(perfKda(ag))}</span>`,
      `${perfDec(ag.avg.k)} / <i class="l">${perfDec(ag.avg.d)}</i> / ${perfDec(ag.avg.a)}${trA('kda', v => perfDec(v, 2))}`, t('perf.avg')),
    off ? '' : fig('cs', t('det.csMin'), perfDec(ag.csMin), trA('csMin', v => perfDec(v))),
    fig('dmg', t('perf.dmgMin'), num(Math.round(ag.dmgMin)), trA('dmgMin', v => num(Math.round(v)))),
    fig('kp', t('perf.kp'), perfPct(ag.kp), trA('kp', pct)),
    off ? fig('share', t('ov.dmgShare'), perfPct(ag.dmgShare)) : fig('vis', t('perf.visMin'), perfDec(ag.visMin, 2), trA('visMin', v => perfDec(v, 2))),
  ];
  return `<div class="perf-strip"><div class="pf-figs">${figs.join('')}</div>${perfTraitsHtml(traits)}</div>`;
}
// the traits in the strip: the main role's (or every role's when there is no main role), the
// strengths first; another player gets only what speaks for them (Tags.forOthers, player-view.js)
function perfTraitsHtml(tr) {
  if (!tr) return '';
  const res = tr.res;
  const role = perf.f.role && !tr.player ? perf.f.role : tr.role || '';
  const main = res && !res.aram ? role || res.main || res.most : '';
  const picked = res ? Tags.pick(res.results).filter(x => (!x.role || !main || x.role === main) && !(tr.champ && (x.group === 'pool' || x.group === 'mastery'))) : [];
  const order = x => (Tags.isStrength(x) ? 0 : Tags.isWeakness(x) ? 1 : 2);
  const sorted = [...picked].sort((a, b) => order(a) - order(b));
  const MAX = 7;
  const chip = x => `<span class="tchip tc-${tagColor(x)}" title="${esc([tagText(x), tagRoleText(x)].filter(Boolean).join('\n'))}">${esc(tagName(x))}</span>`;
  const more = sorted.length > MAX ? `<button class="tchip tc-more" data-ovgo="tags">+${sorted.length - MAX}</button>` : '';
  const empty = `<span class="muted">${esc(t(tr.scope === 'aram' ? 'ov.noAramTraits' : tr.scope === 'arena' ? 'ov.noArenaTraits' : res ? 'tags.nothing' : 'tags.none'))}</span>`;
  const where = tr.scope === 'aram' ? 'ARAM' : tr.scope === 'arena' ? 'Arena'
    : [main ? `<img src="${posIcon(main)}" alt="">${esc(t('pos.' + main))}` : '', esc(t('pl.ranked'))].filter(Boolean).join(' · ');
  return `<div class="pf-traits"><div class="pf-th"><button class="pf-go" data-ovgo="tags" title="${esc(t('perf.allTraitsT'))}">${esc(t('dash.tabTags'))} <span>→</span></button><small>${where}</small></div>
    <div class="tchips">${sorted.slice(0, MAX).map(chip).join('') || empty}${more}</div></div>`;
}

// ---------- roles; ARAM and Arena: the share of the team, the activity ----------
// each position's share of the games, with its win rate
function perfRolesHtml(parts) {
  const mr = Tags.mainRole(parts);
  if (!mr.total) return `<p class="muted">${esc(t('pl.noRoles'))}</p>`;
  const by = Stats.groupBy(parts.filter(x => Stats.role(x.g, x.p)), x => Stats.role(x.g, x.p));
  return [...mr.shares].sort((a, b) => b[1] - a[1]).map(([r, n]) => {
    const share = Math.round((100 * n) / mr.total), ag = by.get(r);
    return `<div class="sro${r === mr.main ? ' main' : ''}"><img src="${posIcon(r)}" alt=""><span>${esc(t('pos.' + r))}${r === mr.main ? ' ★' : ''}</span><i class="scr-bar"><i style="width:${share}%"></i></i>
      <b>${share} %</b><small class="${ag && ag.n >= 5 ? (ag.winrate >= 0.55 ? 'good' : ag.winrate <= 0.45 ? 'bad' : '') : ''}">${ag ? esc(t('ov.wrShort', { wr: Math.round(ag.winrate * 100) })) : ''}</small></div>`;
  }).join('');
}
// ARAM: the share of the own team – damage, damage taken, healing, crowd control, gold – with a
// line at a fair fifth
function perfShareHtml(parts) {
  const KEYS = [['dmg', p => p.dmg], ['taken', p => p.x && p.x.taken], ['heal', p => p.x && p.x.heal], ['cc', p => p.x && p.x.cc], ['gold', p => p.gold]];
  const full = parts.filter(x => !x.g.lite && x.g.players && x.g.players.length >= 10);
  const rows = KEYS.map(([k, of]) => {
    const v = full.map(x => {
      if (k !== 'dmg' && k !== 'gold' && !x.p.x) return null;
      const team = Stats.team(x.g, x.p), sum = team.reduce((s, o) => s + (of(o) || 0), 0);
      return sum > 0 ? (of(x.p) || 0) / sum : null;
    }).filter(v => v != null);
    return { k, v: v.length >= 3 ? v.reduce((s, a) => s + a, 0) / v.length : null };
  });
  if (!rows.some(r => r.v != null)) return `<p class="muted">${esc(t('ov.none'))}</p>`;
  return rows.map(r => `<div class="sro share" title="${esc(t('ov.shareT'))}"><span>${esc(t('ov.sh.' + r.k))}</span><i class="scr-bar fair"><i style="width:${r.v == null ? 0 : Math.min(100, r.v * 250).toFixed(1)}%"></i></i>
      <b class="${r.v == null ? '' : r.v >= 0.24 ? 'good' : r.v <= 0.16 ? 'bad' : ''}">${perfPct(r.v)}</b></div>`).join('');
}
// the Performance views are drawn on the Overview and on the player page: draw again where they are
const perfRerender = () => (view === 'player' && typeof renderPlayer === 'function' ? renderPlayer() : renderPerf());

// the champion list in the style of op.gg: "All" first, then the champions by games. A click on a
// champion shows only its games on every other card (again, or "All": every champion); the ↗ of a row
// opens those games in the match history (own accounts only)
function perfChampsHtml(parts, ag, opts = {}) {
  let rows = PerfMath.champRows(parts);
  const total = rows.length;
  if (perf.all) rows = PerfMath.sortRows(rows, perf.cSort, -1); else rows = rows.slice(0, 8);
  // the picked champion stays in the list even when it isn't among the first eight
  if (opts.champ && !rows.some(r => r.champ === opts.champ)) rows.push(PerfMath.champRows(parts).find(r => r.champ === opts.champ));
  const row = (r, all) => {
    const on = all ? !opts.champ : r.champ === opts.champ;
    const mh = all || opts.player ? '' : `<button class="oc-mh" data-pchampmh="${r.champ}" title="${esc(t('perf.open'))}">↗</button>`;
    return `<div class="oc-row${all ? ' all' : ''}${on && opts.champ ? ' on' : ''}" data-pchamp="${all ? 0 : r.champ}" title="${esc(t(all ? 'rad.allChamps' : 'perf.champT'))}">
      ${all ? `<span class="oc-ic all">${esc(t('perf.all').slice(0, 1))}</span>` : `<img class="oc-ic" src="${CHAMP_ICON(r.champ)}" alt="" loading="lazy">`}
      <span class="oc-name"><b title="${esc(all ? t('perf.all') : perfChamp(r.champ))}">${esc(all ? t('perf.all') : perfChamp(r.champ))}</b><small>${esc(t('perf.cs', { cs: num(Math.round(r.cs)), m: perfDec(r.csMin) }))}</small></span>
      <span class="oc-kda"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markKda(r) : ''}">${r.perfect ? esc(t('perf.perfect')) : esc(t('perf.kdaRatio', { v: perfDec(r.kda, 2) }))}</b><small>${perfAvg(r)}</small></span>
      <span class="oc-wr"><b class="${r.n >= PerfMath.MARK.minGames ? PerfMath.markWinrate(r) : 'muted'}">${perfPct(r.winrate)}</b><small>${esc(perfGames(r.n))}</small></span>${mh}
    </div>`;
  };
  const sorts = perf.all ? `<div class="seg oc-sort"><span>${t('perf.sort')}</span>${[['n', 'perf.games'], ['winrate', 'dash.wr'], ['kda', 'mh.kda'], ['csMin', 'det.csMin']]
    .map(([k, l]) => `<button data-csort="${k}"${perf.cSort === k ? ' class="on"' : ''}>${t(l)}</button>`).join('')}</div>` : '';
  const more = total > 8 ? `<button class="btn oc-more" data-pall>${perf.all ? t('perf.less') : t('perf.more', { n: total })}</button>` : '';
  return `${sorts}<div class="oc-list">${row(ag, true)}${rows.map(r => row(r, false)).join('')}</div>${more}`;
}

// ---------- clicks ----------
// a champion: the match history with the same account, queue, time and this champion
function perfOpen(champ) {
  const f = perf.f;
  const y = /^y(\d{4})$/.exec(f.range);
  const time = y ? { range: 'custom', from: `${y[1]}-01-01`, to: `${y[1]}-12-31` } : f.range === 'custom' ? { range: 'custom', from: f.from || '', to: f.to || '' } : { range: f.range };
  // the match history filters one account (or all)
  const chosen = ovChosen();
  openMatchesWith({ puuid: chosen.length === 1 ? chosen[0].puuid : '', queues: [...f.queues], champ: champ || 0, ...time });
}
$('perfRange').onchange = () => {
  perf.f.range = $('perfRange').value;
  renderPerf();
  if (perf.f.range === 'custom' && !perf.f.from) $('perfFrom').focus();
};
$('perfFrom').onchange = () => { perf.f.from = $('perfFrom').value; renderPerf(); };
$('perfTo').onchange = () => { perf.f.to = $('perfTo').value; renderPerf(); };
$('perfLast').onchange = () => {
  const v = $('perfLast').value;
  perf.lastOwn = v === 'own';
  if (!perf.lastOwn) perfSetLast(Number(v));
  renderPerf();
  if (perf.lastOwn) { $('perfLastN').focus(); $('perfLastN').select(); }
};
// an own number counts once typed (Enter or leaving the field)
$('perfLastN').onchange = () => { perfSetLast(Number($('perfLastN').value)); perf.lastOwn = true; renderPerf(); };
$('dashPerf').addEventListener('click', e => {
  const pq = e.target.closest('[data-pq]');
  if (pq) {
    const k = pq.dataset.pq, q = perfIsRanked(perf.f.queues) ? [] : perf.f.queues;
    // "All ranked" on: a click on one queue picks just that one
    perf.f.queues = !k ? [] : k === 'ranked' ? [...PERF_RANKED] : perfIsRanked(perf.f.queues) ? [k] : q.includes(k) ? q.filter(x => x !== k) : [...q, k];
    perf.qAuto = false;
    try { localStorage.setItem('rs.perfQ', JSON.stringify(perf.f.queues)); } catch { /* not kept */ }
    return renderPerf();
  }
  const ro = e.target.closest('[data-prole]');
  if (ro) { perf.f.role = ro.dataset.prole; return renderPerf(); }
  const cs = e.target.closest('[data-csort]');
  if (cs) { perf.cSort = cs.dataset.csort; return renderPerf(); }
  if (e.target.closest('[data-pall]')) { perf.all = !perf.all; return renderPerf(); }
  const mh = e.target.closest('[data-pchampmh]');
  if (mh) return perfOpen(+mh.dataset.pchampmh);
  const ch = e.target.closest('[data-pchamp]');
  if (ch) { const c = +ch.dataset.pchamp; perf.champ = c && c !== perf.champ ? c : 0; return renderPerf(); }
});
