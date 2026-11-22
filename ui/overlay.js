// The in-game overlay: the app calls update() every 2 seconds with the item value of both teams
// (and lane against lane when the positions are known).
(function () {
  const $ = id => document.getElementById(id);
  const k = n => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
  const sign = n => (n > 0 ? '▲ ' + k(n) : n < 0 ? '▼ ' + k(-n) : '±0');
  const LANE = { top: 'TOP', jgl: 'JGL', mid: 'MID', bot: 'BOT', sup: 'SUP' };
  window.update = g => {
    const d = g.mine - g.theirs;
    $('ovMine').textContent = k(g.mine);
    $('ovTheirs').textContent = k(g.theirs);
    $('ovDiff').textContent = sign(d);
    $('ovDiff').className = 'ov-diff' + (d > 0 ? ' up' : d < 0 ? ' down' : '');
    $('ovLanes').innerHTML = (g.lanes || []).map(l => {
      const c = l.diff > 0 ? 'up' : l.diff < 0 ? 'down' : '';
      return '<span class="ov-lane">' + LANE[l.pos] + ' <b class="' + c + '">' + (l.diff > 0 ? '+' : l.diff < 0 ? '−' : '±') + k(Math.abs(l.diff)) + '</b></span>';
    }).join('');
    $('ov').hidden = false;
  };
})();
