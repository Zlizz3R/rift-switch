// Updates from GitHub Releases (installed version only – the portable .exe and the
// source copy can't update themselves). Downloads in the background; installs when the
// app quits, or right away when the user presses "Restart now".
let state = { status: 'off', version: null, error: null };
let updater = null, onChange = () => {};

function init(app, changed) {
  onChange = changed || onChange;
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR || process.env.RS_DATA) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const set = s => { state = { ...state, ...s }; onChange(state); };
  updater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  updater.on('update-available', i => set({ status: 'downloading', version: i && i.version }));
  updater.on('update-not-available', () => set({ status: 'current' }));
  updater.on('update-downloaded', i => set({ status: 'ready', version: i && i.version }));
  updater.on('error', e => set({ status: 'error', error: String((e && e.message) || e).slice(0, 120) }));
  set({ status: 'idle' });
  check();
  setInterval(check, 6 * 3600 * 1000).unref();
}
function check() {
  if (!updater) return;
  updater.checkForUpdates().catch(() => {});
}
// only called on the user's click – never while they play
function installNow() { if (updater && state.status === 'ready') updater.quitAndInstall(false, true); }

module.exports = { init, check, installNow, get: () => state };
