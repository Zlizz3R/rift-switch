// Loads the real window (ui/index.html + its scripts) in jsdom with a fake background part, so tests
// can click through it like a user. The fake answers the window's calls from `state` and `replies`
// and records every call in `calls`.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const UI = path.join(__dirname, '..', 'ui');
const P = (n) => String(n).padStart(8, '0') + '-1111-1111-1111-111111111111';

function sampleState(extra = {}) {
  const acc = (i, o = {}) => ({ puuid: P(i), gameName: 'Player' + i, tagLine: 'EUW', region: 'EUW', level: 30 + i, iconId: i, note: '',
    hasCred: true, solo: { tier: 'GOLD', division: 'II', lp: 10 * i, wins: 10, losses: 8, wl: true }, flex: null, historyLen: 0, addedAt: i, ...o });
  return {
    accounts: [acc(1), acc(2, { category: 'c1' }), acc(3), acc(4, { placeholder: true, gameName: 'ab•••c', tagLine: '', hasCred: true, solo: null, level: null })],
    categories: [{ id: 'c1', name: 'Friends', collapsed: false }],
    active: P(1), settings: { lang: 'en', theme: 'dark', uiScale: '100', confirmSwitch: true, autoPlay: true, sort: 'custom', tile: null, seenVersion: '1.1.0', askedStart: true },
    live: { clientUp: true, puuid: P(1), phase: 'Lobby', waits: [] }, hasLock: false, sealLogins: false, pendingAdd: false, busy: false, login: null,
    version: '1.1.0', update: { status: 'off' }, ...extra,
  };
}

// upTo: load the window's scripts only up to this file (the first state can arrive before the rest is loaded)
async function boot({ state = sampleState(), replies = {}, width = 1300, upTo = null } = {}) {
  let html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  let scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (upTo) scripts = scripts.slice(0, scripts.indexOf(upTo) + 1);
  html = html.replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://tauri.localhost/' });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.error || e.message));
  w.addEventListener('unhandledrejection', (e) => errors.push(e.reason));
  // browser bits jsdom doesn't have
  w.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  // the fake background part
  const calls = [];
  const listeners = {};
  const S = { state };
  const answer = (ch, args) => {
    if (typeof replies[ch] === 'function') return replies[ch](...args);
    if (ch in replies) return replies[ch];
    if (ch === 'get-state') return S.state;
    if (ch === 'matches') return { index: [], waiting: 0, loadingOlder: false, clientUp: true };
    if (ch === 'matches-get' || ch === 'get-history' || ch === 'ranked-games' || ch === 'champions') return [];
    if (ch === 'dashboard' || ch === 'collections' || ch === 'masteries') return [];
    if (ch === 'mastery-history' || ch === 'own-games') return {};
    if (ch === 'mh-storage') return { bytes: 0, games: 0 };
    if (ch === 'mh-assets') return { items: {}, spells: {}, perks: {}, styles: {} };
    if (ch === 'live') return { clientUp: false };
    if (ch === 'player-ranks') return { ranks: {}, pending: 0 };
    if (ch === 'cat-add') return 'c9';
    return { ok: true };
  };
  w.__TAURI__ = {
    core: { invoke: (cmd, { ch, args }) => { calls.push({ ch, args: JSON.parse(JSON.stringify(args)) }); return Promise.resolve(answer(ch, args)); } },
    event: { listen: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return Promise.resolve(() => {}); } },
    window: { getCurrentWindow: () => ({ startDragging() { calls.push({ ch: 'drag' }); }, toggleMaximize() { calls.push({ ch: 'max' }); } }) },
  };
  // real <script> elements: top-level let/const are shared between the files, like in the app
  for (const s of scripts) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(UI, s), 'utf8') + `\n//# sourceURL=${s}`;
    w.document.body.appendChild(el);
  }
  await settle(w);
  const app = {
    w, d: w.document, calls, errors, S,
    $: (sel) => w.document.querySelector(sel),
    $$: (sel) => [...w.document.querySelectorAll(sel)],
    called: (ch) => calls.filter((c) => c.ch === ch),
    // the background part sends a new state (like after a save)
    push: async (st) => { S.state = st; (listeners.state || []).forEach((f) => f({ payload: st })); await settle(w); },
    emit: async (ev, payload) => { (listeners[ev] || []).forEach((f) => f({ payload })); await settle(w); },
    click: async (el, opts = {}) => { if (typeof el === 'string') el = w.document.querySelector(el); if (!el) throw new Error('nothing to click'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...opts })); await settle(w); return el; },
    key: async (key, target) => { (target || w.document).dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })); await settle(w); },
    type: async (el, value) => { if (typeof el === 'string') el = w.document.querySelector(el); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); await settle(w); },
    submit: async (form) => { if (typeof form === 'string') form = w.document.querySelector(form); form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle(w); },
    settle: () => settle(w),
    visible: (sel) => { const el = typeof sel === 'string' ? w.document.querySelector(sel) : sel; return !!el && !el.closest('[hidden]'); },
    close: () => w.close(),
  };
  return app;
}
// lets promises and short timers run
function settle(w, ms = 20) {
  return new Promise((r) => w.setTimeout(r, ms)).then(() => new Promise((r) => setTimeout(r, 0)));
}

module.exports = { boot, sampleState, P };
