// Overview → Map: where you die and where you kill – deaths, kills or both on one map, for any
// stretch of the game (the phases, or minutes picked on the chart under the map), with the zones by
// share. Uses the Performance filter (account, queue, time, role). Maths in mapmath.js; uses the
// globals of renderer.js / perf.js. The player page uses it too (one player's games).

// kind: 'deaths' | 'kills' | 'both'; the window in minutes [from, to) – to null = the end;
// preset: the phase button that is on ('all', 'early' …) or '' for minutes picked on the chart
const mv = { kind: 'deaths', from: 0, to: null, preset: 'all' };
const MV_PRESETS = { all: [0, null], early: [0, 10], mid: [10, 20], late: [20, null] };

// Summoner's Rift as a sketch (0–148, blue base bottom left; SVG y runs down)
function mapSvg(list) {
  const S = MapMath.SIZE, Y = y => (S - y).toFixed(1);
  const line = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${Y(y)}`).join(' ');
  const lanes = [line([[10, 40], [10, 138], [108, 138]]), line([[40, 10], [138, 10], [138, 108]]), line([[30, 30], [118, 118]])];
  const dots = kind => list.filter(e => e.kind === kind).map(e => `<circle cx="${e.x.toFixed(1)}" cy="${Y(e.y)}" r="4.5"/>`).join('');
  return `<svg class="dm-map" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t('dash.tabMap'))}">
    <rect class="dm-bg" width="${S}" height="${S}" rx="6"/>
    <path class="dm-river" d="${line([[18, 130], [130, 18]])}"/>
    ${lanes.map(d => `<path class="dm-lane" d="${d}"/>`).join('')}
    <circle class="dm-base own" cx="10" cy="${Y(10)}" r="24"/><circle class="dm-base enemy" cx="138" cy="${Y(138)}" r="24"/>
    <g class="dm-dots kills">${dots('kill')}</g><g class="dm-dots deaths">${dots('death')}</g>
  </svg>`;
}
// the minute chart: kills up, deaths down, the chosen minutes lit; drag across it to pick minutes
function mapChart(all) {
  const rows = MapMath.perMinute(all);
  if (rows.length < 2) return '';
  const W = 340, H = 64, mid = H / 2, bw = W / rows.length;
  const showK = mv.kind !== 'deaths', showD = mv.kind !== 'kills';
  const max = Math.max(1, ...rows.map(r => Math.max(showK ? r.kills : 0, showD ? r.deaths : 0)));
  const on = r => r.m >= mv.from && (mv.to == null || r.m < mv.to);
  const bars = rows.map(r => {
    const x = (r.m * bw + 0.5).toFixed(1), w = Math.max(1, bw - 1).toFixed(1), cls = on(r) ? '' : ' off';
    const k = showK && r.kills ? `<rect class="mc-k${cls}" x="${x}" y="${(mid - (mid - 2) * r.kills / max).toFixed(1)}" width="${w}" height="${((mid - 2) * r.kills / max).toFixed(1)}"/>` : '';
    const d = showD && r.deaths ? `<rect class="mc-d${cls}" x="${x}" y="${mid}" width="${w}" height="${((mid - 2) * r.deaths / max).toFixed(1)}"/>` : '';
    return `${k}${d}<rect class="mc-hit" data-mcm="${r.m}" x="${(r.m * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}"><title>${esc(t('mp.minute', { m: r.m, k: r.kills, d: r.deaths }))}</title></rect>`;
  }).join('');
  const ticks = [0, 10, 20, 30, 40, 50].filter(m => m < rows.length).map(m => `<span style="left:${(100 * m / rows.length).toFixed(2)}%">${m}′</span>`).join('');
  return `<div class="mc"><svg class="mc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-mcn="${rows.length}">
      <line class="mc-axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}</svg>
    <div class="mc-ticks">${ticks}</div><p class="fine">${t('mp.drag')}</p></div>`;
}
const mvWindowLabel = () => (mv.preset ? t('dm.ph.' + mv.preset) : mv.to == null ? t('mp.from', { a: mv.from }) : t('mp.range', { a: mv.from, b: mv.to }));
// opts.foot: false on the player page (its own line says where the games come from)
function perfMapHtml(parts, opts = {}) {
  const all = MapMath.events(parts);
  const nGames = MapMath.games(parts).length;
  if (!all.length) return `<div class="chart-empty">${t('mp.none')}</div>`;
  const win = all.filter(e => MapMath.inWindow(e, mv.from, mv.to));
  const shown = mv.kind === 'both' ? win : win.filter(e => e.kind === (mv.kind === 'kills' ? 'kill' : 'death'));
  const dl = win.filter(e => e.kind === 'death'), kl = win.filter(e => e.kind === 'kill');
  const ds = MapMath.sum(dl, nGames), ks = MapMath.sum(kl, nGames);
  const count = k => all.filter(e => (k === 'both' || e.kind === (k === 'kills' ? 'kill' : 'death')) && MapMath.inWindow(e, mv.from, mv.to)).length;
  const kinds = `<div class="seg mp-kinds">${['deaths', 'kills', 'both'].map(k => `<button data-mpk="${k}"${mv.kind === k ? ' class="on"' : ''}><i class="mp-dot ${k}"></i>${esc(t('mp.' + k))} <small>${count(k)}</small></button>`).join('')}</div>`;
  const presets = `<div class="seg dm-phases">${Object.keys(MV_PRESETS).map(id => `<button data-dmph="${id}"${mv.preset === id ? ' class="on"' : ''}>${esc(t('dm.ph.' + id))}</button>`).join('')}${mv.preset ? '' : `<button class="on" disabled>${esc(mvWindowLabel())}</button>`}</div>`;
  // the spots that stand out: per phase for the whole game, else for the chosen minutes
  const hotLine = (label, list, kind) => {
    const z = MapMath.hotspot(MapMath.sum(list, nGames));
    return z ? `<li class="${kind}"><b>${esc(label)}</b> ${esc(t(kind === 'kill' ? 'mp.hotK' : 'dm.hot', { pct: Math.round(z.share * 100), zone: t('dm.z.' + z.zone), n: z.n, all: list.length }))}</li>` : '';
  };
  const kindsOn = mv.kind === 'both' ? ['death', 'kill'] : [mv.kind === 'kills' ? 'kill' : 'death'];
  const hots = (mv.preset === 'all' ? MapMath.PHASES.map(([id]) => [t('dm.ph.' + id), e => e.phase === id]) : [[mvWindowLabel(), () => true]])
    .flatMap(([label, f]) => kindsOn.map(kind => hotLine(label, win.filter(e => e.kind === kind && f(e)), kind))).filter(Boolean);
  const lines = [];
  if (mv.kind !== 'kills') lines.push(t('dm.line', { n: num(ds.n), games: num(nGames), per: perfDec(ds.perGame), out: Math.round((ds.outnumbered || 0) * 100) }));
  if (mv.kind !== 'deaths') lines.push(t('mp.lineK', { n: num(ks.n), games: num(nGames), per: perfDec(ks.perGame), pct2: t('mp.solo', { solo: Math.round((ks.solo || 0) * 100) }) }));
  const pctTxt = x => Math.round(x * 100) + ' %';
  const rows = mv.kind === 'both'
    ? `<div class="mp-rows both"><div class="mp-row head"><span></span><span class="d">${esc(t('mp.deaths'))}</span><span></span><span class="k">${esc(t('mp.kills'))}</span><span></span></div>${MapMath.zonesBoth(win).map(r => `<div class="mp-row">
        <span>${esc(t('dm.z.' + r.zone))}</span><i class="dm-track d"><i style="width:${(r.dShare * 100).toFixed(1)}%"></i></i><b>${r.deaths}</b><i class="dm-track k"><i style="width:${(r.kShare * 100).toFixed(1)}%"></i></i><b>${r.kills}</b></div>`).join('')}</div>`
    : `<div class="mp-rows">${(mv.kind === 'kills' ? ks : ds).zones.map(z => `<div class="mp-row">
        <span>${esc(t('dm.z.' + z.zone))}</span><i class="dm-track ${mv.kind === 'kills' ? 'k' : 'd'}"><i style="width:${(z.share * 100).toFixed(1)}%"></i></i><b>${pctTxt(z.share)}</b><small>${z.n}</small></div>`).join('')}</div>`;
  return `<div class="mp-bar">${kinds}${presets}</div>
    <div class="dm-wrap"><div class="mp-left">${mapSvg(shown)}${mapChart(mv.kind === 'both' ? all : all.filter(e => e.kind === (mv.kind === 'kills' ? 'kill' : 'death')))}</div><div class="dm-side">
      ${hots.length ? `<ul class="dm-hots">${hots.join('')}</ul>` : ''}
      ${lines.map(l => `<p class="muted">${esc(l)}</p>`).join('')}
      ${shown.length ? rows : `<div class="chart-empty">${t('mp.empty')}</div>`}
    </div></div>${opts.foot === false ? '' : `<p class="coll-foot">${t('mp.basis')}</p>`}`;
}
// what is on the map, and when: re-drawn where the map is (Overview or the player page)
function mapRerender() {
  if (typeof renderPerf === 'function' && view === 'dash') renderPerf();
  if (typeof renderPlayer === 'function' && view === 'player') renderPlayer();
}
document.addEventListener('click', e => {
  const k = e.target.closest('[data-mpk]');
  if (k) { mv.kind = k.dataset.mpk; return mapRerender(); }
  const b = e.target.closest('[data-dmph]');
  if (b) { [mv.from, mv.to] = MV_PRESETS[b.dataset.dmph]; mv.preset = b.dataset.dmph; mapRerender(); }
});
// drag across the minute chart (or click one minute): those minutes
let mvDrag = null;
const mvMinute = (svg, ev) => {
  const n = +svg.dataset.mcn, r = svg.getBoundingClientRect();
  if (!r.width) { const h = ev.target.closest('[data-mcm]'); return h ? +h.dataset.mcm : 0; }
  return Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width) * n)));
};
document.addEventListener('mousedown', e => {
  const svg = e.target.closest && e.target.closest('.mc-svg');
  if (!svg) return;
  e.preventDefault();
  mvDrag = { svg, a: mvMinute(svg, e) };
  mvDrag.b = mvDrag.a;
});
document.addEventListener('mousemove', e => {
  if (!mvDrag) return;
  const m = mvMinute(mvDrag.svg, e);
  if (m === mvDrag.b) return;
  mvDrag.b = m;
  // light the picked minutes while dragging, without redrawing
  const lo = Math.min(mvDrag.a, m), hi = Math.max(mvDrag.a, m);
  mvDrag.svg.querySelectorAll('[data-mcm]').forEach(h => h.classList.toggle('pick', +h.dataset.mcm >= lo && +h.dataset.mcm <= hi));
});
document.addEventListener('mouseup', () => {
  if (!mvDrag) return;
  const lo = Math.min(mvDrag.a, mvDrag.b), hi = Math.max(mvDrag.a, mvDrag.b);
  mvDrag = null;
  mv.from = lo; mv.to = hi + 1; mv.preset = '';
  mapRerender();
});
