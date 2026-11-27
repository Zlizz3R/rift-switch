// Overview page: every account's LP history in one chart, and per account what happened in the
// chosen period (games, win rate, LP won or lost, rank change), a goal and when it was last played.
// Uses the globals of renderer.js (S, t, $, esc, api, rankScore, …).

const DASH_COLORS = ['#c8aa6e', '#0ac8b9', '#e5737a', '#8f7cf7', '#4cc38a', '#f29a4a', '#5aa9e6', '#e27bd0', '#b8c26a', '#9aa3b5'];
const TIER_COLORS = { IRON: '#6b625d', BRONZE: '#9a6240', SILVER: '#8c9db1', GOLD: '#c8aa6e', PLATINUM: '#3fb6a8',
  EMERALD: '#2fae6a', DIAMOND: '#6a7de8', MASTER: '#b05fe0', GRANDMASTER: '#d8504f', CHALLENGER: '#f0c860' };
const dash = { data: null, qs: new Set(['solo']), days: 30, view: null, histLen: -1 };
// the ranked queues, any combination: one colour per account, one line style per queue
const DASH_QUEUES = [['solo', 'Solo/Duo', ''], ['flex', 'Flex', '7 5'], ['r5', 'Ranked 5v5', '2 4'], ['classic', 'Classic 5v5', '10 4 2 4']];
const dashQName = q => (DASH_QUEUES.find(x => x[0] === q) || [q, q])[1];
const dashGoal = (a, q) => (q === 'solo' ? a.goal : (a.goals || {})[q]) || null;

const shortRank = v => {
  const r = RankMath.scoreToRank(v);
  return r.plus ? 'M+' : TIER_SHORT[r.tier] + (4 - DIVS.indexOf(r.division));
};
const rankText = v => {
  if (v >= 2800) return `${tierName('MASTER')}+ ${v - 2800} LP`;
  const r = RankMath.scoreToRank(v);
  return `${tierName(r.tier)} ${r.division} · ${v % 100} LP`;
};
const goalScore = g => (g ? rankScore({ tier: g.tier, division: g.division || 'IV', lp: 0 }) : null);

async function loadDash() {
  dash.histLen = S.accounts.reduce((n, a) => n + (a.historyLen || 0), 0);
  // champion names for the key figures (the live page usually has them already)
  if (!champs.length) { const c = await api.champions(); if (Array.isArray(c) && c.length) champs = c; }
  const d = await api.dashboard();
  dash.data = Array.isArray(d) ? d : [];
  if (view === 'dash') renderDash();
}
// a new LP entry or a new account: fetch again (only while the page is open)
api.onState(() => {
  if (view !== 'dash') return;
  if (S.accounts.reduce((n, a) => n + (a.historyLen || 0), 0) !== dash.histLen) loadDash();
  else renderDash();
});

// one line per account and chosen queue: its recorded ranks, the current rank at "now"
function dashSeries() {
  const now = Date.now();
  const by = new Map((dash.data || []).map(d => [d.puuid, d]));
  const multi = dash.qs.size > 1;
  const out = [];
  S.accounts.filter(a => !a.placeholder).forEach((a, i) => {
    const d = by.get(a.puuid) || { history: [], games: [] };
    for (const [q, , dashes] of DASH_QUEUES.filter(x => dash.qs.has(x[0]))) {
      const pts = (d.history || []).filter(e => e[q] && TIERS.includes(e[q].tier)).map(e => ({ t: e.t, v: rankScore(e[q]) }));
      const cur = a[q] && TIERS.includes(a[q].tier) ? rankScore(a[q]) : null;
      if (cur != null) pts.push({ t: now, v: cur });
      const games = (d.games || []).filter(g => g.q === q);
      if (!pts.length && !games.length) continue;
      out.push({ a, q, dashes, color: DASH_COLORS[i % DASH_COLORS.length], pts, games, cur, goal: dashGoal(a, q),
        label: dispName(a) + (multi ? ' · ' + dashQName(q) : '') });
    }
  });
  return out;
}
// value of a series at time ts (the last record before it), null before the first one
function valueAt(pts, ts) {
  let v = null;
  for (const p of pts) { if (p.t <= ts) v = p.v; else break; }
  return v;
}

