// The Overview's start page ("At a glance") and the head above every Overview tab – the same for
// your own accounts and for any other player (the player page, player-view.js): who it is, the
// ranks, the splash art of the champion played most, and the best of every other tab with a way into
// it (key figures, form, champions, traits, roles, play style, highlights, mastery or the games with
// you). Uses the globals of renderer.js / views.js / matches-view.js / dashboard.js / perf.js /
// radar-view.js / tags-view.js / ovfilter.js.

// edit: the cards are being arranged (Customize)
const sumv = { scope: '', mast: null, loading: false, edit: false };
const SUM_ARAM = [450, 2400];
const sumSeason = () => new Date(new Date().getFullYear(), 0, 1).getTime();

// ---------- which games ----------
// the participations of a scope: ranked or ARAM of this season, or every game
function sumScopeRows(rows, scope) {
  const from = sumSeason();
  if (scope === 'ranked') return rows.filter(x => Stats.RANKED_QUEUES.includes(x.g.q) && x.g.t >= from);
  if (scope === 'aram') return rows.filter(x => SUM_ARAM.includes(x.g.q) && x.g.t >= from);
  return rows;
}
// the scope shown first: ranked – unless ARAM has more games this season (an ARAM player sees ARAM)
function sumAutoScope(rows) {
  const r = sumScopeRows(rows, 'ranked').length, a = sumScopeRows(rows, 'aram').length;
  return a > r ? 'aram' : r ? 'ranked' : 'all';
}
// the bar under the head: Ranked / ARAM / All, how many of the newest games, where they come from
// attr: the data attribute of the scope buttons (own page: data-sumq, player page: data-plq)
function sumBarHtml(rows, scope, attr, basis = '') {
  const n = k => sumScopeRows(rows, k).length;
  const b = (k, label) => `<button ${attr}="${k}"${scope === k ? ' class="on"' : ''}${k !== 'all' && !n(k) ? ' disabled' : ''}>${esc(label)}${k !== 'all' ? ` <small>${num(n(k))}</small>` : ''}</button>`;
  const lastOwn = perfLastIsOwn(perf.f.last, perf.lastOwn);
  const last = `<select class="pl-last" data-pllast title="${esc(t('perf.lastT'))}">${perfLastOpts(perf.f.last, perf.lastOwn)}</select>`
    + (lastOwn ? `<input class="mh-input num" data-pllastn type="number" min="1" max="9999" placeholder="${esc(t('perf.lastPh'))}" value="${perf.f.last || ''}">` : '');
  return `<div class="seg pl-q">${b('ranked', t('pl.ranked'))}${b('aram', t('ov.scopeAram'))}${b('all', t('pl.all'))}</div>${last}${basis}`;
}

