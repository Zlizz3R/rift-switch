// Overview page: every account's LP history in one chart, and per account what happened in the
// chosen period (games, win rate, LP won or lost, rank change), a goal and when it was last played.
// Uses the globals of renderer.js (S, t, $, esc, api, rankScore, …).

const DASH_COLORS = ['#c8aa6e', '#0ac8b9', '#e5737a', '#8f7cf7', '#4cc38a', '#f29a4a', '#5aa9e6', '#e27bd0', '#b8c26a', '#9aa3b5'];
const TIER_COLORS = { IRON: '#6b625d', BRONZE: '#9a6240', SILVER: '#8c9db1', GOLD: '#c8aa6e', PLATINUM: '#3fb6a8',
  EMERALD: '#2fae6a', DIAMOND: '#6a7de8', MASTER: '#b05fe0' };
const dash = { data: null, q: 'solo', days: 30, hidden: new Set(), view: null, histLen: -1 };

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

// one line per account: its recorded ranks, the current rank at "now"
function dashSeries() {
  const now = Date.now();
  const by = new Map((dash.data || []).map(d => [d.puuid, d]));
  const out = [];
  S.accounts.filter(a => !a.placeholder).forEach((a, i) => {
    const d = by.get(a.puuid) || { history: [], games: [] };
    const pts = (d.history || []).filter(e => e[dash.q] && e[dash.q].tier).map(e => ({ t: e.t, v: rankScore(e[dash.q]) }));
    const cur = a[dash.q] && TIERS.includes(a[dash.q].tier) ? rankScore(a[dash.q]) : null;
    if (cur != null && (!pts.length || pts[pts.length - 1].v !== cur || pts[pts.length - 1].t < now)) pts.push({ t: now, v: cur });
    const games = (d.games || []).filter(g => g.q === dash.q);
    if (!pts.length && !games.length) return;
    out.push({ a, color: DASH_COLORS[i % DASH_COLORS.length], pts, games, cur });
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
  const shown = series.filter(s => !dash.hidden.has(s.a.puuid) && s.pts.length);
  const clip = s => {
    const start = valueAt(s.pts, t0);
    const inside = s.pts.filter(p => p.t > t0 && p.t <= t1);
    return start == null ? inside : [{ t: t0, v: start }, ...inside];
  };
  const lines = shown.map(s => ({ s, pts: clip(s) })).filter(l => l.pts.length);
  const vals = lines.flatMap(l => l.pts.map(p => p.v));
  if (!vals.length) return `<div class="chart-empty">${t('dash.chartEmpty')}</div>`;
  for (const l of lines) { const g = goalScore(l.s.a.goal); if (g != null && lines.length === 1) vals.push(g); }
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
    const g = goalScore(l.s.a.goal);
    if (g != null && g >= lo && g <= hi) goals += `<line x1="0" x2="${W}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="goal" stroke="${l.s.color}"/>`;
    const last = l.pts[l.pts.length - 1];
    paths += `<path d="${path(l.pts)}" stroke="${l.s.color}" class="acc"/>`;
    dots += `<b class="dash-dot" style="left:${((100 * x(last.t)) / W).toFixed(2)}%;top:${pct(last.v)};background:${l.s.color}"></b>`;
  }
  dash.view = { t0, t1, lines: lines.map(l => ({ name: dispName(l.s.a), color: l.s.color, pts: l.s.pts })) };
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

function goalCell(r) {
  const g = r.a.goal, gs = goalScore(g);
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
  return `<div class="dg">${bar}<select data-goal="${esc(r.a.puuid)}" class="${g ? 'set' : ''}">${opts.join('')}</select></div>`;
}

function renderDash() {
  const el = $('dashBody');
  if (!el) return;
  document.querySelectorAll('[data-dq]').forEach(b => b.classList.toggle('on', b.dataset.dq === dash.q));
  document.querySelectorAll('[data-dd]').forEach(b => b.classList.toggle('on', +b.dataset.dd === dash.days));
  if (hides('ranks')) { el.innerHTML = `<div class="chart-empty">${t('stream.ranksHidden')}</div>`; return; }
  if (!dash.data) { el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const series = dashSeries();
  if (!series.length) { el.innerHTML = `<div class="chart-empty">${t('dash.empty')}</div>`; return; }
  const now = Date.now();
  const first = Math.min(...series.flatMap(s => s.pts.map(p => p.t)), now - DAY);
  const t0 = dash.days ? now - dash.days * DAY : first, t1 = now;
  const rows = dashRows(series, t0);
  // the period at a glance: all accounts together
  const n = rows.reduce((k, r) => k + r.n, 0), w = rows.reduce((k, r) => k + r.wins, 0);
  const net = rows.reduce((k, r) => k + (r.delta || 0), 0);
  const best = rows.filter(r => r.delta).sort((p, q) => q.delta - p.delta)[0];
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
  const stat = (label, val, cls = '') => `<div class="stat ${cls}"><b>${val}</b><span>${label}</span></div>`;
  const chips = series.map(s => `<button class="dash-chip ${dash.hidden.has(s.a.puuid) ? 'off' : ''}" data-dchip="${esc(s.a.puuid)}"><i style="background:${s.color}"></i>${esc(dispName(s.a))}</button>`).join('');
  const list = rows.slice().sort((p, q) => (q.cur ?? -1) - (p.cur ?? -1));
  el.innerHTML = `
    <div class="stats dash-stats">
      ${stat(t('dash.games'), n)}
      ${stat(t('dash.wl'), n ? `${w}–${n - w} <small>${Math.round((100 * w) / n)} %</small>` : '–')}
      ${stat(t('dash.lp'), rows.some(r => r.delta != null) ? sgn(net) : '–', net > 0 ? 'up' : net < 0 ? 'down' : '')}
      ${stat(t('dash.climber'), best && best.delta > 0 ? `${esc(dispName(best.a))} <small>${sgn(best.delta)}</small>` : '–')}
    </div>
    <div class="dash-card">${dashChart(series, t0, t1)}<div class="dash-chips">${chips}</div></div>
    <table class="dash-table"><thead><tr><th>${t('dash.account')}</th><th>${t('dash.rank')}</th><th>${t('dash.games')}</th><th>${t('dash.wr')}</th><th>${t('dash.lp')}</th><th>${t('dash.goal')}</th><th>${t('dash.active')}</th></tr></thead><tbody>
    ${list.map(r => {
      const moved = r.start != null && r.cur != null && shortRank(r.start) !== shortRank(r.cur);
      const idle = decayWarning(r.a);
      return `<tr data-dacc="${esc(r.a.puuid)}">
        <td><span class="dash-name"><i style="background:${r.color}"></i>${esc(dispName(r.a))}</span></td>
        <td>${r.cur != null ? esc(rankText(r.cur)) : `<i class="muted">${t('tile.unranked')}</i>`}</td>
        <td>${r.n ? `${r.wins}–${r.losses}` : '–'}</td>
        <td class="${r.n && r.wins / r.n >= 0.5 ? 'up' : r.n ? 'down' : ''}">${r.n ? Math.round((100 * r.wins) / r.n) + ' %' : '–'}</td>
        <td class="${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}">${r.delta == null ? '–' : sgn(r.delta)}${moved ? `<small>${shortRank(r.start)} → ${shortRank(r.cur)}</small>` : ''}</td>
        <td>${goalCell(r)}</td>
        <td class="${idle ? 'warn' : ''}">${r.a.lastPlayed ? esc(ago(r.a.lastPlayed)) : '–'}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ---------- clicks and hover ----------
$('viewDash').addEventListener('click', e => {
  const q = e.target.closest('[data-dq]');
  if (q) { dash.q = q.dataset.dq; return renderDash(); }
  const d = e.target.closest('[data-dd]');
  if (d) { dash.days = +d.dataset.dd; return renderDash(); }
  const c = e.target.closest('[data-dchip]');
  if (c) {
    const id = c.dataset.dchip;
    // a click shows/hides one account; with Ctrl only this one
    if (e.ctrlKey) { dash.hidden = new Set(dashSeries().map(s => s.a.puuid).filter(x => x !== id)); }
    else if (dash.hidden.has(id)) dash.hidden.delete(id); else dash.hidden.add(id);
    return renderDash();
  }
  const row = e.target.closest('[data-dacc]');
  if (row && !e.target.closest('select')) openProfile(row.dataset.dacc);
});
$('viewDash').addEventListener('change', e => {
  const s = e.target.closest('[data-goal]');
  if (!s) return;
  const [tier, division] = s.value.split(':');
  const a = S.accounts.find(x => x.puuid === s.dataset.goal);
  const goal = tier ? (division ? { tier, division } : { tier }) : null;
  if (a) { if (goal) a.goal = goal; else delete a.goal; }
  api.setGoal(s.dataset.goal, goal);
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
