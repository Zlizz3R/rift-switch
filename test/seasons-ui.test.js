// Overview → Seasons in the real window: three sources apart, pasted seasons with a preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, P, sampleState } = require('./harness');

test('seasons: the client\'s seasons, pasted lines with a preview, saved as "entered by you"', async () => {
  const st = sampleState();
  st.accounts[0].solo = { tier: 'GOLD', division: 'II', lp: 40, wins: 10, losses: 8, peak: { tier: 'GOLD', division: 'I' },
    lastSeason: { tier: 'SILVER', division: 'I' }, lastSeasonPeak: { tier: 'GOLD', division: 'IV' } };
  const app = await boot({ state: st });
  try {
    await app.click('#navDash');
    await app.click('[data-dt="seasons"]');
    await app.settle();
    const acc = app.$$('.ss-acc')[0];
    assert.match(acc.textContent, /Season \d{4} · Solo\/Duo end Silver I · peak Gold IV/);
    assert.match(acc.textContent, /now Gold II · peak Gold I/);
    await app.click(`[data-ssedit="${P(1)}"]`);
    const ta = app.$('#ssText');
    ta.value = '2023 Solo Gold II 54W 50L\nnonsense\nS2024-1 Flex Platin 3 20-18';
    ta.dispatchEvent(new app.w.Event('input', { bubbles: true }));
    assert.equal(app.$$('.ss-prev .ss-chip').length, 2);
    assert.match(app.$('.ss-bad').textContent, /line 2/);
    await app.click('#ssSave');
    const call = app.called('seasons-set').pop();
    assert.equal(call.args[0], P(1));
    assert.deepEqual(call.args[1].map(e => [e.season, e.queue, e.tier, e.division, e.wins, e.losses]),
      [['2023', 'solo', 'GOLD', 'II', 54, 50], ['2024-1', 'flex', 'PLATINUM', 'III', 20, 18]]);
    assert.match(app.$$('.ss-acc')[0].textContent, /2024-1 · Flex Platinum III · 20W 18L/);
    assert.deepEqual(app.errors.map(String), []);
  } finally { app.close(); }
});