// ---------- the head ----------
// the splash art of a champion's base skin (CommunityDragon): uncentered, else centered, else none
const sumArtUrl = (alias, kind) => `${CDRAGON}/rcp-be-lol-game-data/global/default/assets/characters/${alias}/skins/base/images/${alias}_splash_${kind}_0.jpg`;
function sumArt(el, champ) {
  if (!el) return;
  const c = champ ? champById(champ) : null;
  const alias = c && c.alias ? String(c.alias).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  if (el.dataset.alias === alias) return;
  el.dataset.alias = alias;
  el.classList.remove('on');
  if (!alias) { el.style.backgroundImage = ''; return; }
  const kinds = ['uncentered', 'centered'];
  const next = () => {
    const kind = kinds.shift();
    if (!kind) return;
    const img = new Image();
    img.onload = () => {
      if (el.dataset.alias !== alias) return;
      el.style.backgroundImage = `url("${img.src}")`;
      el.classList.add('on');
    };
    img.onerror = next;
    img.src = sumArtUrl(alias, kind);
  };
  next();
}
// the most played champion of some participations (the head's picture)
function sumTopChamp(rows) {
  const m = new Map();
  for (const x of rows) m.set(x.p.champ, (m.get(x.p.champ) || 0) + 1);
  return ([...m].sort((a, b) => b[1] - a[1])[0] || [0])[0];
}
// one queue's rank, big: crest, tier, LP, wins / losses; note: a line under it (peak, which account)
function sumRank(label, r, note = '') {
  if (!r || !r.tier || !TIERS.includes(r.tier)) {
    return `<div class="ov-rank none"><span class="ov-crest"></span><div><span class="ov-rl">${esc(label)}</span><b>${esc(t('tile.unranked'))}</b>${note ? `<small class="ov-note">${note}</small>` : ''}</div></div>`;
  }
  const games = (r.wins || 0) + (r.losses || 0);
  const wl = r.wl !== false && games ? `${r.wins} W · ${r.losses} L · ${Stats.winPct(r.wins, games)} %` : '';
  return `<div class="ov-rank t-${r.tier.toLowerCase()}"><img class="ov-crest" src="${crestUrl(r.tier)}" alt=""><div><span class="ov-rl">${esc(label)}</span>
    <b>${esc(tierName(r.tier) + (APEX.includes(r.tier) ? '' : ' ' + r.division))} <i>${num(r.lp)} LP</i></b>${wl ? `<small>${esc(wl)}</small>` : ''}${note ? `<small class="ov-note">${note}</small>` : ''}</div></div>`;
}
const sumRankTxt = r => (r && r.tier ? tierName(r.tier) + (APEX.includes(r.tier) ? '' : ' ' + r.division) : '');
// who it is: o = { icons: [iconId …] (more than one: stacked), name, tag, sub, ranks (html) }
function sumWho(o) {
  const icons = (o.icons || []).filter(i => i != null);
  const av = icons.length > 1
    ? `<div class="ov-stack">${icons.slice(0, 4).map(i => `<img src="${iconUrl(i)}" alt="">`).join('')}${icons.length > 4 ? `<span>+${icons.length - 4}</span>` : ''}</div>`
    : `<div class="ov-ava">${icons.length ? `<img src="${iconUrl(icons[0])}" alt="">` : '<span></span>'}</div>`;
  return `<div class="ov-id">${av}<div class="ov-nm"><h1>${esc(o.name)}${o.tag ? `<small>#${esc(o.tag)}</small>` : ''}</h1>${o.sub ? `<p class="sub">${o.sub}</p>` : ''}</div></div>
    ${o.ranks ? `<div class="ov-ranks">${o.ranks}</div>` : ''}`;
}

// the own Overview's head: one account – that account; several – all of them, each queue's best rank
function renderOvHero() {
  const el = $('ovWho');
  if (!el) return;
  const chosen = ovChosen();
  const ranks = q => chosen.filter(a => a[q] && TIERS.includes(a[q].tier)).sort((a, b) => rankScore(b[q]) - rankScore(a[q]))[0];
  const rows = perf.games ? Stats.byParticipation(perf.games).filter(x => chosen.some(a => a.puuid === x.p.puuid)) : [];
  const season = sumScopeRows(rows, sumv.scope || sumAutoScope(rows));
  let who;
  if (chosen.length === 1) {
    const a = chosen[0];
    const peak = a.solo && a.solo.peak && a.solo.peak.tier ? t('ov.peak', { r: sumRankTxt(a.solo.peak) }) : '';
    who = { icons: hides('icon') ? [] : [a.iconId], name: dispName(a), tag: dispTag(a),
      sub: esc([!hides('level') && a.level ? t('scout.level', { n: a.level }) : '', a.region || '', season.length ? t('dash.nGames', { n: num(Stats.uniqueGames(season)) }) : ''].filter(Boolean).join(' · ')),
      ranks: hides('ranks') ? '' : sumRank('Solo/Duo', a.solo, esc(peak)) + sumRank('Flex', a.flex) };
  } else {
    const bs = ranks('solo'), bf = ranks('flex');
    const of = a => (a ? esc(t('ov.bestOf', { name: dispName(a) })) : '');
    who = { icons: hides('icon') ? [] : chosen.map(a => a.iconId), name: t('ov.yourAccounts'),
      sub: esc([t('ov.nAccounts', { n: chosen.length }), season.length ? t('dash.nGames', { n: num(Stats.uniqueGames(season)) }) : ''].filter(Boolean).join(' · ')),
      ranks: hides('ranks') ? '' : sumRank('Solo/Duo', bs && bs.solo, of(bs)) + sumRank('Flex', bf && bf.flex, of(bf)) };
  }
  el.innerHTML = sumWho(who);
  sumArt($('ovArt'), sumTopChamp(season.length ? season : rows));
  if (typeof renderShowcase === 'function') renderShowcase();
}

// ---------- the cards ----------
const sumPct = v => (v == null ? '–' : Math.round(v * 100) + ' %');
const sumCard = (cls, title, body, go = '', extra = '') => `<section class="ovc ovc-${cls}"><div class="ovc-h"><h3>${esc(title)}</h3>${extra}</div>${body}${go}</section>`;
// "Champions →": a way into a tab (only tabs the page has)
const sumGo = (ctx, tab, label) => (ctx.tabs.includes(tab) ? `<button class="ovc-go" data-ovgo="${tab}">${esc(label)} <span>→</span></button>` : '');
const sumWhen = x => `${(champById(x.p.champ) || {}).name || ''} · ${ago(x.g.t)}`;

// a win rate as a ring
function sumRing(v) {
  const r = 15, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v || 0));
  const cls = v >= 0.53 ? 'good' : v <= 0.47 ? 'bad' : '';
  return `<svg class="ov-ring ${cls}" viewBox="0 0 38 38"><circle cx="19" cy="19" r="${r}"/><circle class="v" cx="19" cy="19" r="${r}" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
}
// the key figures, each with its trend: the last 10 games against the 10 before
function sumFigs(parts, scope) {
  const ag = Stats.aggregate(parts);
  if (!ag) return '';
  const arrow = (cur, prev, better, fmt) => {
    if (cur == null || prev == null || Math.abs(cur - prev) < 1e-9) return '';
    const up = (cur - prev) * better > 0;
    return `<em class="${up ? 'up' : 'down'}" title="${esc(t('ov.trendT'))}">${cur > prev ? '▲' : '▼'} ${fmt(Math.abs(cur - prev))}</em>`;
  };
  const tr = k => (parts.length >= 20 ? PerfMath.trend(parts, 10, k) : { ok: false });
  const trArrow = (k, fmt) => { const x = tr(k); return x.ok ? arrow(x.cur, x.prev, x.better, fmt) : ''; };
  const wrT = tr('kda');
  const tile = (cls, label, value, sub = '', trend = '') => `<div class="ovf ${cls}"><span>${esc(label)}</span><b>${value}</b><small>${sub}${trend}</small></div>`;
  const aram = scope === 'aram';
  const tiles = [
    tile('games', t('perf.games'), num(ag.n), esc(t('ov.wl', { w: ag.wins, l: ag.losses }))),
    `<div class="ovf wr">${sumRing(ag.winrate)}<div><span>${esc(t('dash.wr'))}</span><b class="${ag.winrate >= 0.53 ? 'good' : ag.winrate <= 0.47 ? 'bad' : ''}">${sumPct(ag.winrate)}</b><small>${wrT.ok ? arrow(wrT.wr[0], wrT.wr[1], 1, v => Math.round(v * 100) + ' %') : ''}</small></div></div>`,
    tile('kda', 'KDA', ag.perfect ? esc(t('perf.perfect')) : perfDec(ag.kda, 2), esc(perfAvg(ag)), trArrow('kda', v => perfDec(v, 2))),
    aram ? '' : tile('cs', t('det.csMin'), perfDec(ag.csMin), '', trArrow('csMin', v => perfDec(v))),
    tile('dmg', t('perf.dmgMin'), num(Math.round(ag.dmgMin)), '', trArrow('dmgMin', v => num(Math.round(v)))),
    tile('kp', t('perf.kp'), sumPct(ag.kp), '', trArrow('kp', v => Math.round(v * 100) + ' %')),
    aram ? tile('share', t('ov.dmgShare'), sumPct(ag.dmgShare)) : tile('vis', t('perf.visMin'), perfDec(ag.visMin, 2), '', trArrow('visMin', v => perfDec(v, 2))),
  ];
  return `<div class="ovc-figs">${tiles.join('')}</div>`;
}

