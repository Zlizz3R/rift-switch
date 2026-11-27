// Overview → Map: where you kill, die and help – kills, deaths and assists, any of them on one map,
// for any stretch of the game (the phases, or minutes picked on the chart under the map), with the
// zones by share. Uses the Performance filter (account, queue, time, role). Maths in mapmath.js; uses
// the globals of renderer.js / perf.js. The player page uses it too (one player's games).

// kinds: the kinds shown ('kill' | 'death' | 'assist', at least one; kept per window); the window in
// minutes [from, to) – to null = the end; preset: the phase button that is on ('all', 'early' …) or ''
// for minutes picked on the chart; map: 'sr' | 'aram' | 'arena' – '' = the one most games were on;
// arena: Arena's arena shown – 0 all seven on top of each other, 1–7 one of them
const mvKindsSaved = () => { try { const k = JSON.parse(localStorage.getItem('rs.mapKinds') || 'null'); return Array.isArray(k) && k.length && k.every(x => MapMath.KINDS.includes(x)) ? k : null; } catch { return null; } };
const mv = { kinds: mvKindsSaved() || ['kill', 'death'], from: 0, to: null, preset: 'all', map: '', arena: 0 };
const MV_PRESETS = { all: [0, null], early: [0, 10], mid: [10, 20], late: [20, null] };
// a kind's word ('mp.kills' …), its class on the map and in the bars
const MV_CLS = { kill: 'kills', death: 'deaths', assist: 'assists' };