function dashChart(series, t0, t1) {
  const shown = series.filter(s => !ovf.off.has(s.a.puuid) && s.pts.length);
  const clip = s => {
    const start = valueAt(s.pts, t0);
    const inside = s.pts.filter(p => p.t > t0 && p.t <= t1);
    return start == null ? inside : [{ t: t0, v: start }, ...inside];
  };
  const lines = shown.map(s => ({ s, pts: clip(s) })).filter(l => l.pts.length);
  const vals = lines.flatMap(l => l.pts.map(p => p.v));
  if (!vals.length) return `<div class="chart-empty">${t('dash.chartEmpty')}</div>`;
  for (const l of lines) { const g = goalScore(l.s.goal); if (g != null && lines.length === 1) vals.push(g); }
  let lo = Math.floor((Math.min(...vals) - 40) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 40) / 100) * 100;
  if (hi - lo < 400) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 200) / 100) * 100; hi = lo + 400; }
  lo = Math.max(0, lo);
  // the plot stretches with the window; labels and dots are HTML so they keep their size
  const W = 1000, H = 300;
  const x = ts => W * ((ts - t0) / Math.max(1, t1 - t0));
  const y = v => H - H * ((v - lo) / Math.max(1, hi - lo));
  const pct = v => ((100 * y(v)) / H).toFixed(2) + '%';
  let bg = '', ylab = '';
  // a coloured band per tier, a dotted line per division with its short name on the left
  for (let i = 0; i < 8; i++) {
    const a = i * 400, b = i === 7 ? Infinity : a + 400;
    if (b <= lo || a >= hi) continue;
    const top = y(Math.min(b, hi)), bot = y(Math.max(a, lo));
    bg += `<rect x="0" y="${top.toFixed(1)}" width="${W}" height="${(bot - top).toFixed(1)}" fill="${TIER_COLORS[TIERS[i]]}" class="band"/>`;
  }
  const step = hi - lo > 1600 ? 400 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    if (v > 2800) continue;
    const r = RankMath.scoreToRank(Math.min(v, 2800));
    bg += `<line x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v % 400 ? 'div' : 'tier'}"/>`;
    ylab += `<span style="top:${pct(v)};color:${TIER_COLORS[r.tier] || TIER_COLORS.MASTER}">${shortRank(v)}</span>`;
  }
  // dates under the chart
  let xlab = '';
  for (let k = 0; k <= 4; k++) {
    const ts = t0 + ((t1 - t0) * k) / 4;
    xlab += `<span style="left:${k * 25}%">${new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })}</span>`;
  }
  // steps: the rank stays until the next record (straight lines would invent games in between)
  const path = pts => pts.map((p, i) => (i ? `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)).join('');
  let goals = '', paths = '', dots = '';
  for (const l of lines) {
    const g = goalScore(l.s.goal);
    if (g != null && g >= lo && g <= hi) goals += `<line x1="0" x2="${W}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="goal" stroke="${l.s.color}"/>`;
    const last = l.pts[l.pts.length - 1];
    paths += `<path d="${path(l.pts)}" stroke="${l.s.color}"${l.s.dashes ? ` stroke-dasharray="${l.s.dashes}"` : ''} class="acc"/>`;
    dots += `<b class="dash-dot" style="left:${((100 * x(last.t)) / W).toFixed(2)}%;top:${pct(last.v)};background:${l.s.color}"></b>`;
  }
  dash.view = { t0, t1, lines: lines.map(l => ({ name: l.s.label, color: l.s.color, pts: l.s.pts })) };
  return `<div class="dash-frame"><div class="dash-y">${ylab}</div>
    <div class="dash-plot"><svg class="dash-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bg}${goals}${paths}</svg>${dots}
      <i class="dash-cur" hidden></i><div class="dash-tip" hidden></div></div>
    <div></div><div class="dash-x">${xlab}</div></div>`;
}