// form: the last 20 games as pictures, the record and the streak; own accounts: the LP of 30 days
function sumForm(parts, ctx) {
  const all = [...parts].sort((a, b) => b.g.t - a.g.t);
  const list = all.slice(0, 20);
  if (!list.length) return sumCard('form', t('ov.form'), `<p class="muted">${esc(t('ov.none'))}</p>`);
  const w = list.filter(x => x.p.win).length;
  let streak = 0;
  for (const x of all) { if (!!x.p.win !== !!all[0].p.win) break; streak++; }
  const tip = x => [t('mh.' + (x.p.win ? 'win' : 'loss')), (champById(x.p.champ) || {}).name || '', `${x.p.k}/${x.p.d}/${x.p.a}`, queueLabel(x.g), ago(x.g.t)].filter(Boolean).join(' · ');
  const tag = ctx.own ? 'button' : 'span';
  const games = list.map(x => `<${tag} class="sf-g ${x.p.win ? 'win' : 'loss'}"${ctx.own ? ` data-opengame="${esc(x.g.id)}"` : ''} title="${esc(tip(x))}"><img src="${champIcon(x.p.champ)}" alt="" loading="lazy"></${tag}>`).join('');
  // the curve: +1 a win, −1 a loss, oldest left
  const steps = [0];
  for (const x of [...list].reverse()) steps.push(steps[steps.length - 1] + (x.p.win ? 1 : -1));
  const lo = Math.min(...steps), hi = Math.max(...steps), H = 56, W = 300;
  const y = v => (hi === lo ? H / 2 : 4 + (H - 8) * (1 - (v - lo) / (hi - lo)));
  const xs = i => (W * i) / Math.max(1, steps.length - 1);
  const line = steps.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const zero = y(0).toFixed(1);
  const curve = ctx.lp || (list.length < 5 ? '' : `<div class="sf-curve"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="z"/>
    <path class="a" d="${line}L${W},${zero}L0,${zero}Z"/><path class="l" d="${line}"/></svg><small>${esc(t('ov.curve', { n: list.length }))}</small></div>`);
  const head = `<div class="sf-line"><b>${esc(t('ov.wl', { w, l: list.length - w }))}</b><span class="${w / list.length >= 0.53 ? 'good' : w / list.length <= 0.47 ? 'bad' : ''}">${Stats.winPct(w, list.length)} %</span>
    ${streak >= 2 && (all[0].p.win || !ctx.others) ? `<span class="sf-streak ${all[0].p.win ? 'w' : 'l'}">${esc(t(all[0].p.win ? 'mh.streakW' : 'mh.streakL', { n: streak }))}</span>` : ''}</div>`;
  return sumCard('form', t('ov.form'), `${head}<div class="sf-games">${games}</div>${curve}`, sumGo(ctx, 'lp', t('dash.tabLp')), `<span class="ovc-sub">${esc(t('ov.lastN', { n: list.length }))}</span>`);
}
// the own accounts' LP of the last 30 days: the account and queue with the most games in them
function sumLp(accs) {
  if (!dash.data || hides('ranks')) return '';
  const now = Date.now(), t0 = now - 30 * DAY;
  let best = null;
  for (const a of accs) {
    const d = dash.data.find(x => x.puuid === a.puuid);
    if (!d) continue;
    for (const q of ['solo', 'flex']) {
      const pts = (d.history || []).filter(e => e[q] && TIERS.includes(e[q].tier)).map(e => ({ t: e.t, v: rankScore(e[q]) }));
      if (a[q] && TIERS.includes(a[q].tier)) pts.push({ t: now, v: rankScore(a[q]) });
      const games = (d.games || []).filter(g => g.q === q && g.t >= t0).length;
      if (pts.length < 2 || !games) continue;
      if (!best || games > best.games) best = { a, q, pts, games };
    }
  }
  if (!best) return '';
  const start = valueAt(best.pts, t0) ?? best.pts.find(p => p.t >= t0).v;
  const pts = [{ t: t0, v: start }, ...best.pts.filter(p => p.t > t0)];
  const cur = pts[pts.length - 1].v, delta = cur - start;
  const lo = Math.min(...pts.map(p => p.v)) - 10, hi = Math.max(...pts.map(p => p.v)) + 10, W = 300, H = 56;
  const x = ts => (W * (ts - t0)) / (now - t0), y = v => H - (H * (v - lo)) / Math.max(1, hi - lo);
  const d = pts.map((p, i) => (i ? `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}` : `M0,${y(p.v).toFixed(1)}`)).join('') + `H${W}`;
  const tier = RankMath.scoreToRank(Math.min(cur, 2800)).tier;
  return `<div class="sf-curve lp" style="--tc:${TIER_COLORS[tier] || 'var(--gold)'}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="a" d="${d}V${H}H0Z"/><path class="l" d="${d}"/></svg>
    <small>${esc(t('ov.lp30', { name: dispName(best.a), q: dashQName(best.q) }))} · <b class="${delta > 0 ? 'good' : delta < 0 ? 'bad' : ''}">${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} LP</b> · ${esc(rankText(cur))}</small></div>`;
}

