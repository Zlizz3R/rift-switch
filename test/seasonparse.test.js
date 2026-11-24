// Earlier seasons pasted as text (ui/seasonparse.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const SP = require('../ui/seasonparse');

test('season lines in many shapes, English and German', () => {
  const { entries, bad } = SP.parseSeasons([
    '2023 Solo Gold II 54W 50L',
    'S2024-1 Flex Platin 3 20-18',
    '2022; Diamond 4; 100 90',
    'S13 Meister 210/190',
    '2021 Silber IV',
    '',
    'nonsense here',
    '2020 gm 5001 3',
  ].join('\n'));
  assert.deepEqual(entries[0], { season: '2023', queue: 'solo', tier: 'GOLD', division: 'II', wins: 54, losses: 50 });
  assert.deepEqual(entries[1], { season: '2024-1', queue: 'flex', tier: 'PLATINUM', division: 'III', wins: 20, losses: 18 });
  assert.deepEqual(entries[2], { season: '2022', queue: 'solo', tier: 'DIAMOND', division: 'IV', wins: 100, losses: 90 });
  assert.deepEqual(entries[3], { season: 'S13', queue: 'solo', tier: 'MASTER', division: '', wins: 210, losses: 190 });
  assert.deepEqual(entries[4], { season: '2021', queue: 'solo', tier: 'SILVER', division: 'IV', wins: null, losses: null });
  assert.equal(entries.length, 5);
  assert.deepEqual(bad, [7, 8]);
  // back to a line and parsed again: the same
  assert.deepEqual(SP.parseLine(SP.lineOf(entries[1])), entries[1]);
});
