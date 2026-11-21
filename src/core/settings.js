// Settings: defaults and the one place that decides what a value may be
// (used for changes from the window and for imported files alike).

const DEFAULT_SETTINGS = { autostart: false, closeToTray: true, autoAccept: false, autoPlay: true, confirmSwitch: true,
  sort: 'level', lang: 'en', theme: 'system', champPool: null, lane: 'top', tile: null, streamer: false, streamerHide: null,
  uiScale: '100' };
const UI_SCALES = ['80', '90', '100', '110', '125', '150'];
const THEMES = ['system', 'light', 'dark'];
const SORTS = ['level', 'rank', 'flex', 'played', 'name', 'custom'];
const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];

const switches = v => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[a-zA-Z0-9]{1,20}$/.test(k) && typeof x === 'boolean')) : null);

// -> { ok: true, value } for an allowed value, { ok: false } otherwise
function cleanSetting(key, value, langs) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return { ok: false };
  const pick = (list, fallback) => ({ ok: true, value: list.includes(String(value)) ? String(value) : fallback });
  switch (key) {
    case 'tile': case 'streamerHide': return { ok: true, value: switches(value) };
    case 'champPool': return { ok: true, value: Array.isArray(value) ? value.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 3000).slice(0, 40) : null };
    case 'uiScale': return pick(UI_SCALES, '100');
    case 'theme': return pick(THEMES, 'system');
    case 'sort': return pick(SORTS, 'level');
    case 'lane': return pick(LANES, 'top');
    case 'lang': return { ok: true, value: (langs || []).includes(value) ? value : 'en' };
    default: return typeof DEFAULT_SETTINGS[key] === 'boolean' ? { ok: true, value: !!value } : { ok: false };
  }
}

// imported settings onto the current ones; machine-specific ones (start with Windows) stay
function mergeSettings(target, incoming, langs) {
  if (!incoming || typeof incoming !== 'object') return target;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'autostart') continue;
    if (k === 'lang' && !(langs || []).includes(v)) continue;
    const r = cleanSetting(k, v, langs);
    if (r.ok) target[k] = r.value;
  }
  return target;
}

module.exports = { DEFAULT_SETTINGS, UI_SCALES, LANES, cleanSetting, mergeSettings };