// the most played champions: games, win rate as a bar, KDA
function sumChamps(parts, ctx) {
  const rows = PerfMath.champRows(parts).slice(0, 6);
  const body = rows.map(r => {
    const wr = Math.round(r.winrate * 100);
    const cls = r.n >= PerfMath.MARK.minGames ? (r.winrate >= 0.55 ? 'good' : r.winrate <= 0.45 ? 'bad' : '') : 'few';
    return `<div class="scr"><img src="${champIcon(r.champ)}" alt="" loading="lazy"><span class="scr-n"><b title="${esc(perfChamp(r.champ))}">${esc(perfChamp(r.champ))}</b><small>${esc(perfGames(r.n))}</small></span>
      <span class="scr-wr ${cls}"><i class="scr-bar"><i style="width:${wr}%"></i></i><b>${wr} %</b></span>
      <span class="scr-k"><b>${r.perfect ? esc(t('perf.perfect')) : perfDec(r.kda, 2)}</b><small>${perfAvg(r)}</small></span></div>`;
  }).join('');
  return sumCard('champs', t('pl.champs'), body || `<p class="muted">${esc(t('ov.none'))}</p>`, sumGo(ctx, 'champs', t('dash.tabChamps')));
}

// traits: strengths and things to work on (res: Tags.evaluate…; null = none for this scope). The
// role tags of the main position only (the position played most) – or of every position, a switch
// in the card's head (kept in this browser: rs.sumTraitsAll)
const sumTraitsAll = () => { try { return localStorage.getItem('rs.sumTraitsAll') === '1'; } catch (e) { return false; } };
function sumTraits(res, ctx) {
  const chip = x => `<span class="tchip tc-${tagColor(x)}" title="${esc([tagText(x), tagRoleText(x)].filter(Boolean).join('\n'))}">${tagRoleIcon(x)}${esc(tagName(x))}</span>`;
  const main = res && !res.aram ? res.main || res.most : null;
  const roles = res && res.roles ? res.roles.length : 0;
  const all = sumTraitsAll() || !main;
  const picked = res ? Tags.pick(res.results).filter(x => all || !x.role || x.role === main) : [];
  const strong = picked.filter(Tags.isStrength), weak = picked.filter(Tags.isWeakness), rest = picked.filter(x => !Tags.isStrength(x) && !Tags.isWeakness(x));
  const body = picked.length ? `<div class="st-sec"><span class="d-sec-t">${t('tags.strengths')}</span><div class="tchips">${strong.map(chip).join('') || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>
    ${ctx.others ? '' : `<div class="st-sec"><span class="d-sec-t">${t('tags.work')}</span><div class="tchips">${weak.map(chip).join('') || `<span class="muted">${t('tags.nothing')}</span>`}</div></div>`}
    ${rest.length ? `<div class="st-sec"><span class="d-sec-t">${t('ov.more')}</span><div class="tchips">${rest.map(chip).join('')}</div></div>` : ''}`
    : `<p class="muted">${esc(t(ctx.scope === 'aram' ? 'ov.noAramTraits' : 'tags.none'))}</p>`;
  const sw = main && roles > 1
    ? `<button class="ovc-sub st-pos" data-straits title="${esc(t(all ? 'ov.traitsMainT' : 'ov.traitsAllT'))}">${all ? esc(t('ov.allPos')) : `<img src="${posIcon(main)}" alt="">${esc(t('pos.' + main))}`}</button>`
    : main && !ctx.others ? `<span class="ovc-sub st-pos"><img src="${posIcon(main)}" alt="">${esc(t('pos.' + main))}</span>` : '';
  const mode = ctx.scope === 'aram' ? `<span class="ovc-sub">ARAM</span>` : `${sw}<span class="ovc-sub">${esc(t('pl.ranked'))}</span>`;
  return sumCard('traits', t('dash.tabTags'), body, sumGo(ctx, 'tags', t('dash.tabTags')), mode);
}

// roles: each position's share of the games, with its win rate
function sumRoles(parts, ctx) {
  const mr = Tags.mainRole(parts);
  if (!mr.total) return sumCard('roles', t('ov.roles'), `<p class="muted">${esc(t('pl.noRoles'))}</p>`, sumGo(ctx, 'stats', t('dash.tabStats')));
  const by = Stats.groupBy(parts.filter(x => Stats.role(x.g, x.p)), x => Stats.role(x.g, x.p));
  const body = [...mr.shares].sort((a, b) => b[1] - a[1]).map(([r, n]) => {
    const share = Math.round((100 * n) / mr.total), ag = by.get(r);
    return `<div class="sro${r === mr.main ? ' main' : ''}"><img src="${posIcon(r)}" alt=""><span>${esc(t('pos.' + r))}</span><i class="scr-bar"><i style="width:${share}%"></i></i>
      <b>${share} %</b><small class="${ag && ag.n >= 5 ? (ag.winrate >= 0.55 ? 'good' : ag.winrate <= 0.45 ? 'bad' : '') : ''}">${ag ? esc(t('ov.wrShort', { wr: Math.round(ag.winrate * 100) })) : ''}</small></div>`;
  }).join('');
  const main = mr.main ? `<span class="ovc-sub">${esc(t('tags.roleMain', { role: t('pos.' + mr.main) }))}</span>` : '';
  return sumCard('roles', t('ov.roles'), body, sumGo(ctx, 'stats', t('dash.tabStats')), main);
}

// play style: the radar against the lane opponent on the main role, the clearest differences
function sumStyle(parts, ctx) {
  const mr = Tags.mainRole(parts);
  const role = mr.main || mr.most;
  const axes = role ? Radar.radar(parts.filter(x => Stats.role(x.g, x.p) === role)) : [];
  const known = axes.filter(a => a.ratio != null);
  if (known.length < 3) return sumCard('style', t('dash.tabStyle'), `<p class="muted">${esc(t('rad.none'))}</p>`, sumGo(ctx, 'style', t('dash.tabStyle')));
  const top = [...known].sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)).slice(0, 3)
    .map(a => `<li class="${a.ratio >= 1 ? 'good' : 'bad'}" title="${esc(radarTip(a))}"><b>${radarDiff(a.ratio)} %</b> ${esc(t('rad.' + a.id))}</li>`).join('');
  return sumCard('style', t('dash.tabStyle'), `<div class="ss-wrap">${radarSvg(axes, 200)}<ul class="ss-top">${top}</ul></div>`, sumGo(ctx, 'style', t('dash.tabStyle')),
    `<span class="ovc-sub">${esc(t('ov.styleVs', { role: t('pos.' + role) }))}</span>`);
}

