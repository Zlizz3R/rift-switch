// The window's link to the background part: every action is one call into the app
// (src-tauri/src/main.rs, `dispatch`), updates arrive as events.
(function () {
  const T = window.__TAURI__;
  const call = (ch, ...args) => T.core.invoke('call', { ch, args }).catch(e => { console.warn(ch, e); return null; });
  const on = ev => fn => T.event.listen(ev, e => fn(e.payload));

  window.api = {
    getState: () => call('get-state'),
    getHistory: puuid => call('get-history', puuid),
    live: () => call('live'),
    champions: () => call('champions'),
    counters: (enemy, lane) => call('counters', enemy, lane),
    rankedGames: puuid => call('ranked-games', puuid),
    dashboard: () => call('dashboard'),
    collections: () => call('collections'),
    masteries: () => call('masteries'),
    masteryHistory: () => call('mastery-history'),
    ownGames: () => call('own-games'),
    loadAll: () => call('load-all'),
    setGoal: (puuid, goal, q) => call('goal', puuid, goal, q || 'solo'),
    tool: what => call('tool', what),
    openMulti: (region, ids) => call('open-multi', region, ids),
    switchTo: puuid => call('switch', puuid),
    addSaved: data => call('add-saved', data),
    addNew: cred => call('add-new', cred || null),
    dismissLogin: () => call('dismiss-login'),
    showRiotClient: () => call('show-riot-client'),
    fixMismatch: () => call('fix-mismatch'),
    cancelSwitch: () => call('cancel-switch'),
    getCredUser: puuid => call('get-cred-user', puuid),
    setCred: (puuid, cred) => call('set-cred', puuid, cred),
    delCred: puuid => call('del-cred', puuid),
    addCurrent: () => call('add-current'),
    cancelAdd: () => call('cancel-add'),
    remove: puuid => call('remove', puuid),
    setNote: (puuid, note) => call('note', puuid, note),
    reorder: order => call('reorder', order),
    arrange: list => call('arrange', list),
    catAdd: name => call('cat-add', name),
    catRename: (id, name) => call('cat-rename', id, name),
    catToggle: id => call('cat-toggle', id),
    catMove: (id, dir) => call('cat-move', id, dir),
    catDel: id => call('cat-del', id),
    refresh: () => call('refresh'),
    win: what => call('win', what),
    openExternal: url => call('open-external', url),
    setSetting: (k, v) => call('set-setting', k, v),
    dataExport: pass => call('data-export', pass || null),
    diagnostics: () => call('diagnostics'),
    dataImport: pass => call('data-import', pass || null),
    checkImportPass: pass => call('check-import-pass', pass),
    update: what => call('update', what),
    matches: filter => call('matches', filter),
    matchesMore: () => call('matches-more'),
    matchesGet: ids => call('matches-get', ids),
    matchesAssets: () => call('mh-assets'),
    matchesStorage: () => call('mh-storage'),
    othersStorage: () => call('others-storage'),
    othersClear: () => call('others-clear'),
    scoutGames: puuids => call('scout-games', puuids),
    champDamage: ids => call('champ-damage', ids),
    matchesClear: () => call('mh-clear'),
    playerRanks: puuids => call('player-ranks', puuids),
    unlock: pass => call('unlock', pass),
    revealPass: (puuid, pass) => call('reveal-pass', puuid, pass == null ? null : pass),
    lock: (what, pass, oldPass) => call('lock', what, pass, oldPass),
    onState: on('state'),
    onMatchesChanged: fn => T.event.listen('matches-changed', () => fn()),
    onScoutChanged: fn => T.event.listen('scout-changed', () => fn()),
    onTraySwitch: on('tray-switch'),
    onToast: on('toast'),
  };

  // the title bar moves the window (no system frame); double-click maximises
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.closest('.titlebar')) return;
    if (e.target.closest('button, input, label, select, a, textarea')) return;
    const w = T.window.getCurrentWindow();
    if (e.detail === 2) w.toggleMaximize(); else w.startDragging();
  });
})();
