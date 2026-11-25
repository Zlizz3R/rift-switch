// Overview → Deaths: where you die – a map with every death of the Performance filter (account,
// queue, time, role), by game phase, and the zones by share. Maths in deathmath.js; uses the
// globals of renderer.js / perf.js.

const dv = { phase: 'all' };

// Summoner's Rift as a sketch (0–148, blue base bottom left; SVG y runs down)
function dmMapSvg(list) {
  const S = DeathMath.SIZE, Y = y => (S - y).toFixed(1);
  const line = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${Y(y)}`).join(' ');
  const lanes = [line([[10, 40], [10, 138], [108, 138]]), line([[40, 10], [138, 10], [138, 108]]), line([[30, 30], [118, 118]])];
  const dots = list.map(d => `<circle cx="${d.x.toFixed(1)}" cy="${Y(d.y)}" r="4.5"/>`).join('');
  return `<svg class="dm-map" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t('dash.tabDeaths'))}">
    <rect class="dm-bg" width="${S}" height="${S}" rx="6"/>
    <path class="dm-river" d="${line([[18, 130], [130, 18]])}"/>
    ${lanes.map(d => `<path class="dm-lane" d="${d}"/>`).join('')}
    <circle class="dm-base own" cx="10" cy="${Y(10)}" r="24"/><circle class="dm-base enemy" cx="138" cy="${Y(138)}" r="24"/>
    <g class="dm-dots">${dots}</g>
  </svg>`;
}
const dmPhaseLabel = id => t('dm.ph.' + id);
function perfDeathsHtml(parts) {
  const sum = DeathMath.summary(parts);
  if (!sum.all.n) return `<div class="chart-empty">${t('dm.none')}</div>`;
  const ph = sum[dv.phase] || sum.all;
  const list = DeathMath.deaths(parts).filter(d => dv.phase === 'all' || d.phase === dv.phase);
  const seg = `<div class="seg dm-phases">${['all', ...DeathMath.PHASES.map(p => p[0])].map(id =>
    `<button data-dmph="${id}"${dv.phase === id ? ' class="on"' : ''}>${esc(dmPhaseLabel(id))} <small>${sum[id].n}</small></button>`).join('')}</div>`;
  // the headline of every phase that has a clear hot spot
  const hots = DeathMath.PHASES.map(([id]) => [id, DeathMath.hotspot(sum[id])]).filter(([, z]) => z).map(([id, z]) =>
    `<li><b>${esc(dmPhaseLabel(id))}</b> ${esc(t('dm.hot', { pct: Math.round(z.share * 100), zone: t('dm.z.' + z.zone), n: z.n, all: sum[id].n }))}</li>`);
  const rows = ph.zones.map(z => `<div class="dm-row"><span>${esc(t('dm.z.' + z.zone))}</span><i class="dm-track"><i style="width:${(z.share * 100).toFixed(1)}%"></i></i><b>${Math.round(z.share * 100)} %</b><small>${z.n}</small></div>`).join('');
  const line = t('dm.line', { n: num(ph.n), games: num(sum.games), per: perfDec(ph.perGame), out: Math.round((ph.outnumbered || 0) * 100) });
  return `${seg}<div class="dm-wrap">${dmMapSvg(list)}<div class="dm-side">
      ${hots.length ? `<ul class="dm-hots">${hots.join('')}</ul>` : ''}
      <p class="muted">${esc(line)}</p>
      <div class="dm-rows">${rows}</div>
    </div></div><p class="coll-foot">${t('dm.basis')}</p>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-dmph]');
  if (!b) return;
  dv.phase = b.dataset.dmph;
  renderPerf();
});