// ARAM: the share of the own team – damage, damage taken, healing, crowd control, gold – with a
// line at a fair fifth
function sumTeamShare(parts, ctx) {
  const KEYS = [['dmg', p => p.dmg], ['taken', p => p.x && p.x.taken], ['heal', p => p.x && p.x.heal], ['cc', p => p.x && p.x.cc], ['gold', p => p.gold]];
  const full = parts.filter(x => !x.g.lite && x.g.players && x.g.players.length >= 10);
  const rows = KEYS.map(([k, of]) => {
    const v = full.map(x => {
      if (k !== 'dmg' && k !== 'gold' && !x.p.x) return null;
      const team = Stats.team(x.g, x.p), sum = team.reduce((s, o) => s + (of(o) || 0), 0);
      return sum > 0 ? (of(x.p) || 0) / sum : null;
    }).filter(v => v != null);
    return { k, v: v.length >= 3 ? v.reduce((s, a) => s + a, 0) / v.length : null, n: v.length };
  });
  const kp = Stats.aggregate(full);
  if (!rows.some(r => r.v != null)) return sumCard('share', t('ov.teamShare'), `<p class="muted">${esc(t('ov.none'))}</p>`);
  const body = rows.map(r => `<div class="sro share" title="${esc(t('ov.shareT'))}"><span>${esc(t('ov.sh.' + r.k))}</span><i class="scr-bar fair"><i style="width:${r.v == null ? 0 : Math.min(100, r.v * 250).toFixed(1)}%"></i></i>
      <b class="${r.v == null ? '' : r.v >= 0.24 ? 'good' : r.v <= 0.16 ? 'bad' : ''}">${sumPct(r.v)}</b></div>`).join('')
    + (kp && kp.kp != null ? `<p class="fine">${esc(t('ov.kpLine', { kp: Math.round(kp.kp * 100) }))}</p>` : '');
  return sumCard('share', t('ov.teamShare'), body, sumGo(ctx, 'stats', t('dash.tabStats')), `<span class="ovc-sub">${esc(t('ov.fair'))}</span>`);
}