// what happened in the period, per account
function dashRows(series, t0) {
  return series.map(s => {
    const games = s.games.filter(g => g.t >= t0);
    const wins = games.filter(g => g.win).length;
    const start = valueAt(s.pts, t0) ?? (s.pts.find(p => p.t >= t0) || {}).v;
    const delta = s.cur != null && start != null ? s.cur - start : null;
    return { ...s, n: games.length, wins, losses: games.length - wins, start, delta };
  });
}

// the season's highest rank: the client's own if known, else the highest recorded in the period
function peakCell(r) {
  const q = r.a[r.q] || {};
  if (q.peak && q.peak.tier) {
    const apex = APEX.includes(q.peak.tier);
    return `${esc(tierName(q.peak.tier) + (apex ? '' : ' ' + q.peak.division))}${q.lastSeason && q.lastSeason.tier ? `<small>${esc(t('dash.lastSeason', { r: tierName(q.lastSeason.tier) + (APEX.includes(q.lastSeason.tier) ? '' : ' ' + q.lastSeason.division) }))}</small>` : ''}`;
  }
  const seen = r.pts.filter(p => p.t >= dash.t0).map(p => p.v);
  return seen.length ? `${esc(shortRank(Math.max(...seen)))}<small>${t('dash.peakSeen')}</small>` : '–';
}
function goalCell(r) {
  const g = r.goal, gs = goalScore(g);
  const opts = [`<option value="">${esc(t('dash.noGoal'))}</option>`];
  for (const tier of TIERS.slice(0, 8)) {
    for (const d of tier === 'MASTER' ? [''] : ['IV', 'III', 'II', 'I']) {
      const val = tier + (d ? ':' + d : '');
      const on = g && g.tier === tier && (g.division || '') === d;
      opts.push(`<option value="${val}"${on ? ' selected' : ''}>${esc(tierName(tier) + (d ? ' ' + d : ''))}</option>`);
    }
  }
  let bar = '';
  if (gs != null && r.cur != null) {
    const done = r.cur >= gs;
    // from the lowest point on record (or one tier below the goal) up to the goal
    const base = Math.min(...r.pts.map(p => p.v), gs - 400);
    const pct = done ? 100 : Math.max(3, Math.round((100 * (r.cur - base)) / Math.max(1, gs - base)));
    bar = `<div class="dg-bar"><i style="width:${pct}%;background:${r.color}"></i></div><small class="${done ? 'done' : ''}">${done ? t('dash.goalDone') : t('dash.goalLeft', { n: gs - r.cur })}</small>`;
  }
  return `<div class="dg">${bar}<select data-goal="${esc(r.a.puuid)}" data-gq="${r.q}" class="${g ? 'set' : ''}">${opts.join('')}</select></div>`;
}