// a dot's radius: smaller the more places there are (hundreds of dots would cover the whole map)
const mvDotR = n => (n > 1200 ? 1.6 : n > 600 ? 2.2 : n > 200 ? 3 : 4.5);
const mvDots = (list, Y, r) => MapMath.KINDS.map(kind => `<g class="dm-dots ${MV_CLS[kind]}">${list.filter(e => e.kind === kind).map(e => `<circle cx="${e.x.toFixed(1)}" cy="${Y(e.y)}" r="${r}"/>`).join('')}</g>`).join('');
// Summoner's Rift as a sketch (0–148, blue base bottom left; SVG y runs down) – or ARAM's map
// (0–128): one lane from base to base, two towers on each side – or one arena of Arena
function mapSvg(list, map = 'sr') {
  if (map === 'aram') return mapSvgAram(list);
  if (map === 'arena') return mapSvgArena(list);
  const S = MapMath.SIZE, Y = y => (S - y).toFixed(1);
  const line = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${Y(y)}`).join(' ');
  const lanes = [line([[10, 40], [10, 138], [108, 138]]), line([[40, 10], [138, 10], [138, 108]]), line([[30, 30], [118, 118]])];
  return `<svg class="dm-map${list.length > 300 ? ' dense' : ''}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t('dash.tabMap'))}">
    <rect class="dm-bg" width="${S}" height="${S}" rx="6"/>
    <path class="dm-river" d="${line([[18, 130], [130, 18]])}"/>
    ${lanes.map(d => `<path class="dm-lane" d="${d}"/>`).join('')}
    <circle class="dm-base own" cx="10" cy="${Y(10)}" r="24"/><circle class="dm-base enemy" cx="138" cy="${Y(138)}" r="24"/>
    ${mvDots(list, Y, mvDotR(list.length))}
  </svg>`;
}
function mapSvgAram(list) {
  const S = MapMath.ARAM_SIZE, Y = y => (S - y).toFixed(1);
  // the lane: a band along the diagonal, about 12 units to each side
  const o = 12 / Math.SQRT2, a = 12, b = S - 12;
  const band = [[a - o, a + o], [b - o, b + o], [b + o, b - o], [a + o, a - o]].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${Y(y)}`).join(' ') + 'Z';
  const tower = (p, cls) => { const v = p * S; return `<rect class="dm-tower ${cls}" x="${(v - 2.5).toFixed(1)}" y="${(S - v - 2.5).toFixed(1)}" width="5" height="5" rx="1" transform="rotate(45 ${v.toFixed(1)} ${(S - v).toFixed(1)})"/>`; };
  return `<svg class="dm-map aram${list.length > 300 ? ' dense' : ''}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t('dash.tabMap'))} – ARAM">
    <rect class="dm-bg" width="${S}" height="${S}" rx="6"/>
    <path class="dm-bridge" d="${band}"/>
    <circle class="dm-base own" cx="10" cy="${Y(10)}" r="22"/><circle class="dm-base enemy" cx="${S - 10}" cy="${Y(S - 10)}" r="22"/>
    ${[[0.3, 'own'], [0.38, 'own'], [0.62, 'enemy'], [0.7, 'enemy']].map(([p, c]) => tower(p, c)).join('')}
    ${mvDots(list, Y, mvDotR(list.length))}
  </svg>`;
}
// Arena: one arena – the seven on top of each other, or the one picked (mv.arena) – with every place
// where it lies in its own arena (MapMath.arenaSpot)
function mapSvgArena(list) {
  const S = 120, P = 12, A = S - 2 * P;
  const spots = list.map(e => ({ e, s: MapMath.arenaSpot(e) })).filter(x => x.s);
  // a smaller field than the Rift's: smaller dots
  const r = +(mvDotR(spots.length) * 0.7).toFixed(2);
  const dots = MapMath.KINDS.map(kind => `<g class="dm-dots ${MV_CLS[kind]}">${spots.filter(x => x.e.kind === kind)
    .map(({ s }) => `<circle cx="${(P + s.u * A).toFixed(1)}" cy="${(P + (1 - s.v) * A).toFixed(1)}" r="${r}"/>`).join('')}</g>`).join('');
  const name = mv.arena ? t('dm.z.arN', { n: mv.arena }) : t('mp.allArenas');
  return `<svg class="dm-map arena${spots.length > 300 ? ' dense' : ''}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t('dash.tabMap'))} – ${esc(name)}">
    <rect class="dm-bg" width="${S}" height="${S}" rx="8"/>
    <rect class="dm-arena" x="${P - 4}" y="${P - 4}" width="${A + 8}" height="${A + 8}" rx="30"/>
    <circle class="dm-arena-mid" cx="${S / 2}" cy="${S / 2}" r="${(A * 0.2).toFixed(1)}"/>
    <text class="dm-arena-n" x="${S / 2}" y="${S - 3}" text-anchor="middle">${esc(name)}</text>
    ${dots}
  </svg>`;
}
// the minute chart: kills (and assists, lighter, on top) up, deaths down, the chosen minutes lit; drag
// across it to pick minutes
function mapChart(all) {
  const rows = MapMath.perMinute(all);
  if (rows.length < 2) return '';
  const W = 340, H = 64, mid = H / 2, bw = W / rows.length;
  const showK = mv.kinds.includes('kill'), showD = mv.kinds.includes('death'), showA = mv.kinds.includes('assist');
  const up = r => (showK ? r.kills : 0) + (showA ? r.assists : 0);
  const max = Math.max(1, ...rows.map(r => Math.max(up(r), showD ? r.deaths : 0)));
  const on = r => r.m >= mv.from && (mv.to == null || r.m < mv.to);
  const h = v => ((mid - 2) * v) / max;
  const bars = rows.map(r => {
    const x = (r.m * bw + 0.5).toFixed(1), w = Math.max(1, bw - 1).toFixed(1), cls = on(r) ? '' : ' off';
    const kh = showK ? h(r.kills) : 0, ah = showA ? h(r.assists) : 0;
    const k = kh ? `<rect class="mc-k${cls}" x="${x}" y="${(mid - kh).toFixed(1)}" width="${w}" height="${kh.toFixed(1)}"/>` : '';
    const a = ah ? `<rect class="mc-a${cls}" x="${x}" y="${(mid - kh - ah).toFixed(1)}" width="${w}" height="${ah.toFixed(1)}"/>` : '';
    const d = showD && r.deaths ? `<rect class="mc-d${cls}" x="${x}" y="${mid}" width="${w}" height="${h(r.deaths).toFixed(1)}"/>` : '';
    return `${k}${a}${d}<rect class="mc-hit" data-mcm="${r.m}" x="${(r.m * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}"><title>${esc(t('mp.minuteA', { m: r.m, k: r.kills, d: r.deaths, a: r.assists }))}</title></rect>`;
  }).join('');
  const ticks = [0, 10, 20, 30, 40, 50].filter(m => m < rows.length).map(m => `<span style="left:${(100 * m / rows.length).toFixed(2)}%">${m}′</span>`).join('');
  return `<div class="mc"><svg class="mc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-mcn="${rows.length}">
      <line class="mc-axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}</svg>
    <div class="mc-ticks">${ticks}</div><p class="fine">${t('mp.drag')}</p></div>`;
}
const mvWindowLabel = () => (mv.preset ? t('dm.ph.' + mv.preset) : mv.to == null ? t('mp.from', { a: mv.from }) : t('mp.range', { a: mv.from, b: mv.to }));
// only games without a map here (Swarm …)
const mvOnlyOff = parts => parts.length > 0 && parts.every(x => !MapMath.mapOf(x.g));
// a zone's name: the Rift's and ARAM's by word, Arena's by number
const mvZone = z => (/^ar\d$/.test(z) ? t('dm.z.arN', { n: z.slice(2) }) : t('dm.z.' + z));
const MV_MAP_NAMES = { sr: () => t('tags.modeSr'), aram: () => 'ARAM', arena: () => 'Arena' };
// opts.foot: false on the player page (its own line says where the games come from)
function perfMapHtml(parts, opts = {}) {
  // Summoner's Rift, ARAM or Arena: the chosen one if there are games on it, else the one most were played on
  const avail = ['sr', 'aram', 'arena'].filter(m => MapMath.games(parts, m).length);
  const map = avail.includes(mv.map) ? mv.map : MapMath.mainMap(parts) || 'sr';
  const every = MapMath.events(parts, map);
  if (!every.length) return `<div class="chart-empty">${t(mvOnlyOff(parts) ? 'mp.rift' : 'mp.none')}</div>`;
  const maps = avail.length > 1 ? `<div class="seg mp-maps">${avail.map(m => `<button data-mpmap="${m}"${m === map ? ' class="on"' : ''}>${esc(MV_MAP_NAMES[m]())}</button>`).join('')}</div>` : '';
  // Arena: all seven arenas on top of each other, or one of them (only those with something on them)
  const arenaOf = e => { const m = /^ar(\d)$/.exec(e.zone); return m ? +m[1] : 0; };
  const arenas = map === 'arena' ? MapMath.ARENAS.map((_, i) => i + 1).filter(n => every.some(e => arenaOf(e) === n)) : [];
  if (!arenas.includes(mv.arena)) mv.arena = 0;
  const all = mv.arena ? every.filter(e => arenaOf(e) === mv.arena) : every;
  const nGames = mv.arena ? new Set(all.map(e => e.gameId)).size : MapMath.games(parts, map).length;
  const arenaBtns = arenas.length > 1 ? `<div class="seg mp-arenas"><button data-mparena="0"${mv.arena ? '' : ' class="on"'}>${esc(t('mp.allArenas'))}</button>${arenas
    .map(n => `<button data-mparena="${n}" title="${esc(t('dm.z.arN', { n }))}"${mv.arena === n ? ' class="on"' : ''}>${n}</button>`).join('')}</div>` : '';
  const win = all.filter(e => MapMath.inWindow(e, mv.from, mv.to));
  const kinds = MapMath.KINDS.filter(k => mv.kinds.includes(k));
  const shown = win.filter(e => kinds.includes(e.kind));
  const of = k => win.filter(e => e.kind === k);
  // Kills, Deaths, Assists: each on or off by itself (one always stays on)
  const kindBtns = `<div class="seg mp-kinds">${MapMath.KINDS.map(k => `<button data-mpk="${k}"${kinds.includes(k) ? ' class="on"' : ''}><i class="mp-dot ${MV_CLS[k]}"></i>${esc(t('mp.' + MV_CLS[k]))} <small>${of(k).length}</small></button>`).join('')}</div>`;
  const presets = `<div class="seg dm-phases">${Object.keys(MV_PRESETS).map(id => `<button data-dmph="${id}"${mv.preset === id ? ' class="on"' : ''}>${esc(t('dm.ph.' + id))}</button>`).join('')}${mv.preset ? '' : `<button class="on" disabled>${esc(mvWindowLabel())}</button>`}</div>`;
  // the spots that stand out: per phase for the whole game, else for the chosen minutes
  const HOT = { kill: 'mp.hotK', death: 'dm.hot', assist: 'mp.hotA' };
  const hotLine = (label, list, kind) => {
    const z = MapMath.hotspot(MapMath.sum(list, nGames));
    return z ? `<li class="${MV_CLS[kind]}"><b>${esc(label)}</b> ${esc(t(HOT[kind], { pct: Math.round(z.share * 100), zone: mvZone(z.zone), n: z.n, all: list.length }))}</li>` : '';
  };
  const hots = (mv.preset === 'all' ? MapMath.PHASES.map(([id]) => [t('dm.ph.' + id), e => e.phase === id]) : [[mvWindowLabel(), () => true]])
    .flatMap(([label, f]) => kinds.map(kind => hotLine(label, win.filter(e => e.kind === kind && f(e)), kind))).filter(Boolean);
  const lines = [];
  const ds = MapMath.sum(of('death'), nGames), ks = MapMath.sum(of('kill'), nGames), as = MapMath.sum(of('assist'), nGames);
  if (kinds.includes('kill')) lines.push(t('mp.lineK', { n: num(ks.n), games: num(nGames), per: perfDec(ks.perGame), pct2: t('mp.solo', { solo: Math.round((ks.solo || 0) * 100) }) }));
  if (kinds.includes('death')) lines.push(t('dm.line', { n: num(ds.n), games: num(nGames), per: perfDec(ds.perGame), out: Math.round((ds.outnumbered || 0) * 100) }));
  if (kinds.includes('assist')) lines.push(t('mp.lineA', { n: num(as.n), games: num(nGames), per: perfDec(as.perGame) }));
  // per zone: each kind's number first, its bar after it (one kind: also the share)
  const one = kinds.length === 1;
  // Arena: a row per arena (all of them, also with one picked – a click on a row picks it)
  const zrows = MapMath.zonesBy(map === 'arena' ? every.filter(e => MapMath.inWindow(e, mv.from, mv.to)) : win, kinds);
  const rowAt = r => (map === 'arena' && /^ar\d$/.test(r.zone) ? ` data-mparena="${r.zone.slice(2)}" class="mp-row ${mv.arena === +r.zone.slice(2) ? 'on' : 'pick'}"` : ' class="mp-row"');
  const rows = `<div class="mp-rows k${kinds.length}"><div class="mp-row head"><span></span>${kinds.map(k => `<span class="${MV_CLS[k]}">${esc(t('mp.' + MV_CLS[k]))}</span>`).join('')}</div>${zrows.map(r => `<div${rowAt(r)}>
      <span>${esc(mvZone(r.zone))}</span>${kinds.map(k => `<span class="mp-cell"><b>${r.n[k]}</b>${one ? `<small>${Math.round(r.share[k] * 100)} %</small>` : ''}<i class="dm-track ${MV_CLS[k]}"><i style="width:${(r.share[k] * 100).toFixed(1)}%"></i></i></span>`).join('')}</div>`).join('')}</div>`;
  return `<div class="mp-bar">${maps}${arenaBtns}${kindBtns}${presets}</div>
    <div class="dm-wrap"><div class="mp-left">${mapSvg(shown, map)}${mapChart(all.filter(e => kinds.includes(e.kind)))}</div><div class="dm-side">
      ${hots.length ? `<ul class="dm-hots">${hots.join('')}</ul>` : ''}
      ${lines.map(l => `<p class="muted">${esc(l)}</p>`).join('')}
      ${shown.length ? rows : `<div class="chart-empty">${t('mp.empty')}</div>`}
    </div></div>${opts.foot === false ? '' : `<p class="coll-foot">${t(map === 'arena' ? 'mp.basisArena' : 'mp.basis')}</p>`}`;
}
// what is on the map, and when: re-drawn where the map is (Overview or the player page)
function mapRerender() {
  if (typeof renderPerf === 'function' && view === 'dash') renderPerf();
  if (typeof renderPlayer === 'function' && view === 'player') renderPlayer();
}
document.addEventListener('click', e => {
  const k = e.target.closest('[data-mpk]');
  if (k) {
    const kind = k.dataset.mpk;
    const on = mv.kinds.includes(kind) ? mv.kinds.filter(x => x !== kind) : [...mv.kinds, kind];
    // the last one stays on
    if (!on.length) return;
    mv.kinds = MapMath.KINDS.filter(x => on.includes(x));
    try { localStorage.setItem('rs.mapKinds', JSON.stringify(mv.kinds)); } catch { /* not kept */ }
    return mapRerender();
  }
  const mp = e.target.closest('[data-mpmap]');
  if (mp) { mv.map = mp.dataset.mpmap; return mapRerender(); }
  const ma = e.target.closest('[data-mparena]');
  if (ma) { mv.arena = +ma.dataset.mparena; return mapRerender(); }
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