// activity: time played, the usual game length, days played, the busiest weekday
function sumActivity(parts) {
  const games = [...new Map(parts.map(x => [String(x.g.id), x.g])).values()];
  if (!games.length) return sumCard('act', t('ov.activity'), `<p class="muted">${esc(t('ov.none'))}</p>`);
  const secs = games.reduce((s, g) => s + (g.dur || 0), 0);
  const days = new Set(games.map(g => new Date(g.t).toDateString())).size;
  const wd = new Map();
  for (const g of games) { const d = new Date(g.t).getDay(); wd.set(d, (wd.get(d) || 0) + 1); }
  const [day] = [...wd].sort((a, b) => b[1] - a[1])[0];
  const dayName = new Date(2024, 0, 7 + day).toLocaleDateString(locale(), { weekday: 'long' });
  const hm = s => t('ov.hm', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) });
  const row = (label, v) => `<div class="sac"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;
  return sumCard('act', t('ov.activity'), row(t('ov.time'), hm(secs)) + row(t('ov.avgLen'), t('ov.min', { m: Math.round(secs / games.length / 60) }))
    + row(t('ov.days'), t('ov.daysV', { d: days, g: perfDec(games.length / days, 1) })) + row(t('ov.weekday'), dayName));
}

// highlights: the best games and the multikills
function sumRecords(parts, ctx) {
  if (!parts.length) return sumCard('rec', t('ov.records'), `<p class="muted">${esc(t('ov.none'))}</p>`);
  const best = f => parts.reduce((b, x) => (f(x) > f(b) ? x : b), parts[0]);
  const kd = x => (x.p.k + x.p.a) / Math.max(1, x.p.d);
  const k = best(x => x.p.k), kda = best(x => kd(x) * 1000 + x.p.k), dmg = best(x => x.p.dmg || 0);
  const csm = best(x => Stats.csMin(x.g, x.p));
  // the longest run of wins, oldest to newest
  let run = 0, longest = 0;
  for (const x of [...parts].sort((a, b) => a.g.t - b.g.t)) { run = x.p.win ? run + 1 : 0; longest = Math.max(longest, run); }
  const multi = m => parts.filter(x => Math.min(5, x.p.multi || 0) === m).length;
  const row = (label, x, value) => `<${ctx.own ? 'button' : 'div'} class="srec"${ctx.own ? ` data-opengame="${esc(x.g.id)}"` : ''}><img src="${champIcon(x.p.champ)}" alt="" loading="lazy">
    <span><small>${esc(label)}</small><b>${esc(value)}</b></span><em>${esc(sumWhen(x))}</em></${ctx.own ? 'button' : 'div'}>`;
  const ms = [[5, 'mh.pentas'], [4, 'ov.quadras'], [3, 'ov.triples']].map(([m, key]) => [multi(m), key]).filter(([n]) => n).slice(0, 2);
  const body = row(t('mh.recKills'), k, t('ov.kills', { n: k.p.k })) + row(t('mh.recKda'), kda, `${kda.p.k} / ${kda.p.d} / ${kda.p.a}`)
    + row(t('mh.recDmg'), dmg, num(dmg.p.dmg || 0)) + (ctx.scope === 'aram' ? '' : row(t('mh.sCs'), csm, `${perfDec(Stats.csMin(csm.g, csm.p))} CS/min`))
    + `<div class="srec plain"><span class="srec-ic">★</span><span><small>${esc(t('ov.streak'))}</small><b>${esc(longest >= 2 ? t('mh.streakW', { n: longest }) : '–')}</b></span>
      <em>${ms.length ? esc(ms.map(([n, key]) => t(key, { n })).join(' · ')) : ''}</em></div>`;
  return sumCard('rec', t('ov.records'), body);
}

// mastery: the champions with the most points (own: every chosen account together)
// the player page: the games with you on top, their mastery under it (max: how many champions)
function sumMastery(list, ctx, max = 4) {
  const rows = (list || []).slice(0, max);
  const body = rows.length ? rows.map((m, i) => `<div class="smy${i ? '' : ' top'}"><img src="${champIcon(m.id)}" alt="" loading="lazy"><span><b>${esc(perfChamp(m.id))}</b>
      <small>${esc(t('pl.points', { n: num(m.total) }))}</small></span></div>`).join('')
    : `<p class="muted">${esc(t('ov.noMastery'))}</p>`;
  if (ctx.withYou != null) {
    return sumCard('mast', t('pl.withYou'), `${ctx.withYou}<div class="st-sec smy-sec"><span class="d-sec-t">${t('dash.tabMast')}</span>${body}</div>`);
  }
  return sumCard('mast', t('dash.tabMast'), body, sumGo(ctx, 'mast', t('dash.tabMast')));
}

// the whole page. ctx: { parts (the scope's participations), scope, res (traits), mastery: [{ id, total, lvl }] or null,
//   lp (html: own accounts) , withYou (html: the player page), own (games open in the match history), tabs: tabs the page has }
// the recent games: champion, result, K/D/A, queue, when (own games open in the match history)
function sumGames(parts, ctx) {
  const list = [...parts].sort((a, b) => b.g.t - a.g.t).slice(0, 8);
  const tag = ctx.own ? 'button' : 'div';
  const body = list.map(x => {
    const res = x.p.win ? 'win' : 'loss';
    return `<${tag} class="sgm ${res}"${ctx.own ? ` data-opengame="${esc(x.g.id)}"` : ''}><img src="${champIcon(x.p.champ)}" alt="" loading="lazy"><b>${t('mh.' + res)}</b>
      <span>${x.p.k} / ${x.p.d} / ${x.p.a}</span><span class="q">${esc(queueLabel(x.g))}</span><small>${esc(ago(x.g.t))}</small></${tag}>`;
  }).join('');
  return sumCard('games', t('pl.recent'), body || `<p class="muted">${esc(t('ov.none'))}</p>`);
}
// the map: where the deaths are, with the spot that stands out
function sumMap(parts, ctx) {
  const ev = MapMath.events(parts).filter(e => e.kind === 'death');
  const go = sumGo(ctx, 'map', t('dash.tabMap'));
  if (!ev.length) return sumCard('map', t('dash.tabMap'), `<p class="muted">${esc(t(mvOnlyOff(parts) ? 'mp.rift' : 'mp.none'))}</p>`, go);
  const z = MapMath.hotspot(MapMath.sum(ev, MapMath.games(parts).length));
  return sumCard('map', t('dash.tabMap'), `<div class="smap">${mapSvg(ev)}</div>${z ? `<p class="fine">${esc(t('dm.hot', { pct: Math.round(z.share * 100), zone: t('dm.z.' + z.zone), n: z.n, all: ev.length }))}</p>` : ''}`, go);
}

// ---------- the cards and their layout ----------
// Every card has an id; "At a glance" shows them in its designed layout (no holes at any width) –
// or, once arranged by hand (setting ovLayout: { order, hidden, size }), in that order and size on
// a grid of 1–4 columns. Sizes: 1 small, 2 wide, 4 the full row. "Form" and "Map" are extra cards,
// hidden until added ("Recent games" has the form's place in the designed layout).
const SUM_CARDS = ['figs', 'games', 'traits', 'champs', 'roles', 'style', 'rec', 'mast', 'form', 'map'];
const SUM_EXTRA = ['form', 'map'];
const SUM_SIZE = { figs: 4, form: 2, traits: 1, champs: 1, roles: 1, style: 1, rec: 1, mast: 1, games: 2, map: 1 };
const SUM_NAME = { figs: 'pl.figures', form: 'ov.form', traits: 'dash.tabTags', champs: 'pl.champs', roles: 'ov.roles', style: 'dash.tabStyle',
  rec: 'ov.records', mast: 'dash.tabMast', games: 'pl.recent', map: 'dash.tabMap' };
function sumCardOf(id, p, ctx) {
  const aram = ctx.scope === 'aram';
  const html = {
    figs: () => `<section class="ovc ovc-figsw">${sumFigs(p, ctx.scope)}</section>`,
    form: () => sumForm(p, ctx), traits: () => sumTraits(ctx.res, ctx), champs: () => sumChamps(p, ctx),
    roles: () => (aram ? sumTeamShare(p, ctx) : sumRoles(p, ctx)), style: () => (aram ? sumActivity(p) : sumStyle(p, ctx)),
    rec: () => sumRecords(p, ctx), mast: () => sumMastery(ctx.mastery, ctx, ctx.withYou != null ? 3 : 4),
    games: () => sumGames(p, ctx), map: () => sumMap(p, ctx),
  }[id]();
  return html.replace('<section class="', `<section data-card="${id}" class="`);
}
// the arrangement by hand, or null (the designed layout)
const sumLayout = () => { const l = S.settings && S.settings.ovLayout; return l && Array.isArray(l.order) && l.order.length ? l : null; };
// every card in its place: { order (all cards), hidden (Set), size }
function sumLayoutFull(l) {
  const order = (l ? l.order : SUM_CARDS).filter(id => SUM_CARDS.includes(id));
  const extra = SUM_CARDS.filter(id => !order.includes(id));
  return { order: [...order, ...extra], hidden: new Set(l ? [...(l.hidden || []), ...extra.filter(id => SUM_EXTRA.includes(id))] : SUM_EXTRA),
    size: { ...SUM_SIZE, ...((l && l.size) || {}) } };
}
function sumHtml(ctx) {
  const p = ctx.parts;
  if (!p.length) return `<div class="ov-empty"><b>${esc(t('ov.emptyT'))}</b><p>${esc(t(ctx.emptyKey || 'ov.empty'))}</p></div>`;
  const l = sumLayout();
  if (!l && !sumv.edit) return `<div class="ov-sum">${SUM_CARDS.filter(id => !SUM_EXTRA.includes(id)).map(id => sumCardOf(id, p, ctx)).join('')}</div>`;
  const lay = sumLayoutFull(l);
  const tools = id => `<div class="ovc-edit"><span class="ovc-drag" title="${esc(t('ov.drag'))}">⠿</span>
    <button data-omove="${id}:-1" title="${esc(t('ov.moveL'))}">←</button><button data-omove="${id}:1" title="${esc(t('ov.moveR'))}">→</button>
    ${[[1, 'ov.sizeS', 'S'], [2, 'ov.sizeM', 'M'], [4, 'ov.sizeL', 'L']].map(([n, key, l2]) => `<button data-osize="${id}:${n}" title="${esc(t(key))}"${lay.size[id] === n ? ' class="on"' : ''}>${l2}</button>`).join('')}
    <button data-ohide="${id}" title="${esc(t('ov.hide'))}">✕</button></div>`;
  const cards = lay.order.filter(id => !lay.hidden.has(id)).map(id => {
    let h = sumCardOf(id, p, ctx).replace(`<section data-card="${id}"`, `<section data-card="${id}" data-span="${lay.size[id]}"${sumv.edit ? ' draggable="true"' : ''}`);
    if (sumv.edit) h = h.replace(/<\/section>$/, `${tools(id)}</section>`);
    return h;
  }).join('');
  const hidden = lay.order.filter(id => lay.hidden.has(id));
  const tray = sumv.edit ? `<div class="ov-tray"><span class="ov-tray-t">${esc(t('ov.editHint'))}</span>
      <span class="ov-tray-h">${hidden.length ? `${esc(t('ov.hiddenCards'))} ${hidden.map(id => `<button class="chip" data-oadd="${id}">+ ${esc(t(SUM_NAME[id]))}</button>`).join('')}` : esc(t('ov.noneHidden'))}</span>
      <span class="grow"></span><button class="btn small" data-oreset>${esc(t('ov.reset'))}</button><button class="btn small gold" data-odone>${esc(t('ov.done'))}</button></div>` : '';
  return `${tray}<div class="ov-sum custom${sumv.edit ? ' editing' : ''}">${cards}</div>`;
}
// the "Customize" button in the bar above the cards
const sumCustBtn = () => (sumv.edit ? '' : `<button class="btn small ov-cust" data-ocust title="${esc(t('ov.customizeT'))}"><svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>${esc(t('ov.customize'))}</button>`);
// a change of the arrangement: kept (the setting) and drawn again where it is shown
function sumSaveLayout(lay) {
  const l = { order: lay.order, hidden: [...lay.hidden], size: lay.size };
  S.settings = { ...S.settings, ovLayout: l };
  api.setSetting('ovLayout', l);
  sumRedraw();
}
const sumRedraw = () => (view === 'player' ? renderPlayer() : renderSum());
// the traits card: main position ⇄ every position
document.addEventListener('click', e => {
  if (!e.target.closest('[data-straits]')) return;
  try { localStorage.setItem('rs.sumTraitsAll', sumTraitsAll() ? '0' : '1'); } catch (err) { /* only for this time */ }
  sumRedraw();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ocust], [data-odone], [data-oreset], [data-oadd], [data-ohide], [data-osize], [data-omove]');
  if (!b || !b.closest('#viewDash, #viewPlayer')) return;
  if (b.dataset.ocust !== undefined) { sumv.edit = true; return sumRedraw(); }
  if (b.dataset.odone !== undefined) { sumv.edit = false; return sumRedraw(); }
  if (b.dataset.oreset !== undefined) {
    S.settings = { ...S.settings, ovLayout: null };
    api.setSetting('ovLayout', null);
    return sumRedraw();
  }
  const lay = sumLayoutFull(sumLayout());
  if (b.dataset.oadd) { lay.hidden.delete(b.dataset.oadd); lay.order = [...lay.order.filter(x => x !== b.dataset.oadd), b.dataset.oadd]; }
  else if (b.dataset.ohide) lay.hidden.add(b.dataset.ohide);
  else if (b.dataset.osize) { const [id, n] = b.dataset.osize.split(':'); lay.size[id] = Number(n); }
  else if (b.dataset.omove) {
    // one place left or right among the shown cards
    const [id, d] = b.dataset.omove.split(':');
    const shown = lay.order.filter(x => !lay.hidden.has(x));
    const i = shown.indexOf(id), j = i + Number(d);
    if (i < 0 || j < 0 || j >= shown.length) return;
    [shown[i], shown[j]] = [shown[j], shown[i]];
    lay.order = [...shown, ...lay.order.filter(x => lay.hidden.has(x))];
  }
  sumSaveLayout(lay);
});
// dragging a card onto another: before it (left half) or after it (right half)
let sumDrag = '';
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('.ov-sum.editing [data-card]');
  if (!c) return;
  sumDrag = c.dataset.card;
  c.classList.add('dragging');
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sumDrag); }
});
document.addEventListener('dragover', e => {
  const c = e.target.closest && e.target.closest('.ov-sum.editing [data-card]');
  if (!c || !sumDrag) return;
  e.preventDefault();
  const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
  document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (c.dataset.card !== sumDrag) c.classList.add(after ? 'drop-after' : 'drop-before');
});
document.addEventListener('drop', e => {
  const c = e.target.closest && e.target.closest('.ov-sum.editing [data-card]');
  if (!c || !sumDrag) return;
  e.preventDefault();
  const to = c.dataset.card, after = c.classList.contains('drop-after');
  const lay = sumLayoutFull(sumLayout());
  if (to !== sumDrag) {
    const order = lay.order.filter(x => x !== sumDrag);
    order.splice(order.indexOf(to) + (after ? 1 : 0), 0, sumDrag);
    lay.order = order;
    sumSaveLayout(lay);
  }
  sumDrag = '';
});
document.addEventListener('dragend', () => {
  sumDrag = '';
  document.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after'));
});

