// accounts.json: reading (with repairs and one-time migrations) and atomic writing.
const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS } = require('./settings');

const EMPTY = () => ({ accounts: [], categories: [], active: null, settings: { ...DEFAULT_SETTINGS } });

// whatever was in the file -> a complete, current state
function normalizeState(raw) {
  const state = { ...EMPTY(), ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!Array.isArray(state.accounts)) state.accounts = [];
  if (!Array.isArray(state.categories)) state.categories = [];
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  // one-time: sorting by level became the default (existing saves had "custom")
  if (!state.settings.sortLevelDefault) { state.settings.sort = 'level'; state.settings.sortLevelDefault = true; }
  // one-time: "Start League automatically" is on by default (older saves may have it off)
  if (!state.settings.autoPlayDefault) { state.settings.autoPlay = true; state.settings.autoPlayDefault = true; }
  return state;
}

// reads file (or file.bak if the real one is missing). A damaged file is copied aside first,
// never silently overwritten. onError(where, error) for the log.
function readState(file, onError = () => {}) {
  const src = fs.existsSync(file) ? file : (fs.existsSync(file + '.bak') ? file + '.bak' : null);
  if (!src) return normalizeState(null);
  try { return normalizeState(JSON.parse(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''))); }
  catch (e) {
    try { fs.copyFileSync(src, path.join(path.dirname(file), `accounts.damaged-${Date.now()}.json`)); } catch {}
    onError('load', e);
    return normalizeState(null);
  }
}

// write to file.tmp, then rename: a crash mid-write never leaves half a file
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); }
  catch { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch {} }
}

module.exports = { normalizeState, readState, writeAtomic };
