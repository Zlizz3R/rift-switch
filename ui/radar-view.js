// Play style against the lane opponent (docs/plans Phase 6): Overview → "Play style" (the filter of
// Performance, one role – the chosen one or the main role –, optionally one champion) and, in Live,
// a card's radar when its champion is clicked. Maths in radar.js. Uses the globals of perf.js etc.

const rdv = { champ: 0, flipped: new Set() };

// the SVG: 100 % (as good as the opponent) is the middle ring, 200 % the edge
function radarSvg(axes, size = 220) {
  const c = size / 2, R = size / 2 - 34, n = axes.length;
  const pt = (i, ratio) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n, r = (Math.min(2, ratio) / 2) * R;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const ring = k => axes.map((_, i) => pt(i, k).map(v => v.toFixed(1)).join(',')).join(' ');
  const rings = [0.5, 1, 1.5, 2].map(k => `<polygon class="rd-ring${k === 1 ? ' mid' : ''}" points="${ring(k)}"/>`).join('');
  const spokes = axes.map((a, i) => { const [x, y] = pt(i, 2); return `<line class="rd-axis${a.ratio == null ? ' few' : ''}" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const known = axes.map((a, i) => (a.ratio == null ? null : pt(i, a.ratio))).filter(Boolean);
  const shape = known.length >= 3 ? `<polygon class="rd-shape" points="${known.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>` : '';
  const dots = axes.map((a, i) => { if (a.ratio == null) return ''; const [x, y] = pt(i, a.ratio); return `<circle class="rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"><title>${esc(radarTip(a))}</title></circle>`; }).join('');
  const labels = axes.map((a, i) => {
    const [x, y] = pt(i, 2.32);
    return `<text class="rd-label${a.ratio == null ? ' few' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(t('rad.' + a.id))}<title>${esc(radarTip(a))}</title></text>`;
  }).join('');
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">${rings}${spokes}${shape}${dots}${labels}</svg>`;
}
// the difference to the opponent: +13 / −8 / ±0
function radarDiff(ratio) {
  const d = Math.round((ratio - 1) * 100);
  return d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '±0';
}
const radarVal = (a, v) => (v == null ? '–' : a.axis.pct ? Math.round(v * 100) + ' %' : v.toLocaleString(locale(), { maximumFractionDigits: a.axis.dec, minimumFractionDigits: a.axis.dec }));
function radarTip(a) {
  if (a.ratio == null) return t('rad.few', { axis: t('rad.' + a.id), n: a.n, min: Radar.MIN });
  return t('rad.tip', { axis: t('rad.' + a.id), pct: radarDiff(a.ratio), mine: radarVal(a, a.mine), theirs: radarVal(a, a.theirs), n: num(a.n) });
}
// the same values as bars around 100 %
function radarBars(axes) {
  return `<div class="rd-bars">${axes.map(a => {
    if (a.ratio == null) return `<div class="rd-bar few" title="${esc(radarTip(a))}"><span>${esc(t('rad.' + a.id))}</span><i class="rd-track"></i><b>–</b></div>`;
    const d = Math.max(-1, Math.min(1, a.ratio - 1));
    const w = Math.abs(d) * 50;
    return `<div class="rd-bar" title="${esc(radarTip(a))}"><span>${esc(t('rad.' + a.id))}</span><i class="rd-track"><i class="${d >= 0 ? 'up' : 'down'}" style="${d >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></i><b class="${a.ratio > 1.005 ? 'up' : a.ratio < 0.995 ? 'down' : ''}">${radarDiff(a.ratio)} %</b></div>`;
  }).join('')}</div>`;
}

// ---------- Overview → Play style ----------
function perfStyleHtml(parts, chosenRole = perf.f.role) {
  // one role: the chosen one, else the main role (else the most played)
  let role = chosenRole;
  let roleNote = '';
  if (!role) {
    const mr = Tags.mainRole(parts);
    role = mr.main || mr.most;
    if (role) roleNote = t(mr.main ? 'tags.roleMain' : 'tags.roleMost', { role: t('pos.' + role) });
  }
  let rows = role ? parts.filter(x => Stats.role(x.g, x.p) === role) : [];
  const champsHere = [...new Set(rows.map(x => x.p.champ))];
  // the chosen champion where it was played (the choice itself stays for the other view)
  const champ = champsHere.includes(rdv.champ) ? rdv.champ : 0;
  if (champ) rows = rows.filter(x => x.p.champ === champ);
  const axes = Radar.radar(rows);
  const opts = `<option value="0">${t('rad.allChamps')}</option>` + champsHere.map(id => ({ id, n: (champById(id) || {}).name || '#' + id }))
    .sort((a, b) => a.n.localeCompare(b.n)).map(c => `<option value="${c.id}"${c.id === champ ? ' selected' : ''}>${esc(c.n)}</option>`).join('');
  const head = `<div class="rd-head"><select id="rdChamp">${opts}</select>${roleNote ? `<span class="muted">${esc(roleNote)}</span>` : ''}</div>`;
  if (!axes.some(a => a.n)) return `${head}<div class="chart-empty">${t('rad.none')}</div>`;
  return `${head}<div class="rd-wrap">${radarSvg(axes, 300)}${radarBars(axes)}</div><p class="coll-foot">${t('rad.basis')}</p>`;
}
document.addEventListener('change', e => {
  if (e.target.id !== 'rdChamp') return;
  rdv.champ = +e.target.value;
  perfRerender();
});

// ---------- Live: a card shows its radar when its champion is clicked ----------
function scRadarHtml(c) {
  const parts = Stats.byParticipation(scGames(c.p.puuid)).filter(x => x.p.puuid === c.p.puuid);
  const role = c.pos || c.roles.main || c.roles.most;
  const axes = Radar.radar(role ? parts.filter(x => Stats.role(x.g, x.p) === role) : parts);
  return `<div class="sc-radar">${axes.some(a => a.ratio != null) ? radarSvg(axes, 170) : `<span class="muted">${esc(t('rad.none'))}</span>`}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-scflip]');
  if (!b) return;
  const id = b.dataset.scflip;
  if (rdv.flipped.has(id)) rdv.flipped.delete(id); else rdv.flipped.add(id);
  renderLive(true);
});