// ---------- the own Overview's "At a glance" ----------
async function loadSum() {
  if (sumv.loading) return;
  sumv.loading = true;
  try {
    const [g, m, ch] = await Promise.all([allGames(), api.masteries(), champs.length ? null : api.champions()]);
    if (Array.isArray(ch) && ch.length) champs = ch;
    perf.games = g || [];
    sumv.mast = Array.isArray(m) ? m : [];
    if (!dash.data) { const d = await api.dashboard(); dash.data = Array.isArray(d) ? d : []; }
  } catch (e) { console.warn('summary', e); }
  sumv.loading = false;
  renderSum();
}
const sumOn = () => view === 'dash' && dashTab() === 'sum';
api.onMatchesChanged(() => { if (sumOn()) loadSum(); });
// the traits of a scope: ranked (all roles) or ARAM
function sumRes(games, puuids, level, mastery, scope) {
  if (scope === 'aram') return typeof Tags.evaluateAram === 'function' ? Tags.evaluateAram({ games, own: puuids, now: Date.now() }) : null;
  return Tags.evaluateAll({ games, own: puuids, level, mastery, now: Date.now() });
}
function renderSum() {
  const el = $('sumBody');
  if (!el || $('dashSum').hidden) return;
  renderOvHero();
  if (!perf.games) { $('sumBar').innerHTML = ''; el.innerHTML = `<div class="chart-empty">${t('mh.loading')}</div>`; return; }
  const chosen = ovChosen(), ids = chosen.map(a => a.puuid);
  const rows = Stats.byParticipation(perf.games).filter(x => ids.includes(x.p.puuid));
  const scope = sumv.scope || sumAutoScope(rows);
  const parts = PerfMath.lastGames(sumScopeRows(rows, scope), perf.f.last);
  $('sumBar').innerHTML = sumBarHtml(rows, scope, 'data-sumq') + sumCustBtn();
  const read = (sumv.mast || []).filter(m => ids.includes(m.puuid));
  const table = read.length ? MastMath.masteryTable(read) : null;
  const acc = chosen.length === 1 ? chosen[0] : null;
  const mastery = table && table.map(r => ({ id: r.id, total: r.total }));
  el.innerHTML = sumHtml({ parts, scope, own: true, tabs: DASH_TABS, lp: sumLp(chosen), mastery,
    res: sumRes(perf.games, ids, acc && acc.level != null ? acc.level : null, table, scope) });
}
api.onState(() => { if (view === 'dash') renderOvHero(); });
// a click on "→": that tab; the scope, how many games
function sumGoTab(tab) {
  showDashTab(tab);
  const top = document.querySelector('main');
  if (top) top.scrollTop = 0;
}
$('viewDash').addEventListener('click', e => {
  const go = e.target.closest('[data-ovgo]');
  if (go) return sumGoTab(go.dataset.ovgo);
  const q = e.target.closest('[data-sumq]');
  if (q && !q.disabled) { sumv.scope = q.dataset.sumq; return renderSum(); }
});
$('viewDash').addEventListener('change', e => {
  if (!e.target.closest('#dashSum')) return;
  if (e.target.matches('[data-pllast]')) {
    perf.lastOwn = e.target.value === 'own';
    if (!perf.lastOwn) perfSetLast(Number(e.target.value));
    renderSum();
    if (perf.lastOwn) { const n = $('sumBar').querySelector('[data-pllastn]'); if (n) { n.focus(); n.select(); } }
  } else if (e.target.matches('[data-pllastn]')) { perfSetLast(Number(e.target.value)); renderSum(); }
});