function renderDash() {
  const el = $('dashBody');
  if (!el) return;
  document.querySelectorAll('[data-dq]').forEach(b => b.classList.toggle('on', dash.qs.has(b.dataset.dq)));
  document.querySelectorAll('[data-dd]').forEach(b => b.classList.toggle('on', +b.dataset.dd === dash.days));
  if (hides('ranks')) { el.innerHTML = `<div class="chart-empty">${t('stream.ranksHidden')}</div>`; return; }
  if (!dash.data) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const series = dashSeries();
  if (!series.length) { el.innerHTML = `<div class="chart-empty">${t('dash.empty')}</div>`; return; }
  const now = Date.now();
  const first = Math.min(...series.flatMap(s => s.pts.map(p => p.t)), now - DAY);
  const t0 = dash.days ? now - dash.days * DAY : first, t1 = now;
  dash.t0 = t0;
  const rows = dashRows(series, t0);
  // the period at a glance: all accounts together
  const n = rows.reduce((k, r) => k + r.n, 0), w = rows.reduce((k, r) => k + r.wins, 0);
  const net = rows.reduce((k, r) => k + (r.delta || 0), 0);
  const best = rows.filter(r => r.delta).sort((p, q) => q.delta - p.delta)[0];
  // across all accounts in the period: the most played champion and the busiest account
  const champCount = new Map(), accGames = new Map();
  for (const r of rows) {
    for (const g of r.games) {
      if (g.t < t0) continue;
      if (g.champ) { const c = champCount.get(g.champ) || { n: 0, w: 0 }; c.n++; c.w += g.win ? 1 : 0; champCount.set(g.champ, c); }
      accGames.set(r.a.puuid, (accGames.get(r.a.puuid) || 0) + 1);
    }
  }
  const topChamp = [...champCount.entries()].sort((p, q) => q[1].n - p[1].n)[0];
  const topAcc = [...accGames.entries()].sort((p, q) => q[1] - p[1])[0];
  const topAccA = topAcc && S.accounts.find(a => a.puuid === topAcc[0]);
  const champLabel = id => ((typeof champById === 'function' && champById(id)) || {}).name || '#' + id;
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
  const stat = (label, val, cls = '') => `<div class="stat ${cls}"><b>${val}</b><span>${label}</span></div>`;
  // one chip per account (it hides all its lines); with several queues a key for the line styles
  const accs = [...new Map(series.map(s => [s.a.puuid, s])).values()];
  const key = dash.qs.size > 1 ? `<span class="dash-key">${DASH_QUEUES.filter(x => dash.qs.has(x[0])).map(([, n, d]) => `<span><svg viewBox="0 0 28 6"><line x1="0" x2="28" y1="3" y2="3"${d ? ` stroke-dasharray="${d}"` : ''}/></svg>${esc(n)}</span>`).join('')}</span>` : '';
  const chips = accs.map(s => `<button class="dash-chip ${ovf.off.has(s.a.puuid) ? 'off' : ''}" data-dchip="${esc(s.a.puuid)}"><i style="background:${s.color}"></i>${esc(dispName(s.a))}</button>`).join('');
  const list = rows.slice().sort((p, q) => (q.cur ?? -1) - (p.cur ?? -1));
  el.innerHTML = `
    <div class="stats dash-stats">
      ${stat(t('dash.games'), n)}
      ${stat(t('dash.wl'), n ? `${w}–${n - w} <small>${Stats.winPct(w, n)} %</small>` : '–')}
      ${stat(t('dash.lp'), rows.some(r => r.delta != null) ? sgn(net) : '–', net > 0 ? 'up' : net < 0 ? 'down' : '')}
      ${stat(t('dash.climber'), best && best.delta > 0 ? `${esc(dispName(best.a))} <small>${sgn(best.delta)}</small>` : '–')}
      ${stat(t('dash.topChamp'), topChamp ? `<img class="st-ic" src="${CHAMP_ICON(topChamp[0])}" alt="">${esc(champLabel(topChamp[0]))} <small>${topChamp[1].n} · ${Stats.winPct(topChamp[1].w, topChamp[1].n)} %</small>` : '–')}
      ${stat(t('dash.topAcc'), topAccA ? `${esc(dispName(topAccA))} <small>${t('dash.nGames', { n: topAcc[1] })}</small>` : '–')}
    </div>
    <div class="dash-card">${dashChart(series, t0, t1)}<div class="dash-chips">${chips}${key}</div></div>
    <table class="dash-table"><thead><tr><th>${t('dash.account')}</th><th>${t('dash.rank')}</th><th>${t('dash.peak')}</th><th>${t('dash.games')}</th><th>${t('dash.wr')}</th><th>${t('dash.lp')}</th><th>${t('dash.goal')}</th><th>${t('dash.active')}</th></tr></thead><tbody>
    ${list.map(r => {
      const moved = r.start != null && r.cur != null && shortRank(r.start) !== shortRank(r.cur);
      const idle = decayWarning(r.a);
      return `<tr data-dacc="${esc(r.a.puuid)}">
        <td><span class="dash-name"><i style="background:${r.color}"></i>${esc(dispName(r.a))}</span>${dash.qs.size > 1 ? `<small>${esc(dashQName(r.q))}</small>` : ''}</td>
        <td>${r.cur != null ? esc(rankText(r.cur)) : `<i class="muted">${t('tile.unranked')}</i>`}</td>
        <td>${peakCell(r)}</td>
        <td>${r.n ? `${r.wins}–${r.losses}` : '–'}</td>
        <td class="${r.n && r.wins / r.n >= 0.5 ? 'up' : r.n ? 'down' : ''}">${r.n ? Stats.winPct(r.wins, r.n) + ' %' : '–'}</td>
        <td class="${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}">${r.delta == null ? '–' : sgn(r.delta)}${moved ? `<small>${shortRank(r.start)} → ${shortRank(r.cur)}</small>` : ''}</td>
        <td>${goalCell(r)}</td>
        <td class="${idle ? 'warn' : ''}">${r.a.lastPlayed ? esc(ago(r.a.lastPlayed)) : '–'}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ---------- clicks and hover ----------
$('viewDash').addEventListener('click', e => {
  const q = e.target.closest('[data-dq]');
  // queues: any combination, at least one
  if (q) {
    const k = q.dataset.dq;
    if (dash.qs.has(k)) { if (dash.qs.size > 1) dash.qs.delete(k); } else dash.qs.add(k);
    return renderDash();
  }
  const d = e.target.closest('[data-dd]');
  if (d) { dash.days = +d.dataset.dd; return renderDash(); }
  const c = e.target.closest('[data-dchip]');
  if (c) {
    const id = c.dataset.dchip;
    // a click shows/hides one account; with Ctrl only this one
    return ovToggle(id, e.ctrlKey || e.metaKey);
  }
  const row = e.target.closest('[data-dacc]');
  // a row: only this account (a click on its chip brings the others back)
  if (row && !e.target.closest('select')) ovOnly(row.dataset.dacc);
});
$('viewDash').addEventListener('change', e => {
  const s = e.target.closest('[data-goal]');
  if (!s) return;
  const [tier, division] = s.value.split(':');
  const a = S.accounts.find(x => x.puuid === s.dataset.goal), q = s.dataset.gq || 'solo';
  const goal = tier ? (division ? { tier, division } : { tier }) : null;
  if (a) {
    if (q === 'solo') { if (goal) a.goal = goal; else delete a.goal; }
    else { a.goals = { ...(a.goals || {}) }; if (goal) a.goals[q] = goal; else delete a.goals[q]; }
  }
  api.setGoal(s.dataset.goal, goal, q);
  renderDash();
});
$('viewDash').addEventListener('mousemove', e => {
  const plot = e.target.closest && e.target.closest('.dash-plot');
  const cur = $('viewDash').querySelector('.dash-cur'), tip = $('viewDash').querySelector('.dash-tip');
  if (!cur) return;
  const v = dash.view;
  if (!plot || !v) { cur.hidden = tip.hidden = true; return; }
  const r = plot.getBoundingClientRect();
  const f = (e.clientX - r.left) / Math.max(1, r.width);
  if (f < 0 || f > 1) { cur.hidden = tip.hidden = true; return; }
  const ts = v.t0 + f * (v.t1 - v.t0);
  const at = v.lines.map(l => ({ ...l, val: valueAt(l.pts, ts) })).filter(l => l.val != null).sort((p, q) => q.val - p.val);
  if (!at.length) { cur.hidden = tip.hidden = true; return; }
  const left = 100 * f;
  cur.hidden = tip.hidden = false;
  cur.style.left = left + '%';
  tip.innerHTML = `<div class="dt-date">${esc(fmtDate(ts))}</div>${at.map(l => `<div><i style="background:${l.color}"></i>${esc(l.name)} <b>${esc(rankText(l.val))}</b></div>`).join('')}`;
  tip.classList.toggle('left', left > 60);
  tip.style.left = left + '%';
});
$('viewDash').addEventListener('mouseleave', () => {
  const cur = $('viewDash').querySelector('.dash-cur'), tip = $('viewDash').querySelector('.dash-tip');
  if (cur) cur.hidden = tip.hidden = true;
});
