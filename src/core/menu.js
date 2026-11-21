// What the tray menu and the taskbar jump list show – as plain data, so it can be tested.
// main.js turns it into Electron menu items with the click handlers.

const STREAM_DEFAULTS = { name: true, tag: true, ranks: false, note: false, login: true };
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

const hides = (settings, k) => !!settings.streamer && !!({ ...STREAM_DEFAULTS, ...(settings.streamerHide || {}) })[k];

// streamer mode: same rules as the window (renderer.js dispName/fullName)
function displayName(a, state, tr) {
  const s = state.settings || {};
  if (!hides(s, 'name') && !(a.placeholder && !a.tagLine && hides(s, 'login')))
    return (a.gameName === 'Gespeicherter Login' ? tr('tile.savedLogin') : a.gameName) + (a.tagLine && !hides(s, 'tag') ? '#' + a.tagLine : '');
  if (a.note && !hides(s, 'note')) return a.note;
  return tr('stream.alias', { n: state.accounts.indexOf(a) + 1 });
}
const rankText = (q, tr) => (q ? tr('tier.' + q.tier) + (APEX.includes(q.tier) ? '' : ' ' + q.division) : '');

// [{ type: 'account', puuid, label, checked } | { type: 'header', label } | { type: 'separator' } | { type: 'locked', label }]
function accountItems(state, { locked, tr }) {
  if (locked) return [{ type: 'locked', label: '🔒 ' + tr('lock.locked') }, { type: 'separator' }];
  const s = state.settings || {};
  const item = a => ({ type: 'account', puuid: a.puuid, checked: a.puuid === state.active,
    label: displayName(a, state, tr) + (a.solo && !hides(s, 'ranks') ? '   ·   ' + rankText(a.solo, tr) : '') });
  const out = [];
  const catIds = new Set(state.categories.map(c => c.id));
  const loose = state.accounts.filter(a => !catIds.has(a.category));
  if (loose.length) out.push(...loose.map(item), { type: 'separator' });
  for (const c of state.categories) {
    const list = state.accounts.filter(a => a.category === c.id);
    if (list.length) out.push({ type: 'header', label: c.name }, ...list.map(item), { type: 'separator' });
  }
  return out;
}

// taskbar jump list: "switch to <account>", up to 10, none while locked
function jumpTasks(state, { locked, tr, program, baseArgs = [] }) {
  if (locked) return [];
  return state.accounts.filter(a => !a.placeholder || a.hasCred).slice(0, 10).map(a => ({
    program, arguments: [...baseArgs, '--switch=' + a.puuid].join(' '),
    title: displayName(a, state, tr), description: tr('jump.switch', { name: displayName(a, state, tr) }),
    iconPath: program, iconIndex: 0,
  }));
}

// the account id from "--switch=<id>" on the command line, if it is one of ours
function switchArg(argv, accounts) {
  const a = (argv || []).find(x => /^--switch=/.test(x));
  const id = a && a.slice(9);
  return id && /^(new-)?[0-9a-f-]{36}$/i.test(id) && accounts.some(x => x.puuid === id) ? id : null;
}

module.exports = { STREAM_DEFAULTS, hides, displayName, rankText, accountItems, jumpTasks, switchArg };