// ---------- the head of every other page: a champion's splash art ----------
// Accounts: the signed-in (or first) account's best mastery champion; Collection and Tools: the next
// ones; Match history: the champion of the newest game; Live: the champion picked now.
const PG_ART = { accounts: 'pgArtAccounts', coll: 'pgArtColl', live: 'pgArtLive', matches: 'pgArtMatches', tools: 'pgArtTools' };
let pgArtAsked = false;
function pgTopChamps() {
  const accs = (S.accounts || []).filter(a => !a.placeholder);
  const first = accs.find(a => a.puuid === (S.live && S.live.puuid)) || accs.find(a => a.puuid === S.active);
  const out = [];
  for (const a of [first, ...accs].filter(Boolean)) for (const m of (a.profile && a.profile.topMastery) || []) if (m && m.id && !out.includes(m.id)) out.push(m.id);
  return out;
}
function pgLiveChamp() {
  const d = typeof liveData !== 'undefined' ? liveData : null;
  if (!d || !d.me) return 0;
  const list = [...((d.champSelect && d.champSelect.allies) || []), ...((d.inGame && [...(d.inGame.teamOne || []), ...(d.inGame.teamTwo || [])]) || [])];
  const me = list.find(p => p.puuid === d.me && p.championId);
  return me ? me.championId : 0;
}
function pageArt(v) {
  const el = $(PG_ART[v] || '');
  if (!el) return;
  if (!champs.length) {
    if (!pgArtAsked) { pgArtAsked = true; api.champions().then(c => { if (Array.isArray(c) && c.length) { champs = c; pageArt(view); } }).catch(() => {}); }
    return;
  }
  const top = pgTopChamps();
  let champ = { accounts: top[0], coll: top[1] || top[0], tools: top[2] || top[0] }[v] || 0;
  if (v === 'matches') { const g = mh.data && mh.data.games && mh.data.games[0]; champ = (g && MatchFilter.me(g) && MatchFilter.me(g).champ) || top[0]; }
  if (v === 'live') champ = pgLiveChamp() || top[0];
  sumArt(el, champ || 0);
}
api.onState(() => pageArt(view));
